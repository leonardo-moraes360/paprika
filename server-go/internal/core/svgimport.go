package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/svgImport.ts: SVG → editable nodes (*jsonv.Object, ready for create).

// ImportResult is the nodes to create plus what could not be imported.
type ImportResult struct {
	Nodes    []*jsonv.Object
	Warnings []string
}

// Matrix is an SVG affine matrix [a b c d e f].
type Matrix [6]float64

var identity = Matrix{1, 0, 0, 1, 0, 0}

// Multiply is m·n.
func Multiply(m, n Matrix) Matrix {
	return Matrix{
		m[0]*n[0] + m[2]*n[1],
		m[1]*n[0] + m[3]*n[1],
		m[0]*n[2] + m[2]*n[3],
		m[1]*n[2] + m[3]*n[3],
		m[0]*n[4] + m[2]*n[5] + m[4],
		m[1]*n[4] + m[3]*n[5] + m[5],
	}
}

func applyM(m Matrix, p Point) Point {
	return Point{m[0]*p.X + m[2]*p.Y + m[4], m[1]*p.X + m[3]*p.Y + m[5]}
}

var (
	svgNumRe       = regexp.MustCompile(`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`)
	svgTransformRe = regexp.MustCompile(`([a-zA-Z]+)[` + jsWS + `]*\(([^)]*)\)`)
	svgURLRe       = regexp.MustCompile(`(?i)url\(`)
)

func svgNumbers(s string) []float64 {
	var out []float64
	for _, m := range svgNumRe.FindAllString(s, -1) {
		out = append(out, jsonv.ToNumber(m))
	}
	return out
}

func at0(v []float64, i int, def float64) float64 {
	if i < len(v) {
		return v[i]
	}
	return def
}

// ParseTransform reads the transform attribute (matrix, translate, scale, rotate, skewX, skewY).
func ParseTransform(s string, warn func(string)) Matrix {
	m := identity
	if s == "" {
		return m
	}
	for _, hit := range svgTransformRe.FindAllStringSubmatch(s, -1) {
		name := hit[1]
		v := svgNumbers(hit[2])
		var t *Matrix
		rad := at0(v, 0, 0) * math.Pi / 180
		switch name {
		case "matrix":
			if len(v) == 6 {
				t = &Matrix{v[0], v[1], v[2], v[3], v[4], v[5]}
			}
		case "translate":
			t = &Matrix{1, 0, 0, 1, at0(v, 0, 0), at0(v, 1, 0)}
		case "scale":
			sx := at0(v, 0, 1)
			t = &Matrix{sx, 0, 0, at0(v, 1, sx), 0, 0}
		case "rotate":
			r := Matrix{math.Cos(rad), math.Sin(rad), -math.Sin(rad), math.Cos(rad), 0, 0}
			cx, cy := at0(v, 1, 0), at0(v, 2, 0)
			x := Multiply(Multiply(Matrix{1, 0, 0, 1, cx, cy}, r), Matrix{1, 0, 0, 1, -cx, -cy})
			t = &x
		case "skewX":
			t = &Matrix{1, 0, math.Tan(rad), 1, 0, 0}
		case "skewY":
			t = &Matrix{1, math.Tan(rad), 0, 1, 0, 0}
		}
		if t != nil {
			m = Multiply(m, *t)
		} else {
			warn(fmt.Sprintf("transform \"%s\" is invalid; skipped", name))
		}
	}
	return m
}

