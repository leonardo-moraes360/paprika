package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf16"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func svgShadow(doc *Document, n *Node, id string, warn func(string)) (defs, attr string) {
	shadows := shadowNodes(n)
	if len(shadows) == 0 {
		return "", ""
	}
	mode := ModeOf(doc, n)
	prims := []string{}
	for _, s := range shadows {
		if s.Bool("inner") {
			warn("inner shadow: SVG uses only offset, blur and color")
		}
		sp, _ := s.Get("spread")
		if svgLen(doc, n, sp) != 0 {
			warn("shadow with spread: SVG uses only offset, blur and color")
		}
		if s.Bool("inner") {
			continue
		}
		sc, _ := s.Get("color")
		sx, _ := s.Get("x")
		sy, _ := s.Get("y")
		sb, _ := s.Get("blur")
		prims = append(prims, fmt.Sprintf(`<feDropShadow dx="%s" dy="%s" stdDeviation="%s" flood-color="%s"/>`,
			r2(svgLen(doc, n, sx)), r2(svgLen(doc, n, sy)), r2(svgLen(doc, n, sb)/2), EscapeHTML(jsString(ResolveValue(doc, sc, mode)))))
	}
	if len(prims) == 0 {
		return "", ""
	}
	defs = fmt.Sprintf(`<filter id="shadow-%s" x="-50%%" y="-50%%" width="200%%" height="200%%">%s</filter>`, id, strings.Join(prims, ""))
	attr = fmt.Sprintf(` filter="url(#shadow-%s)"`, id)
	return defs, attr
}

func svgLen(doc *Document, n *Node, v any) float64 {
	if f, ok := ResolveLength(doc, v, ModeOf(doc, n)); ok {
		return f
	}
	return 0
}

func roundedRectD(x, y, w, h float64, radii [4]float64, f func(float64) string) string {
	tl, tr, br, bl := radii[0], radii[1], radii[2], radii[3]
	parts := []string{
		fmt.Sprintf("M%s %s", f(x+tl), f(y)),
		fmt.Sprintf("L%s %s", f(x+w-tr), f(y)),
	}
	if tr != 0 {
		parts = append(parts, fmt.Sprintf("A%s %s 0 0 1 %s %s", f(tr), f(tr), f(x+w), f(y+tr)))
	}
	parts = append(parts, fmt.Sprintf("L%s %s", f(x+w), f(y+h-br)))
	if br != 0 {
		parts = append(parts, fmt.Sprintf("A%s %s 0 0 1 %s %s", f(br), f(br), f(x+w-br), f(y+h)))
	}
	parts = append(parts, fmt.Sprintf("L%s %s", f(x+bl), f(y+h)))
	if bl != 0 {
		parts = append(parts, fmt.Sprintf("A%s %s 0 0 1 %s %s", f(bl), f(bl), f(x), f(y+h-bl)))
	}
	parts = append(parts, fmt.Sprintf("L%s %s", f(x), f(y+tl)))
	if tl != 0 {
		parts = append(parts, fmt.Sprintf("A%s %s 0 0 1 %s %s", f(tl), f(tl), f(x+tl), f(y)))
	}
	parts = append(parts, "Z")
	return strings.Join(parts, " ")
}

