package export

import (
	"fmt"
	"image"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	xdraw "golang.org/x/image/draw"
)

func drawScale(dst, src *image.RGBA) {
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
}

var (
	nestedSVGOpen = regexp.MustCompile(`<svg\b([^>]*)>`)
	rectTag       = regexp.MustCompile(`<rect\b([^>/]*?)(/?)>`)
	attrRe        = regexp.MustCompile(`([a-zA-Z_:][-a-zA-Z0-9_:]*)="([^"]*)"`)
	filterTag     = regexp.MustCompile(`(?s)<filter\b.*?</filter>`)
	filterAttr    = regexp.MustCompile(`\sfilter="[^"]*"`)
)

var (
	svgTag       = regexp.MustCompile(`<[a-zA-Z][^<>]*>`)
	hexAlphaAttr = regexp.MustCompile(`\s(fill|stroke|stop-color|flood-color)="#([0-9a-fA-F]{8}|[0-9a-fA-F]{4})"`)
)

// normalizeAlphaColors rewrites #RRGGBBAA / #RGBA colors, which oksvg rejects ("color string
// 00000000 is not length 3 or 6"), into #RRGGBB plus an opacity attribute (multiplied into one
// already there). Alpha 0 on a fill or stroke becomes "none".
func normalizeAlphaColors(s string) string {
	return svgTag.ReplaceAllStringFunc(s, func(tag string) string {
		if !hexAlphaAttr.MatchString(tag) {
			return tag
		}
		attrs := map[string]string{}
		for _, a := range attrRe.FindAllStringSubmatch(tag, -1) {
			attrs[a[1]] = a[2]
		}
		for _, m := range hexAlphaAttr.FindAllStringSubmatch(tag, -1) {
			name, raw := m[1], m[2]
			hex := raw
			if len(hex) == 4 {
				hex = string([]byte{hex[0], hex[0], hex[1], hex[1], hex[2], hex[2], hex[3], hex[3]})
			}
			var alpha int
			fmt.Sscanf(hex[6:], "%x", &alpha)
			opacity := float64(alpha) / 255
			opName := name + "-opacity"
			switch name {
			case "stop-color":
				opName = "stop-opacity"
			case "flood-color":
				opName = "flood-opacity"
			}
			old := fmt.Sprintf(` %s="#%s"`, name, raw)
			if opacity == 0 && (name == "fill" || name == "stroke") {
				tag = strings.Replace(tag, old, fmt.Sprintf(` %s="none"`, name), 1)
				continue
			}
			if prev, ok := attrs[opName]; ok {
				opacity *= parseFloatAttr(prev)
				tag = regexp.MustCompile(`\s`+opName+`="[^"]*"`).ReplaceAllString(tag, "")
			}
			repl := fmt.Sprintf(` %s="#%s" %s="%s"`, name, hex[:6], opName, formatOpacity(opacity))
			tag = strings.Replace(tag, old, repl, 1)
		}
		return tag
	})
}

func formatOpacity(v float64) string {
	return strconv.FormatFloat(math.Round(v*1000)/1000, 'f', -1, 64)
}

func prepareSVG(s string) string {
	s = normalizeAlphaColors(s)
	s = flattenNestedSVG(s)
	s = strings.ReplaceAll(s, `fill="transparent"`, `fill="none"`)
	s = filterTag.ReplaceAllString(s, "")
	s = filterAttr.ReplaceAllString(s, "")
	s = expandRoundedRects(s)
	return s
}

func expandRoundedRects(s string) string {
	return rectTag.ReplaceAllStringFunc(s, func(m string) string {
		sub := rectTag.FindStringSubmatch(m)
		attrs := map[string]string{}
		for _, a := range attrRe.FindAllStringSubmatch(sub[1], -1) {
			attrs[a[1]] = a[2]
		}
		rx := parseFloatAttr(attrs["rx"])
		ry := parseFloatAttr(attrs["ry"])
		if ry == 0 {
			ry = rx
		}
		if rx == 0 && ry == 0 {
			return m
		}
		x := parseFloatAttr(attrs["x"])
		y := parseFloatAttr(attrs["y"])
		w := parseFloatAttr(attrs["width"])
		h := parseFloatAttr(attrs["height"])
		if rx > w/2 {
			rx = w / 2
		}
		if ry > h/2 {
			ry = h / 2
		}
		d := roundedRectPath(x, y, w, h, rx, ry)
		var b strings.Builder
		b.WriteString(`<path d="`)
		b.WriteString(d)
		b.WriteString(`"`)
		for k, v := range attrs {
			switch k {
			case "x", "y", "width", "height", "rx", "ry":
				continue
			}
			fmt.Fprintf(&b, ` %s="%s"`, k, v)
		}
		if sub[2] == "/" {
			b.WriteString("/>")
		} else {
			b.WriteString(">")
		}
		return b.String()
	})
}