// ArcToCubics converts an endpoint-form arc into cubic beziers (SVG 1.1, appendix F.6).
func ArcToCubics(from Point, s Segment) []Segment {
	rx, ry := math.Abs(s.Rx), math.Abs(s.Ry)
	if rx == 0 || ry == 0 {
		return []Segment{{Cmd: 'L', To: s.To}}
	}
	if from.X == s.To.X && from.Y == s.To.Y {
		return nil
	}
	phi := s.Rot * math.Pi / 180
	cos, sin := math.Cos(phi), math.Sin(phi)
	dx := (from.X - s.To.X) / 2
	dy := (from.Y - s.To.Y) / 2
	x1 := cos*dx + sin*dy
	y1 := -sin*dx + cos*dy
	lambda := (x1*x1)/(rx*rx) + (y1*y1)/(ry*ry)
	if lambda > 1 {
		rx *= math.Sqrt(lambda)
		ry *= math.Sqrt(lambda)
	}
	num := rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1
	den := rx*rx*y1*y1 + ry*ry*x1*x1
	sign := 1.0
	if s.LargeArc == s.Sweep {
		sign = -1
	}
	k := sign * math.Sqrt(math.Max(0, num/den))
	cx1 := (k * rx * y1) / ry
	cy1 := (-k * ry * x1) / rx
	cx := cos*cx1 - sin*cy1 + (from.X+s.To.X)/2
	cy := sin*cx1 + cos*cy1 + (from.Y+s.To.Y)/2
	angle := func(ux, uy, vx, vy float64) float64 { return math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy) }
	t1 := angle(1, 0, (x1-cx1)/rx, (y1-cy1)/ry)
	dt := angle((x1-cx1)/rx, (y1-cy1)/ry, (-x1-cx1)/rx, (-y1-cy1)/ry)
	if !s.Sweep && dt > 0 {
		dt -= 2 * math.Pi
	}
	if s.Sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	n := int(math.Max(1, math.Ceil(math.Abs(dt)/(math.Pi/2)-1e-9)))
	step := dt / float64(n)
	alpha := (4.0 / 3) * math.Tan(step/4)
	pt := func(t float64) Point {
		return Point{cx + rx*math.Cos(t)*cos - ry*math.Sin(t)*sin, cy + rx*math.Cos(t)*sin + ry*math.Sin(t)*cos}
	}
	deriv := func(t float64) Point {
		return Point{-rx*math.Sin(t)*cos - ry*math.Cos(t)*sin, -rx*math.Sin(t)*sin + ry*math.Cos(t)*cos}
	}
	out := make([]Segment, 0, n)
	for j := 0; j < n; j++ {
		a := t1 + step*float64(j)
		b := a + step
		p0 := pt(a)
		p3 := s.To
		if j != n-1 {
			p3 = pt(b)
		}
		d0, d1 := deriv(a), deriv(b)
		out = append(out, Segment{
			Cmd: 'C',
			C1:  Point{p0.X + alpha*d0.X, p0.Y + alpha*d0.Y},
			C2:  Point{p3.X - alpha*d1.X, p3.Y - alpha*d1.Y},
			To:  p3,
		})
	}
	return out
}

// TranslatePath moves absolute segments by dx, dy.
func TranslatePath(segs []Segment, dx, dy float64) []Segment {
	t := func(p Point) Point { return Point{p.X + dx, p.Y + dy} }
	out := make([]Segment, len(segs))
	for i, s := range segs {
		switch s.Cmd {
		case 'M', 'L', 'A':
			s.To = t(s.To)
		case 'C':
			s.C1, s.C2, s.To = t(s.C1), t(s.C2), t(s.To)
		case 'Q':
			s.C, s.To = t(s.C), t(s.To)
		}
		out[i] = s
	}
	return out
}

// TransformPath applies m to absolute segments; arcs become cubics unless m is a translation.
func TransformPath(segs []Segment, m Matrix) []Segment {
	if m[0] == 1 && m[1] == 0 && m[2] == 0 && m[3] == 1 {
		return TranslatePath(segs, m[4], m[5])
	}
	var out []Segment
	var cur, start Point
	t := func(p Point) Point { return applyM(m, p) }
	for _, s := range segs {
		switch s.Cmd {
		case 'M':
			out = append(out, Segment{Cmd: 'M', To: t(s.To)})
			cur, start = s.To, s.To
		case 'L':
			out = append(out, Segment{Cmd: 'L', To: t(s.To)})
			cur = s.To
		case 'C':
			out = append(out, Segment{Cmd: 'C', C1: t(s.C1), C2: t(s.C2), To: t(s.To)})
			cur = s.To
		case 'Q':
			out = append(out, Segment{Cmd: 'Q', C: t(s.C), To: t(s.To)})
			cur = s.To
		case 'A':
			for _, c := range ArcToCubics(cur, s) {
				if c.Cmd == 'C' {
					out = append(out, Segment{Cmd: 'C', C1: t(c.C1), C2: t(c.C2), To: t(c.To)})
				} else if c.Cmd == 'L' {
					out = append(out, Segment{Cmd: 'L', To: t(c.To)})
				}
			}
			cur = s.To
		case 'Z':
			out = append(out, s)
			cur = start
		}
	}
	return out
}

type paint struct {
	fill, stroke               *string
	strokeWidth                float64
	fillRule, cap, join        string
	fillOpacity, strokeOpacity float64
}