type MeasureLine struct {
	T string  `json:"t"`
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Measure struct {
	Boxes map[string][4]float64    `json:"boxes"`
	Lines map[string][]MeasureLine `json:"lines,omitempty"`
}

func MeasureFromLayout(doc *Document, rootID string) (Measure, error) {
	opts := LayoutOptions{}
	if rootID != "" {
		opts.RootID = rootID
	}
	laid, err := Layout(doc, opts)
	if err != nil {
		return Measure{}, err
	}
	var node *Node
	if rootID != "" {
		node = GetNode(doc, rootID)
		if node == nil {
			return Measure{}, fmt.Errorf(`node "%s" does not exist`, rootID)
		}
	}
	var page, single *Node
	if node != nil {
		if node.Str("type") == "page" {
			page = node
		} else {
			single = node
		}
	} else {
		page = FirstPage(doc)
	}
	ox, oy := 0.0, 0.0
	if single != nil {
		if b, ok := laid[single.Str("id")]; ok {
			ox, oy = b.X, b.Y
		}
	} else {
		pageID := ""
		if page != nil {
			pageID = page.Str("id")
		}
		cb := CanvasBounds(doc, pageID)
		ox, oy = cb.X, cb.Y
	}
	boxes := map[string][4]float64{}
	for id, b := range laid {
		boxes[id] = [4]float64{b.X - ox, b.Y - oy, b.Width, b.Height}
	}
	return Measure{Boxes: boxes}, nil
}

type SVGResult struct {
	SVG      string
	Width    float64
	Height   float64
	Warnings []string
}

type box = [4]float64

var gradientRe = regexp.MustCompile(`(?i)gradient\(|url\(`)

func svgPaint(doc *Document, n *Node, k string, warn func(string)) (string, bool) {
	v, ok := n.Get(k)
	if !ok {
		return "", false
	}
	s := jsonv.Trim(jsString(ResolveValue(doc, v, ModeOf(doc, n))))
	if gradientRe.MatchString(s) {
		warn("gradients and background images do not go into SVG; the fill was left out")
		return "", false
	}
	return s, true
}

func ExportSVG(doc *Document, rootID string, measure *Measure) (SVGResult, error) {
	warnings, warn := newWarner()
	f := r2
	var node *Node
	if rootID != "" {
		node = GetNode(doc, rootID)
		if node == nil {
			return SVGResult{}, fmt.Errorf(`node "%s" does not exist`, rootID)
		}
	}
	var page, single *Node
	if node != nil {
		if node.Str("type") == "page" {
			page = node
		} else {
			single = node
		}
	} else {
		page = FirstPage(doc)
	}
	pageID := ""
	if page != nil {
		pageID = page.Str("id")
	}
	var roots []string
	var cb *Bounds
	if single != nil {
		roots = []string{single.Str("id")}
	} else {
		roots, _ = PageRoots(doc, pageID)
		b := CanvasBounds(doc, pageID)
		cb = &b
	}
	if measure == nil {
		m, err := MeasureFromLayout(doc, rootID)
		if err != nil {
			return SVGResult{}, err
		}
		measure = &m
	}
	measured := map[string][4]float64{}
	if measure.Boxes != nil {
		measured = measure.Boxes
	}
	boxes := map[string]box{}

	boxOf := func(n *Node, _parent box, _, _root bool) (*box, error) {
		if n.Str("type") == "page" {
			return nil, nil
		}
		if m, ok := measured[n.Str("id")]; ok {
			return &m, nil
		}
		return nil, nil
	}

	var emit func(n *Node, parent box, root bool) (string, error)
	shapeSVG := func(n *Node, w, h float64) string {
		mode := ModeOf(doc, n)
		id := EscapeHTML(n.Str("id"))
		_, pathA, fold, inner := ShapeAttrs(doc, n, false)
		defs, shadowAttr := svgShadow(doc, n, id, warn)
		attrs := make([]Attr, len(pathA))
		copy(attrs, pathA)
		for i, a := range attrs {
			if a.Key != "fill" || a.Value == "none" {
				continue
			}
			if s, ok := a.Value.(string); ok && strings.HasPrefix(s, "url(") {
				continue
			}
			pfill := "none"
			if pf, ok := svgPaint(doc, n, "fill", warn); ok {
				pfill = pf
			}
			attrs[i] = Attr{"fill", pfill}
		}
		var body strings.Builder
		body.WriteString("<g" + shadowAttr + ">" + inner + "<path" + svgAttrs(attrs) + "/>")
		if fold != nil {
			body.WriteString("<path" + svgAttrs(fold) + "/>")
		}
		body.WriteString("</g>")
		fsv, _ := n.Get("fontSize")
		fs := ResolveValue(doc, fsv, mode)
		size, isNum := fs.(float64)
		if !isNum {
			size = jsonv.ParseFloat(jsString(fs))
			if math.IsNaN(size) || size == 0 {
				size = 16
			}
		}
		var tspans strings.Builder
		anchor := ""
		lines, hasLines := []MeasureLine(nil), false
		if measure != nil && measure.Lines != nil {
			lines, hasLines = measure.Lines[n.Str("id")]
		}
		if hasLines {
			for _, l := range lines {
				fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(l.X), f(l.Y), EscapeHTML(l.T))
			}
		} else if n.Str("text") != "" {
			pv, ph := ShapePadding(n)
			lhv, _ := n.Get("lineHeight")
			lh := svgLen(doc, n, lhv) * size
			split := strings.Split(n.Str("text"), "\n")
			top := (h - float64(len(split))*lh) / 2
			if n.Str("shape") == "note" {
				top = pv
			}
			align := n.Str("textAlign")
			ax := ph
			if align == "center" {
				ax = w / 2
			} else if align == "right" {
				ax = w - ph
			}
			if align != "left" {
				a := "end"
				if align == "center" {
					a = "middle"
				}
				anchor = fmt.Sprintf(` text-anchor="%s"`, a)
			}
			for k, t := range split {
				if t != "" {
					fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(ax), f(top+float64(k)*lh+(lh-size)/2+size*0.8), EscapeHTML(t))
				}
			}
		}
		if tspans.Len() > 0 {
			colorV, _ := n.Get("color")
			fw, _ := n.Get("fontWeight")
			fam, _ := n.Get("fontFamily")
			fmt.Fprintf(&body, `<text xml:space="preserve" font-family="%s" font-size="%s" font-weight="%s" fill="%s"%s>%s</text>`,
				EscapeHTML(ResolvedFontFamily(doc, fam, mode)), f(size), jsString(ResolvedFontWeight(doc, fw, mode)), EscapeHTML(jsString(ResolveValue(doc, colorV, mode))), anchor, tspans.String())
		}
		if defs != "" {
			return "<defs>" + defs + "</defs>" + body.String()
		}
		return body.String()
	}

	emit = func(n *Node, parent box, root bool) (string, error) {
		typ := n.Str("type")
		if typ == "page" {
			return "", nil
		}
		var pn *Node
		if pid := n.Str("parentId"); pid != "" {
			pn = GetNode(doc, pid)
		}
		inFlow := false
		if !root && pn != nil && pn.Str("type") == "frame" {
			if l := pn.Obj("layout"); l != nil && l.Str("mode") != "none" {
				inFlow = true
			}
		}
		bp, err := boxOf(n, parent, inFlow, root)
		if err != nil {
			return "", err
		}
		if bp == nil || !n.Bool("visible") {
			return "", nil
		}
		b := *bp
		boxes[n.Str("id")] = b
		x, y, w, h := b[0], b[1], b[2], b[3]
		tr := fmt.Sprintf("translate(%s %s)", f(x-parent[0]), f(y-parent[1]))
		rotation := 0.0
		if typ != "group" && typ != "connector" {
			rotation = n.Num("rotation")
		}
		if rotation != 0 && !math.IsNaN(rotation) {
			tr += fmt.Sprintf(" rotate(%s %s %s)", f(rotation), f(w/2), f(h/2))
		}
		id := EscapeHTML(n.Str("id"))
		var open strings.Builder
		fmt.Fprintf(&open, `<g data-paprika-id="%s"`, id)
		if name := n.Str("name"); name != "" {
			fmt.Fprintf(&open, ` data-name="%s"`, EscapeHTML(name))
		}
		fmt.Fprintf(&open, ` transform="%s"`, tr)
		if op, _ := n.Get("opacity"); op != 1.0 {
			fmt.Fprintf(&open, ` opacity="%s"`, f(n.Num("opacity")))
		}
		open.WriteString(">")
		kids := func() (string, error) {
			if !IsContainer(typ) {
				return "", nil
			}
			var sb strings.Builder
			for _, c := range childNodes(doc, n) {
				s, err := emit(c, b, false)
				if err != nil {
					return "", err
				}
				sb.WriteString(s)
			}
			return sb.String(), nil
		}
		if typ == "group" {
			inner, err := kids()
			if err != nil {
				return "", err
			}
			return open.String() + inner + "</g>", nil
		}
		if typ == "connector" {
			text := ""
			if label := ConnectorLabelAttrs(doc, n, false); label != nil {
				text = "<text" + svgAttrs(label) + ">" + EscapeHTML(n.Str("label")) + "</text>"
			}
			return open.String() + "<path" + svgAttrs(ConnectorAttrs(doc, n, false)) + "/>" + text + "</g>", nil
		}
		if typ == "shape" {
			return open.String() + shapeSVG(n, w, h) + "</g>", nil
		}

		defs, shadowAttr := "", ""
		if typ != "text" {
			defs, shadowAttr = svgShadow(doc, n, id, warn)
		}
		fill, hasFill := "", false
		paintedInner, hasPainted := "", false
		if typ != "path" {
			if pf, extra, ok := svgGradientInner(doc, n, w, h, false); ok {
				paintedInner, hasPainted = extra, true
				if pf != "none" {
					fill, hasFill = pf, true
				}
			} else {
				fill, hasFill = svgPaint(doc, n, "fill", warn)
			}
		}
		sw := 0.0
		st := n.Obj("stroke")
		if typ != "path" && st != nil {
			w, _ := st.Get("width")
			if got := svgLen(doc, n, w); got > 0 {
				sw = got
			}
		}
		pos, style := "inside", "solid"
		if sw != 0 {
			pos = StrokePositionOf(n)
			style = StrokeStyleOf(st)
		}
		dashAttr := ""
		if dash := StrokeDasharray(sw, style); dash != "" {
			dashAttr = fmt.Sprintf(` stroke-dasharray="%s"`, EscapeHTML(dash))
		}
		strokeAttr := ""
		if sw != 0 {
			sc, _ := st.Get("color")
			strokeAttr = fmt.Sprintf(` stroke="%s" stroke-width="%s"%s`, EscapeHTML(jsString(ResolveValue(doc, sc, ModeOf(doc, n)))), f(sw), dashAttr)
		}
		fillVal := "none"
		if hasFill {
			fillVal = fill
		}
		fillAttr := fmt.Sprintf(` fill="%s"`, EscapeHTML(fillVal))
		insetBy := 0.0
		switch pos {
		case "inside":
			insetBy = sw / 2
		case "outside":
			insetBy = -sw / 2
		}
		inset := fmt.Sprintf(`x="%s" y="%s" width="%s" height="%s"`, f(insetBy), f(insetBy), f(math.Max(0, w-insetBy*2)), f(math.Max(0, h-insetBy*2)))
		var boxRadius [4]float64
		hasBox := typ != "ellipse" && typ != "path"
		if hasBox {
			rv, _ := n.Get("radius")
			boxRadius = UsedCornerRadii(w, h, ResolveCorners(doc, rv, ModeOf(doc, n)))
		}
		even := !hasBox || (boxRadius[0] == boxRadius[1] && boxRadius[1] == boxRadius[2] && boxRadius[2] == boxRadius[3])
		r := 0.0
		if even {
			r = boxRadius[0]
		}
		radius, clipRadius := "", ""
		if r != 0 && !math.IsNaN(r) {
			radius = fmt.Sprintf(` rx="%s"`, f(math.Max(0, r-insetBy)))
			clipRadius = fmt.Sprintf(` rx="%s"`, f(r))
		}
		bleed := 0.0
		if typ == "frame" && n.Bool("clip") {
			bleed = outlineBleed(doc, n, ModeOf(doc, n))
		}
		clipDef := func(clipID string) string {
			if bleed > 0 {
				grown := boxRadius
				for i := range grown {
					if grown[i] > 0 {
						grown[i] += bleed
					}
				}
				return fmt.Sprintf(`<clipPath id="%s"><path d="%s"/></clipPath>`, clipID, roundedRectD(-bleed, -bleed, w+bleed*2, h+bleed*2, grown, f))
			}
			if even {
				return fmt.Sprintf(`<clipPath id="%s"><rect width="%s" height="%s"%s/></clipPath>`, clipID, f(w), f(h), clipRadius)
			}
			return fmt.Sprintf(`<clipPath id="%s"><path d="%s"/></clipPath>`, clipID, roundedRectD(0, 0, w, h, boxRadius, f))
		}
		var body strings.Builder
		switch typ {
		case "frame", "rect", "text", "image":
			if !even {
				insetR := boxRadius
				for i := range insetR {
					insetR[i] = math.Max(0, boxRadius[i]-insetBy)
				}
				d := roundedRectD(insetBy, insetBy, math.Max(0, w-insetBy*2), math.Max(0, h-insetBy*2), insetR, f)
				if (hasFill && fill != "") || sw != 0 || shadowAttr != "" {
					fmt.Fprintf(&body, `<path d="%s"%s%s%s/>`, d, fillAttr, strokeAttr, shadowAttr)
				}
			} else if (hasFill && fill != "") || sw != 0 {
				fmt.Fprintf(&body, `<rect %s%s%s%s%s/>`, inset, radius, fillAttr, strokeAttr, shadowAttr)
			} else if shadowAttr != "" {
				fmt.Fprintf(&body, `<rect width="%s" height="%s"%s fill="none"%s/>`, f(w), f(h), radius, shadowAttr)
			}
		case "ellipse":
			fmt.Fprintf(&body, `<ellipse cx="%s" cy="%s" rx="%s" ry="%s"%s%s%s/>`, f(w/2), f(h/2), f(math.Max(0, (w-insetBy*2)/2)), f(math.Max(0, (h-insetBy*2)/2)), fillAttr, strokeAttr, shadowAttr)
		case "path":
			svgA, pathA, inner := PathAttrs(doc, n)
			attrs := make([]Attr, len(pathA))
			copy(attrs, pathA)
			for i, a := range attrs {
				if a.Key != "fill" {
					continue
				}
				if s, ok := a.Value.(string); ok && (s == "none" || strings.HasPrefix(s, "url(")) {
					continue
				}
				pfill := "none"
				if pf, ok := svgPaint(doc, n, "fill", warn); ok {
					pfill = pf
				}
				attrs[i] = Attr{"fill", pfill}
			}
			fmt.Fprintf(&body, `<svg width="%s" height="%s"%s overflow="visible">%s<path%s%s/></svg>`, f(w), f(h), svgAttrs(svgA), inner, svgAttrs(attrs), shadowAttr)
		}
		if hasPainted && typ != "path" {
			rest := body.String()
			body.Reset()
			body.WriteString(paintedInner)
			body.WriteString(rest)
		}
		if typ == "text" {
			fsv, _ := n.Get("fontSize")
			fs := ResolveValue(doc, fsv, ModeOf(doc, n))
			size, isNum := fs.(float64)
			if !isNum {
				size = jsonv.ParseFloat(jsString(fs))
				if math.IsNaN(size) || size == 0 {
					size = 16
				}
			}
			colorV, _ := n.Get("color")
			color := EscapeHTML(jsString(ResolveValue(doc, colorV, ModeOf(doc, n))))
			var tspans strings.Builder
			anchor := ""
			lines, hasLines := []MeasureLine(nil), false
			if measure != nil && measure.Lines != nil {
				lines, hasLines = measure.Lines[n.Str("id")]
			}
			if hasLines {
				for _, l := range lines {
					fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(l.X), f(l.Y), EscapeHTML(l.T))
				}
			} else {
				lhv, _ := n.Get("lineHeight")
				mult := svgLen(doc, n, lhv)
				align := n.Str("textAlign")
				ax := 0.0
				if align == "center" {
					ax = w / 2
				} else if align == "right" {
					ax = w
				}
				if align != "left" {
					a := "end"
					if align == "center" {
						a = "middle"
					}
					anchor = fmt.Sprintf(` text-anchor="%s"`, a)
				}
				runs := n.Arr("runs")
				if len(runs) == 0 {
					lh := mult * size
					for k, t := range strings.Split(n.Str("text"), "\n") {
						if t != "" {
							fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(ax), f(float64(k)*lh+(lh-size)/2+size*0.8), EscapeHTML(t))
						}
					}
				} else {
					abs := 0
					top := 0.0
					for t := range strings.SplitSeq(n.Str("text"), "\n") {
						sizeL := lineRunSize(doc, n, t, abs, size)
						lh := mult * sizeL
						if t != "" {
							y := top + (lh-sizeL)/2 + sizeL*0.8
							fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(ax), f(y), richLineInner(doc, n, t, abs))
						}
						top += lh
						abs += len(utf16.Encode([]rune(t))) + 1
					}
				}
			}
			ls := ""
			lsv, _ := n.Get("letterSpacing")
			if v := svgLen(doc, n, lsv); v != 0 {
				ls = fmt.Sprintf(` letter-spacing="%s"`, f(v))
			}
			fw, _ := n.Get("fontWeight")
			fam, _ := n.Get("fontFamily")
			textMode := ModeOf(doc, n)
			fmt.Fprintf(&body, `<text xml:space="preserve" font-family="%s" font-size="%s" font-weight="%s" fill="%s"%s%s>%s</text>`,
				EscapeHTML(ResolvedFontFamily(doc, fam, textMode)), f(size), jsString(ResolvedFontWeight(doc, fw, textMode)), color, ls, anchor, tspans.String())
		}
		if typ == "image" {
			fit := "none"
			switch n.Str("fit") {
			case "cover":
				fit = "xMidYMid slice"
			case "contain":
				fit = "xMidYMid meet"
			}
			src := EscapeHTML(ResolveAsset(doc, n.Str("src")))
			if boxRadius[0] > 0 || boxRadius[1] > 0 || boxRadius[2] > 0 || boxRadius[3] > 0 {
				defs += clipDef("clip-" + id)
				fmt.Fprintf(&body, `<image href="%s" width="%s" height="%s" preserveAspectRatio="%s" clip-path="url(#clip-%s)"/>`, src, f(w), f(h), fit, id)
			} else {
				fmt.Fprintf(&body, `<image href="%s" width="%s" height="%s" preserveAspectRatio="%s"/>`, src, f(w), f(h), fit)
			}
		}
		if typ == "frame" {
			inner, err := kids()
			if err != nil {
				return "", err
			}
			if n.Bool("clip") && inner != "" {
				defs += clipDef("clip-" + id)
				fmt.Fprintf(&body, `<g clip-path="url(#clip-%s)">%s</g>`, id, inner)
			} else {
				body.WriteString(inner)
			}
		}
		out := open.String()
		if defs != "" {
			out += "<defs>" + defs + "</defs>"
		}
		ring := ""
		if typ != "text" {
			ring = outlineRing(doc, n, w, h, boxRadius, hasBox, f)
		}
		return out + body.String() + ring + "</g>", nil
	}

	var content strings.Builder
	for _, id := range roots {
		if n := GetNode(doc, id); n != nil {
			s, err := emit(n, box{}, true)
			if err != nil {
				return SVGResult{}, err
			}
			content.WriteString(s)
		}
	}
	var width, height float64
	if single != nil {
		width, height = 1, 1
		if b, ok := boxes[single.Str("id")]; ok {
			width, height = b[2], b[3]
		}
	} else {
		width, height = cb.Width, cb.Height
	}
	bg := ""
	if single == nil {
		fill := "#ffffff"
		pageInner := ""
		if page != nil {
			if pf, extra, ok := svgGradientInner(doc, page, width, height, false); ok {
				pageInner = extra
				fill = pf
			} else if v, ok := page.Get("fill"); ok && v != "" && v != nil {
				fill = jsString(ResolveValue(doc, v, page.Str("mode")))
			}
		}
		bg = pageInner + fmt.Sprintf(`<rect width="%s" height="%s" fill="%s"/>`, f(width), f(height), EscapeHTML(fill))
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">%s%s</svg>`, f(width), f(height), f(width), f(height), bg, content.String())
	return SVGResult{SVG: svg, Width: width, Height: height, Warnings: *warnings}, nil
}

