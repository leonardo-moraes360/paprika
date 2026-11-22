package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/svgExport.ts: a node, a page or the canvas as vector SVG. Boxes come
// from Layout when measure is nil; an explicit measure overrides boxes and text lines (goldens).

// MeasureLine is one laid-out text line, relative to the node box (baseline y).
type MeasureLine struct {
	T string  `json:"t"`
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Measure holds boxes ([x, y, w, h] before rotation, relative to the export origin) and text lines.
type Measure struct {
	Boxes map[string][4]float64    `json:"boxes"`
	Lines map[string][]MeasureLine `json:"lines,omitempty"`
}

// MeasureFromLayout remaps Layout boxes so the export origin is (0, 0).
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

// SVGResult is the exported SVG and its size.
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

// ExportSVG renders rootID ("" = the canvas of the first page) as SVG; nil measure uses Layout.
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
	// shapeSVG: outline (and fold), then the text in lines (measured, or split on \n).
	shapeSVG := func(n *Node, w, h float64) string {
		mode := ModeOf(doc, n)
		id := EscapeHTML(n.Str("id"))
		_, pathA, fold := ShapeAttrs(doc, n, false)
		defs, shadowAttr := "", ""
		if s := n.Obj("shadow"); s != nil {
			if s.Num("spread") != 0 {
				warn("shadow with spread: SVG uses only offset, blur and color")
			}
			sc, _ := s.Get("color")
			defs += fmt.Sprintf(`<filter id="shadow-%s" x="-50%%" y="-50%%" width="200%%" height="200%%"><feDropShadow dx="%s" dy="%s" stdDeviation="%s" flood-color="%s"/></filter>`,
				id, f(s.Num("x")), f(s.Num("y")), f(s.Num("blur")/2), EscapeHTML(jsString(ResolveValue(doc, sc, mode))))
			shadowAttr = fmt.Sprintf(` filter="url(#shadow-%s)"`, id)
		}
		attrs := make([]Attr, len(pathA))
		copy(attrs, pathA)
		for i, a := range attrs {
			if a.Key == "fill" && a.Value != "none" {
				pfill := "none"
				if pf, ok := svgPaint(doc, n, "fill", warn); ok {
					pfill = pf
				}
				attrs[i] = Attr{"fill", pfill}
			}
		}
		var body strings.Builder
		body.WriteString("<g" + shadowAttr + "><path" + svgAttrs(attrs) + "/>")
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
			lh := n.Num("lineHeight") * size
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
			fmt.Fprintf(&body, `<text xml:space="preserve" font-family="%s" font-size="%s" font-weight="%s" fill="%s"%s>%s</text>`,
				EscapeHTML(n.Str("fontFamily")), f(size), jsString(fw), EscapeHTML(jsString(ResolveValue(doc, colorV, mode))), anchor, tspans.String())
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
		if s := n.Obj("shadow"); s != nil && typ != "text" {
			if s.Num("spread") != 0 {
				warn("shadow with spread: SVG uses only offset, blur and color")
			}
			sc, _ := s.Get("color")
			defs += fmt.Sprintf(`<filter id="shadow-%s" x="-50%%" y="-50%%" width="200%%" height="200%%"><feDropShadow dx="%s" dy="%s" stdDeviation="%s" flood-color="%s"/></filter>`,
				id, f(s.Num("x")), f(s.Num("y")), f(s.Num("blur")/2), EscapeHTML(jsString(ResolveValue(doc, sc, ModeOf(doc, n)))))
			shadowAttr = fmt.Sprintf(` filter="url(#shadow-%s)"`, id)
		}
		fill, hasFill := "", false
		if typ != "path" {
			fill, hasFill = svgPaint(doc, n, "fill", warn)
		}
		sw := 0.0
		st := n.Obj("stroke")
		if typ != "path" && st != nil && st.Num("width") > 0 {
			sw = st.Num("width")
		}
		strokeAttr := ""
		if sw != 0 {
			sc, _ := st.Get("color")
			strokeAttr = fmt.Sprintf(` stroke="%s" stroke-width="%s"`, EscapeHTML(jsString(ResolveValue(doc, sc, ModeOf(doc, n)))), f(sw))
		}
		fillVal := "none"
		if hasFill {
			fillVal = fill
		}
		fillAttr := fmt.Sprintf(` fill="%s"`, EscapeHTML(fillVal))
		inset := fmt.Sprintf(`x="%s" y="%s" width="%s" height="%s"`, f(sw/2), f(sw/2), f(math.Max(0, w-sw)), f(math.Max(0, h-sw)))
		r := 0.0
		if typ != "ellipse" && typ != "path" {
			r = math.Min(n.Num("radius"), math.Min(w/2, h/2))
		}
		radius, clipRadius := "", ""
		if r != 0 && !math.IsNaN(r) {
			radius = fmt.Sprintf(` rx="%s"`, f(math.Max(0, r-sw/2)))
			clipRadius = fmt.Sprintf(` rx="%s"`, f(r))
		}
		var body strings.Builder
		switch typ {
		case "frame", "rect", "text", "image":
			if (hasFill && fill != "") || sw != 0 {
				fmt.Fprintf(&body, `<rect %s%s%s%s%s/>`, inset, radius, fillAttr, strokeAttr, shadowAttr)
			} else if shadowAttr != "" {
				fmt.Fprintf(&body, `<rect width="%s" height="%s"%s fill="none"%s/>`, f(w), f(h), radius, shadowAttr)
			}
		case "ellipse":
			fmt.Fprintf(&body, `<ellipse cx="%s" cy="%s" rx="%s" ry="%s"%s%s%s/>`, f(w/2), f(h/2), f(math.Max(0, (w-sw)/2)), f(math.Max(0, (h-sw)/2)), fillAttr, strokeAttr, shadowAttr)
		case "path":
			svgA, pathA := PathAttrs(doc, n)
			attrs := make([]Attr, len(pathA))
			copy(attrs, pathA)
			for i, a := range attrs {
				if a.Key == "fill" {
					pfill := "none"
					if a.Value != "none" {
						if pf, ok := svgPaint(doc, n, "fill", warn); ok {
							pfill = pf
						}
					}
					attrs[i] = Attr{"fill", pfill}
				}
			}
			fmt.Fprintf(&body, `<svg width="%s" height="%s"%s overflow="visible"><path%s%s/></svg>`, f(w), f(h), svgAttrs(svgA), svgAttrs(attrs), shadowAttr)
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
				lh := n.Num("lineHeight") * size
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
				for k, t := range strings.Split(n.Str("text"), "\n") {
					if t != "" {
						fmt.Fprintf(&tspans, `<tspan x="%s" y="%s">%s</tspan>`, f(ax), f(float64(k)*lh+(lh-size)/2+size*0.8), EscapeHTML(t))
					}
				}
			}
			ls := ""
			if v := n.Num("letterSpacing"); v != 0 {
				ls = fmt.Sprintf(` letter-spacing="%s"`, f(v))
			}
			fw, _ := n.Get("fontWeight")
			fmt.Fprintf(&body, `<text xml:space="preserve" font-family="%s" font-size="%s" font-weight="%s" fill="%s"%s%s>%s</text>`,
				EscapeHTML(n.Str("fontFamily")), f(size), jsString(fw), color, ls, anchor, tspans.String())
		}
		if typ == "image" {
			fit := "none"
			switch n.Str("fit") {
			case "cover":
				fit = "xMidYMid slice"
			case "contain":
				fit = "xMidYMid meet"
			}
			src := EscapeHTML(n.Str("src"))
			if n.Num("radius") != 0 {
				defs += fmt.Sprintf(`<clipPath id="clip-%s"><rect width="%s" height="%s"%s/></clipPath>`, id, f(w), f(h), clipRadius)
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
				defs += fmt.Sprintf(`<clipPath id="clip-%s"><rect width="%s" height="%s"%s/></clipPath>`, id, f(w), f(h), clipRadius)
				fmt.Fprintf(&body, `<g clip-path="url(#clip-%s)">%s</g>`, id, inner)
			} else {
				body.WriteString(inner)
			}
		}
		out := open.String()
		if defs != "" {
			out += "<defs>" + defs + "</defs>"
		}
		return out + body.String() + "</g>", nil
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
		if page != nil {
			if v, ok := page.Get("fill"); ok && v != "" && v != nil {
				fill = jsString(ResolveValue(doc, v, page.Str("mode")))
			}
		}
		bg = fmt.Sprintf(`<rect width="%s" height="%s" fill="%s"/>`, f(width), f(height), EscapeHTML(fill))
	}
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">%s%s</svg>`, f(width), f(height), f(width), f(height), bg, content.String())
	return SVGResult{SVG: svg, Width: width, Height: height, Warnings: *warnings}, nil
}