func strp(s string) *string { return &s }

var (
	inheritDefault = paint{fill: strp("#000000"), strokeWidth: 1, fillRule: "nonzero", cap: "butt", join: "miter", fillOpacity: 1, strokeOpacity: 1}
	svgSkip        = map[string]bool{"defs": true, "title": true, "desc": true, "metadata": true, "style": true, "script": true, "clippath": true, "lineargradient": true, "radialgradient": true, "symbol": true, "marker": true, "pattern": true, "mask": true, "filter": true}
	svgContainers  = map[string]bool{"g": true, "a": true, "svg": true, "switch": true}
	svgShapes      = map[string]bool{"path": true, "rect": true, "circle": true, "ellipse": true, "line": true, "polyline": true, "polygon": true}
)

// svgNum is num(): parseFloat with a fallback for absent or non-finite values.
func svgNum(s string, ok bool, fallback float64) float64 {
	if !ok {
		return fallback
	}
	v := jsonv.ParseFloat(s)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fallback
	}
	return v
}

func attrNum(e *MarkupElement, k string) float64 {
	v, ok := e.Attrs[k]
	return svgNum(v, ok, 0)
}

func clamp01(v float64) float64 { return math.Min(1, math.Max(0, v)) }

func withAlpha(color string, alpha float64, warn func(string)) string {
	if alpha >= 1 {
		return color
	}
	c, ok := ParseColor(color)
	if !ok {
		warn(fmt.Sprintf("opacity of \"%s\" skipped (unrecognized color)", color))
		return color
	}
	f := jsonv.FormatNumber
	return fmt.Sprintf("rgba(%s, %s, %s, %s)", f(c.R), f(c.G), f(c.B), f(Round4(c.A*alpha)))
}

func cleanColor(v string, warn func(string)) *string {
	s := jsonv.Trim(v)
	if s == "none" || s == "transparent" {
		return nil
	}
	if s == "currentColor" || s == "currentcolor" {
		return strp("#000000")
	}
	if svgURLRe.MatchString(s) {
		warn("gradients and patterns (url(#…)) are not imported; using gray")
		return strp("#808080")
	}
	if strings.ContainsAny(s, ";{}<>") || jsonv.Len16(s) > 200 {
		warn(fmt.Sprintf("invalid color \"%s\" skipped", jsonv.Slice16(s, 40)))
		return strp("#000000")
	}
	return &s
}

// styleOrAttr is css[k] ?? attrs[k].
func styleOrAttr(css map[string]string, e *MarkupElement, k string) (string, bool) {
	if v, ok := css[k]; ok {
		return v, true
	}
	v, ok := e.Attrs[k]
	return v, ok
}

func paintOf(e *MarkupElement, parent paint, warn func(string)) paint {
	css := ParseStyle(e.Attrs["style"])
	get := func(k string) (string, bool) { return styleOrAttr(css, e, k) }
	p := parent
	if v, ok := get("fill"); ok && v != "inherit" {
		p.fill = cleanColor(v, warn)
	}
	if v, ok := get("stroke"); ok && v != "inherit" {
		p.stroke = cleanColor(v, warn)
	}
	if v, ok := get("stroke-width"); ok {
		p.strokeWidth = math.Max(0, svgNum(v, true, 1))
	}
	if v, _ := get("fill-rule"); v == "evenodd" || v == "nonzero" {
		p.fillRule = v
	}
	if v, _ := get("stroke-linecap"); v == "butt" || v == "round" || v == "square" {
		p.cap = v
	}
	if v, _ := get("stroke-linejoin"); v == "miter" || v == "round" || v == "bevel" {
		p.join = v
	}
	if v, ok := get("fill-opacity"); ok {
		p.fillOpacity = clamp01(svgNum(v, true, 1))
	}
	if v, ok := get("stroke-opacity"); ok {
		p.strokeOpacity = clamp01(svgNum(v, true, 1))
	}
	return p
}

func svgHidden(e *MarkupElement) bool {
	css := ParseStyle(e.Attrs["style"])
	d, _ := styleOrAttr(css, e, "display")
	v, _ := styleOrAttr(css, e, "visibility")
	return d == "none" || v == "hidden"
}

func opacityOf(e *MarkupElement) float64 {
	css := ParseStyle(e.Attrs["style"])
	v, ok := styleOrAttr(css, e, "opacity")
	return clamp01(svgNum(v, ok, 1))
}

