package core

import (
	"errors"
	"fmt"
	"math"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

var PathShapeKinds = []string{"star", "polygon", "ring", "arc", "sector"}

type ShapeParams struct {
	Points, Sides, Radius, InnerRadius, Thickness, Angle, StartAngle, EndAngle, CornerRadius *float64
	RoundCaps                                                                                bool
}

type PathShape struct {
	D             string
	Width, Height float64
	Center        Point
	EvenOdd       bool
}

const shapeEps = 1e-9

func polar(r, deg float64) Point {
	a := deg * math.Pi / 180
	return Point{r * math.Sin(a), -r * math.Cos(a)}
}

func segM(to Point) Segment { return Segment{Cmd: 'M', To: to} }
func segL(to Point) Segment { return Segment{Cmd: 'L', To: to} }
func segArc(r float64, large, sweep bool, to Point) Segment {
	return Segment{Cmd: 'A', Rx: r, Ry: r, LargeArc: large, Sweep: sweep, To: to}
}
func samePoint(a, b Point) bool {
	return math.Abs(a.X-b.X) < shapeEps && math.Abs(a.Y-b.Y) < shapeEps
}

type corner struct {
	a, b  Point
	r     float64
	sweep bool
}

func cornerAt(prev, p, next Point, radius float64) *corner {
	if !(radius > 0) {
		return nil
	}
	lu := math.Hypot(prev.X-p.X, prev.Y-p.Y)
	lv := math.Hypot(next.X-p.X, next.Y-p.Y)
	if lu < shapeEps || lv < shapeEps {
		return nil
	}
	ux, uy := (prev.X-p.X)/lu, (prev.Y-p.Y)/lu
	vx, vy := (next.X-p.X)/lv, (next.Y-p.Y)/lv
	cos := math.Max(-1, math.Min(1, ux*vx+uy*vy))
	if cos < -1+shapeEps || cos > 1-shapeEps {
		return nil
	}
	tan := math.Sqrt((1 - cos) / (1 + cos))
	t := radius / tan
	max := math.Min(lu, lv) / 2
	r := radius
	if t > max {
		t = max
		r = t * tan
	}
	if r < 1e-6 {
		return nil
	}
	cross := -ux*vy + uy*vx
	return &corner{Point{p.X + ux*t, p.Y + uy*t}, Point{p.X + vx*t, p.Y + vy*t}, r, cross > 0}
}

func roundedSubpath(pts []Point, closed bool, radii []float64) []Segment {
	n := len(pts)
	at := func(i int) *corner {
		if !closed && (i == 0 || i == n-1) {
			return nil
		}
		r := 0.0
		if i < len(radii) {
			r = radii[i]
		}
		return cornerAt(pts[(i+n-1)%n], pts[i], pts[(i+1)%n], r)
	}
	var segs []Segment
	c0 := at(0)
	cur := pts[0]
	if c0 != nil {
		cur = c0.b
	}
	segs = append(segs, segM(cur))
	goTo := func(to Point) {
		if !samePoint(cur, to) {
			segs = append(segs, segL(to))
		}
		cur = to
	}
	for i := 1; i < n; i++ {
		c := at(i)
		if c == nil {
			goTo(pts[i])
		} else {
			goTo(c.a)
			segs = append(segs, segArc(c.r, false, c.sweep, c.b))
			cur = c.b
		}
	}
	if closed {
		if c0 != nil {
			goTo(c0.a)
			segs = append(segs, segArc(c0.r, false, c0.sweep, c0.b))
		}
		segs = append(segs, Segment{Cmd: 'Z'})
	}
	return segs
}

type polyline struct {
	pts    []Point
	closed bool
}

func polylines(segs []Segment) ([]*polyline, error) {
	var out []*polyline
	var cur *polyline
	push := func(p Point) {
		if cur != nil && !(len(cur.pts) > 0 && samePoint(cur.pts[len(cur.pts)-1], p)) {
			cur.pts = append(cur.pts, p)
		}
	}
	for i, s := range segs {
		switch s.Cmd {
		case 'M':
			cur = &polyline{}
			out = append(out, cur)
			push(s.To)
		case 'L':
			push(s.To)
		case 'Z':
			if cur != nil {
				cur.closed = true
			}
		default:
			return nil, fmt.Errorf("round_path_corners only rounds straight edges (M L H V Z); segment %d is %c", i+1, s.Cmd)
		}
	}
	for _, p := range out {
		if p.closed && len(p.pts) > 1 && samePoint(p.pts[0], p.pts[len(p.pts)-1]) {
			p.pts = p.pts[:len(p.pts)-1]
		}
	}
	return out, nil
}

func RoundPathCorners(d string, radius float64, radii []*float64) (string, error) {
	segs, err := ParsePath(d)
	if err != nil {
		return "", err
	}
	subs, err := polylines(segs)
	if err != nil {
		return "", err
	}
	var out []Segment
	k := 0
	for _, sub := range subs {
		rs := make([]float64, len(sub.pts))
		for i := range sub.pts {
			rs[i] = radius
			if k+i < len(radii) && radii[k+i] != nil {
				rs[i] = *radii[k+i]
			}
		}
		k += len(sub.pts)
		if len(sub.pts) < 2 {
			out = append(out, segM(sub.pts[0]))
			continue
		}
		out = append(out, roundedSubpath(sub.pts, sub.closed, rs)...)
	}
	return SerializePath(out), nil
}

func numIn(name string, v *float64, min, max float64) (float64, error) {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
		return 0, fmt.Errorf("%s is required", name)
	}
	if *v < min || *v > max {
		return 0, fmt.Errorf("%s must be between %s and %s", name, jsNum(min), jsNum(max))
	}
	return *v, nil
}

