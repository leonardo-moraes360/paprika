package core

import (
	"fmt"
	"math"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const (
	OutlineFlat = 0.05
	MiterLimit  = 4.0
)

type StrokeOutlineParams struct {
	Width     float64
	Cap, Join string
}

type strokePoly struct {
	pts    []Point
	closed bool
}

const strokeTiny = 1e-9

func strokeNear(a, b Point) bool { return math.Abs(a.X-b.X) < 1e-6 && math.Abs(a.Y-b.Y) < 1e-6 }

func flattenPolys(segs []Segment) []strokePoly {
	var out []strokePoly
	var cur *strokePoly
	drew := false
	var pos, start Point
	push := func(p Point) {
		if cur == nil {
			cur = &strokePoly{pts: []Point{start}}
			drew = false
		}
		if !strokeNear(cur.pts[len(cur.pts)-1], p) {
			cur.pts = append(cur.pts, p)
		}
		drew = true
	}
	finish := func(closed bool) {
		if cur == nil {
			return
		}
		cur.closed = closed
		if closed && len(cur.pts) > 1 && strokeNear(cur.pts[0], cur.pts[len(cur.pts)-1]) {
			cur.pts = cur.pts[:len(cur.pts)-1]
		}
		if len(cur.pts) > 1 || drew {
			out = append(out, *cur)
		}
		cur = nil
	}
	for _, s := range segs {
		switch s.Cmd {
		case 'M':
			finish(false)
			start, pos = s.To, s.To
			cur = &strokePoly{pts: []Point{s.To}}
			drew = false
			continue
		case 'Z':
			if cur != nil {
				drew = true
				finish(true)
			}
			pos = start
			continue
		}
		if cur == nil {
			cur = &strokePoly{pts: []Point{start}}
		}
		switch s.Cmd {
		case 'L':
			push(s.To)
		case 'C':
			var pts []Point
			flattenCubicTol(pos, s.C1, s.C2, s.To, &pts, OutlineFlat)
			for _, p := range pts {
				push(p)
			}
			drew = true
		case 'Q':
			var pts []Point
			flattenQuadTol(pos, s.C, s.To, &pts, OutlineFlat)
			for _, p := range pts {
				push(p)
			}
			drew = true
		default:
			for _, p := range arcToCubicTol(pos, s, OutlineFlat) {
				push(p)
			}
			drew = true
		}
		pos = s.To
	}
	finish(false)
	return out
}

func strokeArcStep(hw float64) float64 {
	if hw <= OutlineFlat {
		return math.Pi / 2
	}
	return math.Min(math.Pi/2, 2*math.Acos(1-OutlineFlat/hw))
}

func strokeArcPoints(c Point, hw, a0, delta float64, out *[]Point) {
	steps := int(math.Max(1, math.Ceil(math.Abs(delta)/strokeArcStep(hw))))
	for k := 1; k < steps; k++ {
		a := a0 + (delta*float64(k))/float64(steps)
		*out = append(*out, Point{c.X + hw*math.Cos(a), c.Y + hw*math.Sin(a)})
	}
}

func strokeUnit(a, b Point) Point {
	dx, dy := b.X-a.X, b.Y-a.Y
	l := math.Hypot(dx, dy)
	return Point{dx / l, dy / l}
}

func strokeJoinPoints(p, d0, d1 Point, hw float64, join string, out *[]Point) {
	n0 := Point{-d0.Y, d0.X}
	n1 := Point{-d1.Y, d1.X}
	a := Point{p.X + n0.X*hw, p.Y + n0.Y*hw}
	b := Point{p.X + n1.X*hw, p.Y + n1.Y*hw}
	cr := d0.X*d1.Y - d0.Y*d1.X
	dt := d0.X*d1.X + d0.Y*d1.Y
	if math.Abs(cr) <= strokeTiny && dt > 0 {
		*out = append(*out, a)
		return
	}
	if cr > strokeTiny {
		*out = append(*out, a, p, b)
		return
	}
	turn := math.Pi
	if math.Abs(cr) > strokeTiny {
		turn = math.Abs(math.Atan2(cr, dt))
	}
	switch {
	case join == "round":
		*out = append(*out, a)
		strokeArcPoints(p, hw, math.Atan2(n0.Y, n0.X), -turn, out)
		*out = append(*out, b)
	case join == "miter" && turn < math.Pi-1e-6 && 1/math.Cos(turn/2) <= MiterLimit:
		k := hw / (1 + dt)
		*out = append(*out, a, Point{p.X + (n0.X+n1.X)*k, p.Y + (n0.Y+n1.Y)*k}, b)
	default:
		*out = append(*out, a, b)
	}
}

func strokeCapPoints(p, v Point, hw float64, cap string, out *[]Point) {
	n := Point{-v.Y, v.X}
	switch cap {
	case "square":
		*out = append(*out, Point{p.X + (n.X+v.X)*hw, p.Y + (n.Y+v.Y)*hw}, Point{p.X + (v.X-n.X)*hw, p.Y + (v.Y-n.Y)*hw})
	case "round":
		strokeArcPoints(p, hw, math.Atan2(n.Y, n.X), -math.Pi, out)
	}
}

func strokeLeftSide(pts []Point, closed bool, hw float64, join string) []Point {
	n := len(pts)
	var out []Point
	count := n - 1
	if closed {
		count = n
	}
	dirs := make([]Point, count)
	for i := 0; i < count; i++ {
		dirs[i] = strokeUnit(pts[i], pts[(i+1)%n])
	}
	if !closed {
		out = append(out, Point{pts[0].X - dirs[0].Y*hw, pts[0].Y + dirs[0].X*hw})
	}
	from, to := 1, n-1
	if closed {
		from, to = 0, n
	}
	for i := from; i < to; i++ {
		strokeJoinPoints(pts[i], dirs[(i+count-1)%count], dirs[i%count], hw, join, &out)
	}
	if !closed {
		last := dirs[count-1]
		out = append(out, Point{pts[n-1].X - last.Y*hw, pts[n-1].Y + last.X*hw})
	}
	return out
}

func strokeDot(p Point, hw float64, cap string) []Point {
	switch cap {
	case "butt":
		return nil
	case "square":
		return []Point{{p.X - hw, p.Y - hw}, {p.X + hw, p.Y - hw}, {p.X + hw, p.Y + hw}, {p.X - hw, p.Y + hw}}
	}
	out := []Point{{p.X + hw, p.Y}}
	strokeArcPoints(p, hw, 0, 2*math.Pi, &out)
	return out
}

func reversedPoints(pts []Point) []Point {
	out := make([]Point, len(pts))
	for i, p := range pts {
		out[len(pts)-1-i] = p
	}
	return out
}

func OutlineStrokeRings(segs []Segment, params StrokeOutlineParams) [][]Point {
	hw := params.Width / 2
	if !(hw > 0) {
		return nil
	}
	var rings [][]Point
	for _, poly := range flattenPolys(segs) {
		pts := poly.pts
		n := len(pts)
		if n == 1 {
			if r := strokeDot(pts[0], hw, params.Cap); len(r) > 0 {
				rings = append(rings, r)
			}
			continue
		}
		if poly.closed {
			rings = append(rings, strokeLeftSide(pts, true, hw, params.Join))
			rings = append(rings, strokeLeftSide(reversedPoints(pts), true, hw, params.Join))
			continue
		}
		ring := strokeLeftSide(pts, false, hw, params.Join)
		strokeCapPoints(pts[n-1], strokeUnit(pts[n-2], pts[n-1]), hw, params.Cap, &ring)
		ring = append(ring, strokeLeftSide(reversedPoints(pts), false, hw, params.Join)...)
		strokeCapPoints(pts[0], strokeUnit(pts[1], pts[0]), hw, params.Cap, &ring)
		rings = append(rings, ring)
	}
	return rings
}

func OutlineStrokeD(segs []Segment, params StrokeOutlineParams) string {
	var out []Segment
	for _, r := range OutlineStrokeRings(segs, params) {
		out = append(out, Segment{Cmd: 'M', To: r[0]})
		for _, p := range r[1:] {
			out = append(out, Segment{Cmd: 'L', To: p})
		}
		out = append(out, Segment{Cmd: 'Z'})
	}
	return SerializePath(out)
}

func mapViewBoxSegs(segs []Segment, vb [4]float64, w, h float64) []Segment {
	k := math.Min(w/vb[2], h/vb[3])
	out := make([]Segment, len(segs))
	for i, s := range segs {
		mp := func(p Point) Point { return applyViewBox(p, vb, w, h) }
		switch s.Cmd {
		case 'M', 'L':
			s.To = mp(s.To)
		case 'C':
			s.C1, s.C2, s.To = mp(s.C1), mp(s.C2), mp(s.To)
		case 'Q':
			s.C, s.To = mp(s.C), mp(s.To)
		case 'A':
			s.Rx *= k
			s.Ry *= k
			s.To = mp(s.To)
		}
		out[i] = s
	}
	return out
}

type OutlineStrokePlan struct {
	Ops    []any
	ID     string
	D      string
	Bounds Bounds
}

func OutlineStrokeOps(doc *Document, id string, keepStroke bool) (*OutlineStrokePlan, error) {
	n := GetNode(doc, id)
	if n == nil {
		return nil, fmt.Errorf(`node "%s" does not exist`, id)
	}
	if t := n.Str("type"); t != "path" {
		return nil, fmt.Errorf(`"%s" is %s; outline_stroke needs a path (convert_to_path turns a rect or ellipse into one)`, id, t)
	}
	stroke := n.Obj("stroke")
	if stroke == nil {
		return nil, fmt.Errorf(`"%s" has no stroke to outline`, id)
	}
	mode := ModeOf(doc, n)
	rawW, _ := stroke.Get("width")
	sw, _ := ResolveLength(doc, rawW, mode)
	if !(sw > 0) {
		return nil, fmt.Errorf(`"%s" has a stroke of width 0: nothing to outline`, id)
	}
	if n.Has("fill") || n.Has("gradient") {
		return nil, fmt.Errorf(`"%s" has a fill besides the stroke; the outline is one paint. Remove the fill first (update_nodes {fill: null}) or outline a copy`, id)
	}
	if st := StrokeStyleOf(stroke); st != "solid" {
		return nil, fmt.Errorf(`"%s" has a %s stroke; outline_stroke only handles solid strokes`, id, st)
	}
	w, h := nodeSize(n)
	segs, err := ParsePath(n.Str("d"))
	if err != nil {
		return nil, err
	}
	width := sw
	if vb := n.Arr("viewBox"); len(vb) == 4 {
		box := [4]float64{asFloat(vb[0]), asFloat(vb[1]), asFloat(vb[2]), asFloat(vb[3])}
		segs = mapViewBoxSegs(segs, box, w, h)
		width = sw * math.Min(w/box[2], h/box[3])
	}
	capName, joinName := n.Str("strokeCap"), n.Str("strokeJoin")
	if capName == "" {
		capName = "round"
	}
	if joinName == "" {
		joinName = "round"
	}
	rings := OutlineStrokeRings(segs, StrokeOutlineParams{Width: width, Cap: capName, Join: joinName})
	if len(rings) == 0 {
		return nil, fmt.Errorf(`"%s" has nothing to outline (a single point with a butt cap)`, id)
	}
	x, y, rot := n.Num("x"), n.Num("y"), n.Num("rotation")
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	world := make([][]Point, len(rings))
	for i, r := range rings {
		world[i] = make([]Point, len(r))
		for j, p := range r {
			q := transformLocal(p, x, y, w, h, rot)
			world[i][j] = q
			minX, minY = math.Min(minX, q.X), math.Min(minY, q.Y)
			maxX, maxY = math.Max(maxX, q.X), math.Max(maxY, q.Y)
		}
	}
	bounds := Bounds{X: Round4(minX), Y: Round4(minY), Width: math.Max(1, Round4(maxX-minX)), Height: math.Max(1, Round4(maxY-minY))}
	var out []Segment
	for _, r := range world {
		out = append(out, Segment{Cmd: 'M', To: Point{r[0].X - bounds.X, r[0].Y - bounds.Y}})
		for _, p := range r[1:] {
			out = append(out, Segment{Cmd: 'L', To: Point{p.X - bounds.X, p.Y - bounds.Y}})
		}
		out = append(out, Segment{Cmd: 'Z'})
	}
	d := SerializePath(out)
	props := jsonv.NewObject("d", d, "x", bounds.X, "y", bounds.Y, "width", bounds.Width, "height", bounds.Height,
		"fill", func() any { v, _ := stroke.Get("color"); return v }(), "fillRule", "nonzero", "viewBox", nil)
	if rot != 0 {
		props.Set("rotation", 0.0)
	}
	if !keepStroke {
		props.Set("stroke", nil)
	}
	return &OutlineStrokePlan{Ops: []any{jsonv.NewObject("op", "update", "id", id, "props", props)}, ID: id, D: d, Bounds: bounds}, nil
}