func nameOf(e *MarkupElement) string {
	var n string
	found := false
	for _, c := range e.Elements() {
		if c.Tag == "title" {
			n = TextContent(c)
			found = true
			break
		}
	}
	if !found {
		n = e.Attrs["id"]
	}
	return jsonv.Slice16(jsonv.Trim(n), 200)
}

func shapeSegments(e *MarkupElement) ([]Segment, error) {
	a := e.Attrs
	switch e.Tag {
	case "path":
		return ParsePath(a["d"])
	case "rect":
		x, y, w, h := attrNum(e, "x"), attrNum(e, "y"), attrNum(e, "width"), attrNum(e, "height")
		if w <= 0 || h <= 0 {
			return nil, nil
		}
		_, hasRx := a["rx"]
		_, hasRy := a["ry"]
		rx := 0.0
		if hasRx {
			rx = attrNum(e, "rx")
		} else if hasRy {
			rx = attrNum(e, "ry")
		}
		ry := rx
		if hasRy {
			ry = attrNum(e, "ry")
		}
		rx = math.Min(math.Max(0, rx), w/2)
		ry = math.Min(math.Max(0, ry), h/2)
		if rx == 0 || ry == 0 || math.IsNaN(rx) || math.IsNaN(ry) {
			return []Segment{
				{Cmd: 'M', To: Point{x, y}},
				{Cmd: 'L', To: Point{x + w, y}},
				{Cmd: 'L', To: Point{x + w, y + h}},
				{Cmd: 'L', To: Point{x, y + h}},
				{Cmd: 'Z'},
			}, nil
		}
		arc := func(to Point) Segment { return Segment{Cmd: 'A', Rx: rx, Ry: ry, Sweep: true, To: to} }
		return []Segment{
			{Cmd: 'M', To: Point{x + rx, y}},
			{Cmd: 'L', To: Point{x + w - rx, y}},
			arc(Point{x + w, y + ry}),
			{Cmd: 'L', To: Point{x + w, y + h - ry}},
			arc(Point{x + w - rx, y + h}),
			{Cmd: 'L', To: Point{x + rx, y + h}},
			arc(Point{x, y + h - ry}),
			{Cmd: 'L', To: Point{x, y + ry}},
			arc(Point{x + rx, y}),
			{Cmd: 'Z'},
		}, nil
	case "circle", "ellipse":
		cx, cy := attrNum(e, "cx"), attrNum(e, "cy")
		rx, ry := attrNum(e, "rx"), attrNum(e, "ry")
		if e.Tag == "circle" {
			rx, ry = attrNum(e, "r"), attrNum(e, "r")
		}
		if rx <= 0 || ry <= 0 {
			return nil, nil
		}
		arc := func(to Point) Segment { return Segment{Cmd: 'A', Rx: rx, Ry: ry, Sweep: true, To: to} }
		return []Segment{{Cmd: 'M', To: Point{cx + rx, cy}}, arc(Point{cx - rx, cy}), arc(Point{cx + rx, cy}), {Cmd: 'Z'}}, nil
	case "line":
		return []Segment{
			{Cmd: 'M', To: Point{attrNum(e, "x1"), attrNum(e, "y1")}},
			{Cmd: 'L', To: Point{attrNum(e, "x2"), attrNum(e, "y2")}},
		}, nil
	default:
		v := svgNumbers(a["points"])
		var segs []Segment
		for k := 0; k+1 < len(v); k += 2 {
			cmd := byte('L')
			if k == 0 {
				cmd = 'M'
			}
			segs = append(segs, Segment{Cmd: cmd, To: Point{v[k], v[k+1]}})
		}
		if e.Tag == "polygon" && len(segs) > 0 {
			segs = append(segs, Segment{Cmd: 'Z'})
		}
		return segs, nil
	}
}

func strokeOf(p paint, scale float64, warn func(string)) *jsonv.Object {
	if p.stroke == nil || *p.stroke == "" || !(p.strokeWidth > 0) {
		return nil
	}
	return jsonv.NewObject("color", withAlpha(*p.stroke, p.strokeOpacity, warn), "width", Round4(p.strokeWidth*scale))
}