func outlineRing(doc *Document, n *Node, w, h float64, radii [4]float64, hasBox bool, f func(float64) string) string {
	o := n.Obj("outline")
	if o == nil {
		return ""
	}
	mode := ModeOf(doc, n)
	wRaw, _ := o.Get("width")
	ow, _ := ResolveLength(doc, wRaw, mode)
	if ow <= 0 {
		return ""
	}
	off := 0.0
	if offRaw, ok := o.Get("offset"); ok {
		off, _ = ResolveLength(doc, offRaw, mode)
	}
	out := off + ow/2
	style := o.Str("style")
	if style == "" {
		style = "solid"
	}
	colRaw, _ := o.Get("color")
	attrs := fmt.Sprintf(` fill="none" stroke="%s" stroke-width="%s"`, EscapeHTML(jsString(ResolveValue(doc, colRaw, mode))), f(ow))
	if dash := StrokeDasharray(ow, style); dash != "" {
		attrs += fmt.Sprintf(` stroke-dasharray="%s"`, EscapeHTML(dash))
	}
	rw := math.Max(0, w+out*2)
	rh := math.Max(0, h+out*2)
	if n.Str("type") == "ellipse" {
		return fmt.Sprintf(`<ellipse cx="%s" cy="%s" rx="%s" ry="%s"%s/>`, f(w/2), f(h/2), f(rw/2), f(rh/2), attrs)
	}
	if hasBox && !(radii[0] == radii[1] && radii[1] == radii[2] && radii[2] == radii[3]) {
		grown := radii
		for i := range grown {
			if grown[i] > 0 {
				grown[i] = math.Max(0, grown[i]+out)
			}
		}
		return fmt.Sprintf(`<path d="%s"%s/>`, roundedRectD(-out, -out, rw, rh, grown, f), attrs)
	}
	rx := ""
	if hasBox && radii[0] > 0 {
		rx = fmt.Sprintf(` rx="%s"`, f(math.Max(0, radii[0]+out)))
	}
	return fmt.Sprintf(`<rect x="%s" y="%s" width="%s" height="%s"%s%s/>`, f(-out), f(-out), f(rw), f(rh), rx, attrs)
}

