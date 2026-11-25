package core

import (
	"math"
	"slices"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func nodeGradient(n *Node) *jsonv.Object {
	if n == nil {
		return nil
	}
	switch n.Str("type") {
	case "group", "connector":
		return nil
	}
	return n.Obj("gradient")
}

func gradientStops(g *jsonv.Object) []*jsonv.Object {
	arr := g.Arr("stops")
	out := make([]*jsonv.Object, 0, len(arr))
	for _, v := range arr {
		if o, ok := v.(*jsonv.Object); ok {
			out = append(out, o)
		}
	}
	slices.SortStableFunc(out, func(a, b *jsonv.Object) int {
		ao, bo := a.Num("offset"), b.Num("offset")
		if ao < bo {
			return -1
		}
		if ao > bo {
			return 1
		}
		return 0
	})
	return out
}

func gradientCSS(doc *Document, g *jsonv.Object, mode string, vars bool) string {
	parts := make([]string, 0, len(g.Arr("stops")))
	for _, s := range gradientStops(g) {
		color, _ := s.Get("color")
		parts = append(parts, jsString(paintValue(doc, color, mode, vars))+" "+jsonv.FormatNumber(round2(s.Num("offset")*100))+"%")
	}
	stops := strings.Join(parts, ", ")
	angle := jsonv.FormatNumber(round2(g.Num("angle")))
	cx := jsonv.FormatNumber(round2(g.Num("cx") * 100))
	cy := jsonv.FormatNumber(round2(g.Num("cy") * 100))
	switch g.Str("type") {
	case "radial":
		r := jsonv.FormatNumber(round2(g.Num("radius") * 100))
		return "radial-gradient(ellipse " + r + "% " + r + "% at " + cx + "% " + cy + "%, " + stops + ")"
	case "conic":
		return "conic-gradient(from " + angle + "deg at " + cx + "% " + cy + "%, " + stops + ")"
	default:
		return "linear-gradient(" + angle + "deg, " + stops + ")"
	}
}

func gradientLine(angle, w, h float64) (x1, y1, x2, y2 float64) {
	rad := angle * math.Pi / 180
	dx := math.Sin(rad)
	dy := -math.Cos(rad)
	tx, ty := math.Inf(1), math.Inf(1)
	if dx != 0 {
		tx = w / 2 / math.Abs(dx)
	}
	if dy != 0 {
		ty = h / 2 / math.Abs(dy)
	}
	t := math.Min(tx, ty)
	return (w/2 - dx*t) / w, (h/2 - dy*t) / h, (w/2 + dx*t) / w, (h/2 + dy*t) / h
}

func xmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
}

func gradientStopXML(doc *Document, g *jsonv.Object, mode string, vars bool) string {
	var b strings.Builder
	for _, s := range gradientStops(g) {
		color, _ := s.Get("color")
		b.WriteString(`<stop offset="` + jsonv.FormatNumber(round2(s.Num("offset")*100)) + `%" stop-color="` + xmlEscape(jsString(paintValue(doc, color, mode, vars))) + `"/>`)
	}
	return b.String()
}

func svgGradientInner(doc *Document, node *Node, w, h float64, vars bool) (fill, inner string, ok bool) {
	g := nodeGradient(node)
	if g == nil {
		return "", "", false
	}
	mode := ModeOf(doc, node)
	id := xmlEscape("paprika-g-" + node.Str("id"))
	stops := gradientStopXML(doc, g, mode, vars)
	switch g.Str("type") {
	case "linear", "radial":
		bw, bh := w, h
		if bw <= 0 {
			bw = 1
		}
		if bh <= 0 {
			bh = 1
		}
		var el string
		if g.Str("type") == "linear" {
			x1, y1, x2, y2 := gradientLine(g.Num("angle"), bw, bh)
			el = `<linearGradient id="` + id + `" gradientUnits="objectBoundingBox" x1="` + jsonv.FormatNumber(round2(x1)) + `" y1="` + jsonv.FormatNumber(round2(y1)) + `" x2="` + jsonv.FormatNumber(round2(x2)) + `" y2="` + jsonv.FormatNumber(round2(y2)) + `">` + stops + `</linearGradient>`
		} else {
			el = `<radialGradient id="` + id + `" gradientUnits="objectBoundingBox" cx="` + jsonv.FormatNumber(round2(g.Num("cx"))) + `" cy="` + jsonv.FormatNumber(round2(g.Num("cy"))) + `" r="` + jsonv.FormatNumber(round2(g.Num("radius"))) + `">` + stops + `</radialGradient>`
		}
		return "url(#" + id + ")", "<defs>" + el + "</defs>", true
	default:
		css := xmlEscape(gradientCSS(doc, g, mode, vars))
		maskID := xmlEscape("paprika-gm-" + node.Str("id"))
		mask, maskAttr := "", ""
		switch node.Str("type") {
		case "path":
			mask = `<mask id="` + maskID + `"><path d="` + xmlEscape(node.Str("d")) + `" fill="white" fill-rule="` + node.Str("fillRule") + `"/></mask>`
			maskAttr = ` mask="url(#` + maskID + `)"`
		case "shape":
			o := lengthsResolved(doc, node)
			d, _ := ShapeOutline(o)
			mask = `<mask id="` + maskID + `"><path d="` + xmlEscape(d) + `" fill="white"/></mask>`
			maskAttr = ` mask="url(#` + maskID + `)"`
		case "ellipse":
			mask = `<mask id="` + maskID + `"><ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="white"/></mask>`
			maskAttr = ` mask="url(#` + maskID + `)"`
		}
		under := `<foreignObject x="0" y="0" width="100%" height="100%"` + maskAttr + `><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:` + css + `"></div></foreignObject>`
		defs := ""
		if mask != "" {
			defs = "<defs>" + mask + "</defs>"
		}
		return "none", defs + under, true
	}
}