func shapeNode(e *MarkupElement, m Matrix, p paint, warn func(string)) *jsonv.Object {
	name := nameOf(e)
	opacity := opacityOf(e)
	fill := ""
	if p.fill != nil && *p.fill != "" {
		fill = withAlpha(*p.fill, p.fillOpacity, warn)
	}
	common := func(node *jsonv.Object) {
		if name != "" {
			node.Set("name", name)
		}
		if opacity != 1 {
			node.Set("opacity", Round4(opacity))
		}
	}
	axis := m[1] == 0 && m[2] == 0 && m[0] > 0 && m[3] > 0
	a := e.Attrs
	if axis && (e.Tag == "rect" || e.Tag == "circle" || e.Tag == "ellipse") {
		rx := attrNum(e, "rx")
		if e.Tag == "circle" {
			rx = attrNum(e, "r")
		}
		ry := rx
		if e.Tag == "circle" {
			ry = attrNum(e, "r")
		} else if _, ok := a["ry"]; ok {
			ry = attrNum(e, "ry")
		}
		_, hasRx := a["rx"]
		_, hasRy := a["ry"]
		uniform := e.Tag != "rect" || ((!hasRx || !hasRy || rx == ry) && m[0] == m[3])
		if uniform {
			isRect := e.Tag == "rect"
			var x0, y0, w, h float64
			if isRect {
				x0, y0, w, h = attrNum(e, "x"), attrNum(e, "y"), attrNum(e, "width"), attrNum(e, "height")
			} else {
				x0, y0, w, h = attrNum(e, "cx")-rx, attrNum(e, "cy")-ry, 2*rx, 2*ry
			}
			if !(w > 0) || !(h > 0) {
				return nil
			}
			pt := applyM(m, Point{x0, y0})
			typ := "ellipse"
			if isRect {
				typ = "rect"
			}
			node := jsonv.NewObject("type", typ)
			common(node)
			node.Set("x", Round4(pt.X))
			node.Set("y", Round4(pt.Y))
			node.Set("width", Round4(w*m[0]))
			node.Set("height", Round4(h*m[3]))
			if isRect && rx > 0 {
				node.Set("radius", Round4(math.Min(rx, math.Min(w/2, h/2))*m[0]))
			}
			if fill != "" {
				node.Set("fill", fill)
			}
			if st := strokeOf(p, math.Sqrt(m[0]*m[3]), warn); st != nil {
				node.Set("stroke", st)
			}
			return node
		}
	}
	segs, err := shapeSegments(e)
	if err != nil {
		warn(fmt.Sprintf("<%s> with invalid geometry skipped: %s", e.Tag, err.Error()))
		return nil
	}
	if len(segs) < 2 {
		return nil
	}
	segs = TransformPath(segs, m)
	b := PathBounds(segs)
	d := SerializePath(TranslatePath(segs, -b.X, -b.Y))
	node := jsonv.NewObject("type", "path")
	common(node)
	node.Set("x", Round4(b.X))
	node.Set("y", Round4(b.Y))
	node.Set("d", d)
	if fill != "" && e.Tag != "line" {
		node.Set("fill", fill)
	}
	if st := strokeOf(p, math.Sqrt(math.Abs(m[0]*m[3]-m[1]*m[2])), warn); st != nil {
		node.Set("stroke", st)
		if p.cap != "round" {
			node.Set("strokeCap", p.cap)
		}
		if p.join != "round" {
			node.Set("strokeJoin", p.join)
		}
	}
	if p.fillRule != "nonzero" {
		node.Set("fillRule", p.fillRule)
	}
	return node
}

func rootMatrix(svg *MarkupElement) Matrix {
	vb := svgNumbers(svg.Attrs["viewbox"])
	if len(vb) != 4 || !(vb[2] > 0) || !(vb[3] > 0) {
		return identity
	}
	vx, vy, vw, vh := vb[0], vb[1], vb[2], vb[3]
	dim := func(k string, def float64) float64 {
		v := svg.Attrs[k]
		if v != "" && !strings.Contains(v, "%") {
			return svgNum(v, true, def)
		}
		return def
	}
	w, h := dim("width", vw), dim("height", vh)
	s := math.Min(w/vw, h/vh)
	return Matrix{s, 0, 0, s, (w-vw*s)/2 - vx*s, (h-vh*s)/2 - vy*s}
}