func resolvedSize(doc *Document, n *Node, v any, fallback float64) float64 {
	mode := ModeOf(doc, n)
	got := ResolveValue(doc, v, mode)
	if f, ok := got.(float64); ok {
		return f
	}
	p := jsonv.ParseFloat(jsString(got))
	if math.IsNaN(p) || p == 0 {
		return fallback
	}
	return p
}

func lineRunSize(doc *Document, n *Node, line string, abs int, base float64) float64 {
	size := base
	end := abs + len(utf16.Encode([]rune(line)))
	for _, item := range n.Arr("runs") {
		o, ok := item.(*jsonv.Object)
		if !ok {
			continue
		}
		fs, ok := o.Get("fontSize")
		if !ok {
			continue
		}
		if int(o.Num("end")) <= abs || int(o.Num("start")) >= end {
			continue
		}
		if s := resolvedSize(doc, n, fs, base); s > size {
			size = s
		}
	}
	return size
}

func richLineInner(doc *Document, n *Node, line string, abs int) string {
	mode := ModeOf(doc, n)
	var b strings.Builder
	for _, p := range PiecesInRange(line, abs, n.Arr("runs")) {
		if p.Run == nil {
			b.WriteString(EscapeHTML(p.Text))
			continue
		}
		var attrs strings.Builder
		if w, ok := p.Run.Get("fontWeight"); ok {
			fmt.Fprintf(&attrs, ` font-weight="%s"`, jsString(w))
		}
		if c, ok := p.Run.Get("color"); ok {
			fmt.Fprintf(&attrs, ` fill="%s"`, EscapeHTML(jsString(ResolveValue(doc, c, mode))))
		}
		if fs, ok := p.Run.Get("fontSize"); ok {
			fmt.Fprintf(&attrs, ` font-size="%s"`, r2(resolvedSize(doc, n, fs, 16)))
		}
		if p.Run.Bool("italic") {
			attrs.WriteString(` font-style="italic"`)
		}
		if href, ok := p.Run.Get("href"); ok {
			attrs.WriteString(` text-decoration="underline"`)
			inner := "<tspan" + attrs.String() + ">" + EscapeHTML(p.Text) + "</tspan>"
			b.WriteString(`<a href="` + EscapeHTML(jsString(href)) + `">` + inner + `</a>`)
			continue
		}
		b.WriteString("<tspan" + attrs.String() + ">" + EscapeHTML(p.Text) + "</tspan>")
	}
	return b.String()
}