func jsNum(v float64) string { return r2(v) }

func circleSegs(r float64) []Segment {
	return []Segment{segM(Point{0, -r}), segArc(r, true, true, Point{0, r}), segArc(r, true, true, Point{0, -r}), {Cmd: 'Z'}}
}

func sweepOf(p ShapeParams) (start, sweep float64, err error) {
	if start, err = numIn("startAngle", p.StartAngle, -3600, 3600); err != nil {
		return
	}
	end, err := numIn("endAngle", p.EndAngle, -3600, 3600)
	if err != nil {
		return
	}
	if start == end {
		err = errors.New("startAngle and endAngle are the same: the sweep is empty")
		return
	}
	sweep = math.Mod(math.Mod(end-start, 360)+360, 360)
	if sweep == 0 {
		sweep = 360
	}
	return
}

func holeRadius(R float64, p ShapeParams) (float64, error) {
	if p.InnerRadius != nil && p.Thickness != nil {
		return 0, errors.New("pass innerRadius or thickness, not both")
	}
	var inner float64
	var err error
	if p.InnerRadius != nil {
		inner, err = numIn("innerRadius", p.InnerRadius, 0.01, 1e6)
	} else {
		var t float64
		t, err = numIn("thickness", p.Thickness, 0.01, 1e6)
		inner = R - t
	}
	if err != nil {
		return 0, err
	}
	if !(inner > 0 && inner < R) {
		return 0, fmt.Errorf(`the hole radius (%s) must be between 0 and the radius (%s); use kind "sector" for a solid wedge`, jsNum(inner), jsNum(R))
	}
	return inner, nil
}