func convertSVG(e *MarkupElement, m Matrix, p paint, warn func(string)) []*jsonv.Object {
	var out []*jsonv.Object
	for _, c := range e.Elements() {
		if svgSkip[c.Tag] {
			if c.Tag == "style" {
				warn("CSS in <style> is not applied; use attributes or style=\"\" on the elements")
			}
			continue
		}
		if svgHidden(c) {
			continue
		}
		if c.Attrs["clip-path"] != "" || c.Attrs["mask"] != "" {
			warn(fmt.Sprintf("clip-path/mask on <%s> skipped", c.Tag))
		}
		cm := Multiply(m, ParseTransform(c.Attrs["transform"], warn))
		cp := paintOf(c, p, warn)
		if svgContainers[c.Tag] {
			km := cm
			if c.Tag == "svg" {
				km = Multiply(cm, Matrix{1, 0, 0, 1, attrNum(c, "x"), attrNum(c, "y")})
			}
			kids := convertSVG(c, km, cp, warn)
			if len(kids) == 0 {
				continue
			}
			opacity := opacityOf(c)
			name := nameOf(c)
			if len(kids) == 1 && opacity == 1 && name == "" {
				out = append(out, kids[0])
				continue
			}
			g := jsonv.NewObject("type", "group", "children", nodesAny(kids))
			if name != "" {
				g.Set("name", name)
			}
			if opacity != 1 {
				g.Set("opacity", Round4(opacity))
			}
			out = append(out, g)
			continue
		}
		if svgShapes[c.Tag] {
			if n := shapeNode(c, cm, cp, warn); n != nil {
				out = append(out, n)
			}
			continue
		}
		warn(fmt.Sprintf("<%s> is not imported", c.Tag))
	}
	return out
}

func nodesAny(nodes []*jsonv.Object) []any {
	out := make([]any, len(nodes))
	for i, n := range nodes {
		out[i] = n
	}
	return out
}

// offsetNodes shifts top-level nodes (SVG coordinates) by dx, dy.
func offsetNodes(nodes []any, dx, dy float64) {
	for _, v := range nodes {
		n := v.(*jsonv.Object)
		if n.Str("type") == "group" {
			offsetNodes(n.Arr("children"), dx, dy)
		} else {
			n.Set("x", Round4(n.Num("x")+dx))
			n.Set("y", Round4(n.Num("y")+dy))
		}
	}
}

// ImportOptions shifts the SVG origin and names the result.
type ImportOptions struct {
	X, Y float64
	Name *string
}

func newWarner() (*[]string, func(string)) {
	warnings := []string{}
	return &warnings, func(w string) {
		for _, x := range warnings {
			if x == w {
				return
			}
		}
		warnings = append(warnings, w)
	}
}

// ImportSVG converts SVG markup (a string or a parsed element) into one node ready for create.
func ImportSVG(src any, opts ImportOptions) (ImportResult, error) {
	warnings, warn := newWarner()
	var root *MarkupElement
	switch s := src.(type) {
	case string:
		r, err := ParseMarkup(s)
		if err != nil {
			return ImportResult{}, err
		}
		root = r
	case *MarkupElement:
		root = s
	}
	svg := root
	if root.Tag != "svg" {
		svg = FindElement(root, "svg")
	}
	if svg == nil {
		return ImportResult{}, fmt.Errorf("no <svg> element found")
	}
	m := Multiply(rootMatrix(svg), ParseTransform(svg.Attrs["transform"], warn))
	p := paintOf(svg, inheritDefault, warn)
	nodes := convertSVG(svg, m, p, warn)
	offsetNodes(nodesAny(nodes), opts.X, opts.Y)
	if len(nodes) == 0 {
		if len(*warnings) == 0 {
			return ImportResult{Nodes: nil, Warnings: []string{"the SVG has no shapes to import"}}, nil
		}
		return ImportResult{Nodes: nil, Warnings: *warnings}, nil
	}
	name := nameOf(svg)
	if opts.Name != nil {
		name = *opts.Name
	}
	if name == "" {
		name = "SVG"
	}
	opacity := opacityOf(svg)
	if len(nodes) > 1 || opacity != 1 {
		g := jsonv.NewObject("type", "group", "name", name, "children", nodesAny(nodes))
		if opacity != 1 {
			g.Set("opacity", Round4(opacity))
		}
		nodes = []*jsonv.Object{g}
	} else if nodes[0].Str("name") == "" {
		nodes[0].Set("name", name)
	}
	return ImportResult{Nodes: nodes, Warnings: *warnings}, nil
}