func parseFloatAttr(s string) float64 {
	if s == "" {
		return 0
	}
	var v float64
	if _, err := fmt.Sscanf(s, "%f", &v); err != nil {
		return 0
	}
	return v
}

func roundedRectPath(x, y, w, h, rx, ry float64) string {
	// Clockwise path with SVG arcs for the four corners.
	return fmt.Sprintf(
		"M%.4f %.4f H%.4f A%.4f %.4f 0 0 1 %.4f %.4f V%.4f A%.4f %.4f 0 0 1 %.4f %.4f H%.4f A%.4f %.4f 0 0 1 %.4f %.4f V%.4f A%.4f %.4f 0 0 1 %.4f %.4f Z",
		x+rx, y,
		x+w-rx,
		rx, ry, x+w, y+ry,
		y+h-ry,
		rx, ry, x+w-rx, y+h,
		x+rx,
		rx, ry, x, y+h-ry,
		y+ry,
		rx, ry, x+rx, y,
	)
}

func flattenNestedSVG(s string) string {
	first := true
	out := nestedSVGOpen.ReplaceAllStringFunc(s, func(m string) string {
		if first {
			first = false
			return m
		}
		attrs := nestedSVGOpen.FindStringSubmatch(m)[1]
		return "<g" + attrs + ">"
	})
	parts := strings.Split(out, "</svg>")
	if len(parts) <= 1 {
		return out
	}
	return strings.Join(parts[:len(parts)-1], "</g>") + "</svg>"
}

func Rasterize(doc *core.Document, rootID string, scale float64) (*image.RGBA, []string, error) {
	const oversample = 2.0
	img, warnings, err := rasterizeAt(doc, rootID, scale*oversample)
	if err != nil {
		return nil, nil, err
	}
	if oversample == 1 {
		return img, warnings, nil
	}
	w := int(math.Round(float64(img.Bounds().Dx()) / oversample))
	h := int(math.Round(float64(img.Bounds().Dy()) / oversample))
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	drawScale(out, img)
	return out, warnings, nil
}

func rasterizeAt(doc *core.Document, rootID string, scale float64) (*image.RGBA, []string, error) {
	svg, err := core.ExportSVG(doc, rootID, nil)
	if err != nil {
		return nil, nil, err
	}
	warnings := append([]string{}, svg.Warnings...)
	w := int(math.Round(svg.Width * scale))
	h := int(math.Round(svg.Height * scale))
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	if w > 8192 || h > 8192 {
		return nil, nil, fmt.Errorf("export size %dx%d exceeds 8192px on a side", w, h)
	}
	prepared := prepareSVG(svg.SVG)
	icon, err := oksvg.ReadIconStream(strings.NewReader(prepared))
	if err != nil {
		return nil, nil, fmt.Errorf("svg rasterize: %w", err)
	}
	icon.SetTarget(0, 0, float64(w), float64(h))
	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	if rootID == "" {
		fillPageBackground(doc, rgba)
	} else if n := core.GetNode(doc, rootID); n != nil && n.Str("type") == "page" {
		fillPageBackground(doc, rgba)
	}
	// Any other root keeps a transparent background, like render_screenshot.
	scanner := rasterx.NewScannerGV(w, h, rgba, rgba.Bounds())
	raster := rasterx.NewDasher(w, h, scanner)
	icon.Draw(raster, 1)
	if err := paintText(doc, rootID, rgba, scale); err != nil {
		warnings = append(warnings, err.Error())
	}
	return rgba, warnings, nil
}

func fillPageBackground(doc *core.Document, rgba *image.RGBA) {
	fill := "#ffffff"
	if page := core.FirstPage(doc); page != nil {
		if v, ok := page.Get("fill"); ok && v != nil && v != "" {
			fill = fmt.Sprint(core.ResolveValue(doc, v, page.Str("mode")))
		}
	}
	c, ok := core.ParseColor(fill)
	if !ok {
		c = core.RGBA{R: 255, G: 255, B: 255, A: 1}
	}
	r, g, b, a := uint8(c.R), uint8(c.G), uint8(c.B), uint8(c.A*255+0.5)
	for i := 0; i < len(rgba.Pix); i += 4 {
		rgba.Pix[i] = r
		rgba.Pix[i+1] = g
		rgba.Pix[i+2] = b
		rgba.Pix[i+3] = a
	}
}