func pathShapeSegments(kind string, p ShapeParams) ([]Segment, bool, error) {
	R, err := numIn("radius", p.Radius, 0.01, 1e6)
	if err != nil {
		return nil, false, err
	}
	angle := 0.0
	if p.Angle != nil {
		angle = *p.Angle
	}
	cr := 0.0
	if p.CornerRadius != nil {
		cr = *p.CornerRadius
	}
	polyKind := kind == "star" || kind == "polygon"
	if cr < 0 {
		return nil, false, errors.New("cornerRadius must be 0 or more")
	}
	if cr > 0 && !polyKind {
		return nil, false, errors.New("cornerRadius only applies to star and polygon")
	}
	if p.Angle != nil && !polyKind {
		return nil, false, errors.New("angle only applies to star and polygon (use startAngle and endAngle for arc and sector)")
	}
	if p.RoundCaps && kind != "arc" {
		return nil, false, errors.New("roundCaps only applies to arc")
	}
	repeat := func(n int) []float64 {
		rs := make([]float64, n)
		for i := range rs {
			rs[i] = cr
		}
		return rs
	}
	switch kind {
	case "star":
		pf, err := numIn("points", p.Points, 3, 100)
		if err != nil {
			return nil, false, err
		}
		n := int(math.Floor(pf + 0.5))
		inner := R / 2
		if p.InnerRadius != nil {
			if inner, err = numIn("innerRadius", p.InnerRadius, 0.01, 1e6); err != nil {
				return nil, false, err
			}
		}
		pts := make([]Point, 2*n)
		for i := range pts {
			r := inner
			if i%2 == 0 {
				r = R
			}
			pts[i] = polar(r, angle+float64(i)*180/float64(n))
		}
		return roundedSubpath(pts, true, repeat(len(pts))), false, nil
	case "polygon":
		sf, err := numIn("sides", p.Sides, 3, 100)
		if err != nil {
			return nil, false, err
		}
		n := int(math.Floor(sf + 0.5))
		pts := make([]Point, n)
		for i := range pts {
			pts[i] = polar(R, angle+float64(i)*360/float64(n))
		}
		return roundedSubpath(pts, true, repeat(n)), false, nil
	case "ring":
		inner, err := holeRadius(R, p)
		if err != nil {
			return nil, false, err
		}
		return append(circleSegs(R), circleSegs(inner)...), true, nil
	case "arc":
		inner, err := holeRadius(R, p)
		if err != nil {
			return nil, false, err
		}
		start, sweep, err := sweepOf(p)
		if err != nil {
			return nil, false, err
		}
		if sweep >= 360 {
			return append(circleSegs(R), circleSegs(inner)...), true, nil
		}
		large := sweep > 180
		end := start + sweep
		capR := (R - inner) / 2
		segs := []Segment{segM(polar(R, start)), segArc(R, large, true, polar(R, end))}
		if p.RoundCaps {
			segs = append(segs, segArc(capR, false, true, polar(inner, end)))
		} else {
			segs = append(segs, segL(polar(inner, end)))
		}
		segs = append(segs, segArc(inner, large, false, polar(inner, start)))
		if p.RoundCaps {
			segs = append(segs, segArc(capR, false, true, polar(R, start)))
		}
		return append(segs, Segment{Cmd: 'Z'}), false, nil
	case "sector":
		start, sweep, err := sweepOf(p)
		if err != nil {
			return nil, false, err
		}
		if sweep >= 360 {
			return circleSegs(R), false, nil
		}
		end := start + sweep
		return []Segment{segM(Point{0, 0}), segL(polar(R, start)), segArc(R, sweep > 180, true, polar(R, end)), {Cmd: 'Z'}}, false, nil
	}
	return nil, false, fmt.Errorf(`unknown shape kind "%s" (star, polygon, ring, arc, sector)`, kind)
}

func BuildPathShape(kind string, p ShapeParams) (*PathShape, error) {
	segs, evenodd, err := pathShapeSegments(kind, p)
	if err != nil {
		return nil, err
	}
	b := PathBounds(segs)
	moved := TranslatePath(segs, -b.X, -b.Y)
	rnd := func(v float64) float64 { return math.Floor(v*100+0.5)/100 + 0 }
	return &PathShape{D: SerializePath(moved), Width: rnd(b.Width), Height: rnd(b.Height), Center: Point{rnd(-b.X), rnd(-b.Y)}, EvenOdd: evenodd}, nil
}

func optNum(o *jsonv.Object, k string) *float64 {
	if !o.Has(k) {
		return nil
	}
	v := o.Num(k)
	return &v
}

func ShapeParamsFromJSON(o *jsonv.Object) ShapeParams {
	return ShapeParams{
		Points: optNum(o, "points"), Sides: optNum(o, "sides"), Radius: optNum(o, "radius"),
		InnerRadius: optNum(o, "innerRadius"), Thickness: optNum(o, "thickness"), Angle: optNum(o, "angle"),
		StartAngle: optNum(o, "startAngle"), EndAngle: optNum(o, "endAngle"), CornerRadius: optNum(o, "cornerRadius"),
		RoundCaps: o.Bool("roundCaps"),
	}
}
