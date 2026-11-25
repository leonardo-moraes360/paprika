package core

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/boolean.ts: original polygon boolean (edge split + classify + directed walk).

type BooleanOperation string

const (
	BoolUnion     BooleanOperation = "union"
	BoolSubtract  BooleanOperation = "subtract"
	BoolIntersect BooleanOperation = "intersect"
	BoolExclude   BooleanOperation = "exclude"
)

const (
	boolEPS     = 1e-9
	boolFlat    = 0.25
	boolEllipse = 64
)

type boolRing []Point

type boolPoly struct {
	Outer boolRing
	Holes []boolRing
}

type boolMulti []boolPoly

type boolEdge struct {
	A, B Point
	Src  int
}

var combineTypes = map[string]bool{"path": true, "rect": true, "ellipse": true, "shape": true}

func asFloat(v any) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

func nearly(a, b float64) bool               { return math.Abs(a-b) <= boolEPS }
func samePt(a, b Point) bool                 { return nearly(a.X, b.X) && nearly(a.Y, b.Y) }
func crossXY(ax, ay, bx, by float64) float64 { return ax*by - ay*bx }
func dotXY(ax, ay, bx, by float64) float64   { return ax*bx + ay*by }
func dist2(a, b Point) float64 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	return dx*dx + dy*dy
}

func ringArea(ring boolRing) float64 {
	var a float64
	n := len(ring)
	for i := range n {
		p, q := ring[i], ring[(i+1)%n]
		a += p.X*q.Y - q.X*p.Y
	}
	return a / 2
}

func reverseRing(ring boolRing) boolRing {
	out := make(boolRing, len(ring))
	for i := range ring {
		out[i] = ring[len(ring)-1-i]
	}
	return out
}

func ensureCCW(ring boolRing) boolRing {
	if ringArea(ring) < 0 {
		return reverseRing(ring)
	}
	return ring
}

func ensureCW(ring boolRing) boolRing {
	if ringArea(ring) > 0 {
		return reverseRing(ring)
	}
	return ring
}

func cleanRing(ring boolRing) boolRing {
	out := boolRing{}
	for _, p := range ring {
		q := Point{Round4(p.X), Round4(p.Y)}
		if len(out) == 0 || !samePt(out[len(out)-1], q) {
			out = append(out, q)
		}
	}
	if len(out) > 1 && samePt(out[0], out[len(out)-1]) {
		out = out[:len(out)-1]
	}
	if len(out) < 3 {
		return nil
	}
	min := 0
	for i := 1; i < len(out); i++ {
		a, b := out[i], out[min]
		if a.X < b.X || (a.X == b.X && a.Y < b.Y) {
			min = i
		}
	}
	if min > 0 {
		out = append(out[min:], out[:min]...)
	}
	return out
}

func pointInRing(p Point, ring boolRing) bool {
	inside := false
	n := len(ring)
	for i := range n {
		a, b := ring[i], ring[(i+1)%n]
		hit := (a.Y > p.Y) != (b.Y > p.Y) && p.X < ((b.X-a.X)*(p.Y-a.Y))/(b.Y-a.Y+0)+a.X
		if hit {
			inside = !inside
		}
	}
	return inside
}

func pointInPoly(p Point, poly boolPoly) bool {
	if !pointInRing(p, poly.Outer) {
		return false
	}
	for _, h := range poly.Holes {
		if pointInRing(p, h) {
			return false
		}
	}
	return true
}

func pointInMulti(p Point, multi boolMulti) bool {
	for _, poly := range multi {
		if pointInPoly(p, poly) {
			return true
		}
	}
	return false
}

func windingAt(p Point, ring boolRing) int {
	w := 0
	n := len(ring)
	for i := range n {
		a, b := ring[i], ring[(i+1)%n]
		if a.Y <= p.Y {
			if b.Y > p.Y && crossXY(b.X-a.X, b.Y-a.Y, p.X-a.X, p.Y-a.Y) > 0 {
				w++
			}
		} else if b.Y <= p.Y && crossXY(b.X-a.X, b.Y-a.Y, p.X-a.X, p.Y-a.Y) < 0 {
			w--
		}
	}
	return w
}

func transformLocal(pt Point, x, y, w, h, rotation float64) Point {
	if rotation == 0 {
		return Point{Round4(x + pt.X), Round4(y + pt.Y)}
	}
	rad := rotation * math.Pi / 180
	c, s := math.Cos(rad), math.Sin(rad)
	dx, dy := pt.X-w/2, pt.Y-h/2
	return Point{Round4(x + w/2 + dx*c - dy*s), Round4(y + h/2 + dx*s + dy*c)}
}

func mapRingLocal(ring boolRing, x, y, w, h, rotation float64) boolRing {
	out := make(boolRing, len(ring))
	for i, p := range ring {
		out[i] = transformLocal(p, x, y, w, h, rotation)
	}
	return cleanRing(out)
}

func flattenCubic(p0, p1, p2, p3 Point, out *[]Point) {
	flattenCubicTol(p0, p1, p2, p3, out, boolFlat)
}

func flattenCubicTol(p0, p1, p2, p3 Point, out *[]Point, flat float64) {
	var step func(a, b, c, d Point)
	step = func(a, b, c, d Point) {
		dx, dy := d.X-a.X, d.Y-a.Y
		d2 := math.Abs((b.X-d.X)*dy-(b.Y-d.Y)*dx) + math.Abs((c.X-d.X)*dy-(c.Y-d.Y)*dx)
		if d2*d2 <= flat*flat*(dx*dx+dy*dy) || dist2(a, d) < flat*flat {
			*out = append(*out, d)
			return
		}
		ab := Point{(a.X + b.X) / 2, (a.Y + b.Y) / 2}
		bc := Point{(b.X + c.X) / 2, (b.Y + c.Y) / 2}
		cd := Point{(c.X + d.X) / 2, (c.Y + d.Y) / 2}
		abc := Point{(ab.X + bc.X) / 2, (ab.Y + bc.Y) / 2}
		bcd := Point{(bc.X + cd.X) / 2, (bc.Y + cd.Y) / 2}
		m := Point{(abc.X + bcd.X) / 2, (abc.Y + bcd.Y) / 2}
		step(a, ab, abc, m)
		step(m, bcd, cd, d)
	}
	step(p0, p1, p2, p3)
}

func flattenQuad(p0, p1, p2 Point, out *[]Point) {
	flattenQuadTol(p0, p1, p2, out, boolFlat)
}

func flattenQuadTol(p0, p1, p2 Point, out *[]Point, flat float64) {
	flattenCubicTol(p0,
		Point{p0.X + (2.0/3.0)*(p1.X-p0.X), p0.Y + (2.0/3.0)*(p1.Y-p0.Y)},
		Point{p2.X + (2.0/3.0)*(p1.X-p2.X), p2.Y + (2.0/3.0)*(p1.Y-p2.Y)},
		p2, out, flat)
}

func arcToCubicPts(from Point, s Segment) []Point {
	return arcToCubicTol(from, s, boolFlat)
}

func arcToCubicTol(from Point, s Segment, flat float64) []Point {
	rx, ry := s.Rx, s.Ry
	if rx == 0 || ry == 0 || (from.X == s.To.X && from.Y == s.To.Y) {
		return []Point{s.To}
	}
	phi := s.Rot * math.Pi / 180
	cos, sin := math.Cos(phi), math.Sin(phi)
	dx := (from.X - s.To.X) / 2
	dy := (from.Y - s.To.Y) / 2
	x1 := cos*dx + sin*dy
	y1 := -sin*dx + cos*dy
	lambda := (x1*x1)/(rx*rx) + (y1*y1)/(ry*ry)
	if lambda > 1 {
		k := math.Sqrt(lambda)
		rx *= k
		ry *= k
	}
	num := rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1
	den := rx*rx*y1*y1 + ry*ry*x1*x1
	sq := math.Sqrt(math.Max(0, num/den))
	sign := 1.0
	if s.LargeArc == s.Sweep {
		sign = -1
	}
	k := sign * sq
	cx1 := (k * rx * y1) / ry
	cy1 := (-k * ry * x1) / rx
	cx := cos*cx1 - sin*cy1 + (from.X+s.To.X)/2
	cy := sin*cx1 + cos*cy1 + (from.Y+s.To.Y)/2
	ang := func(ux, uy, vx, vy float64) float64 { return math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy) }
	t1 := ang(1, 0, (x1-cx1)/rx, (y1-cy1)/ry)
	dt := ang((x1-cx1)/rx, (y1-cy1)/ry, (-x1-cx1)/rx, (-y1-cy1)/ry)
	if !s.Sweep && dt > 0 {
		dt -= 2 * math.Pi
	}
	if s.Sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	n := int(math.Max(1, math.Ceil(math.Abs(dt)/(math.Pi/2))))
	out := []Point{}
	for i := range n {
		a1 := t1 + (dt*float64(i))/float64(n)
		a2 := t1 + (dt*float64(i+1))/float64(n)
		alpha := (math.Sin(a2-a1) * (math.Sqrt(4+3*math.Pow(math.Tan((a2-a1)/2), 2)) - 1)) / 3
		e1 := Point{cx + rx*math.Cos(a1)*cos - ry*math.Sin(a1)*sin, cy + rx*math.Cos(a1)*sin + ry*math.Sin(a1)*cos}
		e2 := Point{cx + rx*math.Cos(a2)*cos - ry*math.Sin(a2)*sin, cy + rx*math.Cos(a2)*sin + ry*math.Sin(a2)*cos}
		d1 := Point{-rx*math.Sin(a1)*cos - ry*math.Cos(a1)*sin, -rx*math.Sin(a1)*sin + ry*math.Cos(a1)*cos}
		d2 := Point{-rx*math.Sin(a2)*cos - ry*math.Cos(a2)*sin, -rx*math.Sin(a2)*sin + ry*math.Cos(a2)*cos}
		c1 := Point{e1.X + alpha*d1.X, e1.Y + alpha*d1.Y}
		c2 := Point{e2.X - alpha*d2.X, e2.Y - alpha*d2.Y}
		start := from
		if i > 0 {
			start = out[len(out)-1]
		}
		pts := []Point{}
		flattenCubicTol(start, c1, c2, e2, &pts, flat)
		out = append(out, pts...)
	}
	return out
}

func flattenSegments(segs []Segment) []boolRing {
	rings := []boolRing{}
	cur, start := Point{}, Point{}
	ring := boolRing{}
	push := func(p Point) {
		if len(ring) == 0 || !samePt(ring[len(ring)-1], p) {
			ring = append(ring, p)
		}
	}
	for _, s := range segs {
		switch s.Cmd {
		case 'M':
			if len(ring) >= 3 {
				rings = append(rings, ring)
			}
			ring = boolRing{}
			start, cur = s.To, s.To
			push(s.To)
		case 'L':
			push(s.To)
			cur = s.To
		case 'C':
			pts := []Point{}
			flattenCubic(cur, s.C1, s.C2, s.To, &pts)
			for _, p := range pts {
				push(p)
			}
			cur = s.To
		case 'Q':
			pts := []Point{}
			flattenQuad(cur, s.C, s.To, &pts)
			for _, p := range pts {
				push(p)
			}
			cur = s.To
		case 'A':
			for _, p := range arcToCubicPts(cur, s) {
				push(p)
			}
			cur = s.To
		default:
			if !samePt(cur, start) {
				push(start)
			}
			if len(ring) >= 3 {
				rings = append(rings, ring)
			}
			ring = boolRing{}
			cur = start
		}
	}
	if len(ring) >= 3 {
		rings = append(rings, ring)
	}
	out := []boolRing{}
	for _, r := range rings {
		if c := cleanRing(r); len(c) >= 3 {
			out = append(out, c)
		}
	}
	return out
}

func rectRing(w, h float64, radii [4]float64) boolRing {
	radii = UsedCornerRadii(w, h, radii)
	if (radii[0] == 0 && radii[1] == 0 && radii[2] == 0 && radii[3] == 0) || w < 1 || h < 1 {
		return boolRing{{0, 0}, {w, 0}, {w, h}, {0, h}}
	}
	tl, tr, br, bl := radii[0], radii[1], radii[2], radii[3]
	segs := []Segment{{Cmd: 'M', To: Point{tl, 0}}, {Cmd: 'L', To: Point{w - tr, 0}}}
	if tr > 0 {
		segs = append(segs, Segment{Cmd: 'A', Rx: tr, Ry: tr, Sweep: true, To: Point{w, tr}})
	}
	segs = append(segs, Segment{Cmd: 'L', To: Point{w, h - br}})
	if br > 0 {
		segs = append(segs, Segment{Cmd: 'A', Rx: br, Ry: br, Sweep: true, To: Point{w - br, h}})
	}
	segs = append(segs, Segment{Cmd: 'L', To: Point{bl, h}})
	if bl > 0 {
		segs = append(segs, Segment{Cmd: 'A', Rx: bl, Ry: bl, Sweep: true, To: Point{0, h - bl}})
	}
	segs = append(segs, Segment{Cmd: 'L', To: Point{0, tl}})
	if tl > 0 {
		segs = append(segs, Segment{Cmd: 'A', Rx: tl, Ry: tl, Sweep: true, To: Point{tl, 0}})
	}
	segs = append(segs, Segment{Cmd: 'Z'})
	rings := flattenSegments(segs)
	if len(rings) == 0 {
		return nil
	}
	return rings[0]
}

func ellipseRing(w, h float64) boolRing {
	rx, ry := w/2, h/2
	out := make(boolRing, boolEllipse)
	for i := range boolEllipse {
		t := (float64(i) / boolEllipse) * math.Pi * 2
		out[i] = Point{rx + rx*math.Cos(t), ry + ry*math.Sin(t)}
	}
	return out
}

func applyViewBox(pt Point, vb [4]float64, w, h float64) Point {
	vx, vy, vw, vh := vb[0], vb[1], vb[2], vb[3]
	s := math.Min(w/vw, h/vh)
	ox := (w - vw*s) / 2
	oy := (h - vh*s) / 2
	return Point{ox + (pt.X-vx)*s, oy + (pt.Y-vy)*s}
}

func ringsToMulti(rings []boolRing, fillRule string) boolMulti {
	cleaned := []boolRing{}
	for _, r := range rings {
		if c := cleanRing(r); len(c) >= 3 {
			cleaned = append(cleaned, c)
		}
	}
	if len(cleaned) == 0 {
		return nil
	}
	type item struct {
		r boolRing
		a float64
	}
	areas := make([]item, len(cleaned))
	for i, r := range cleaned {
		areas[i] = item{r, math.Abs(ringArea(r))}
	}
	sort.SliceStable(areas, func(i, j int) bool { return areas[i].a > areas[j].a })
	used := map[int]bool{}
	multi := boolMulti{}
	for i := range areas {
		if used[i] {
			continue
		}
		outer := ensureCCW(areas[i].r)
		holes := []boolRing{}
		used[i] = true
		sample := outer[0]
		for j := range areas {
			if used[j] || j == i {
				continue
			}
			cand := areas[j].r
			inside := false
			if fillRule == "evenodd" {
				inside = pointInRing(cand[0], outer)
			} else {
				inside = int(math.Abs(float64(windingAt(cand[0], outer)))) > 0
			}
			if !inside {
				continue
			}
			nested := false
			for k := range areas {
				if k == i || k == j || used[k] {
					continue
				}
				if pointInRing(cand[0], areas[k].r) && pointInRing(areas[k].r[0], outer) {
					nested = true
					break
				}
			}
			if nested {
				continue
			}
			holeInside := true
			if fillRule == "evenodd" {
				holeInside = !pointInRing(sample, cand)
			}
			if holeInside || fillRule == "evenodd" {
				holes = append(holes, ensureCW(cand))
				used[j] = true
			}
		}
		multi = append(multi, boolPoly{Outer: outer, Holes: holes})
	}
	return multi
}

func nodeSize(n *Node) (w, h float64) {
	if v, ok := n.Get("width"); ok {
		w = asFloat(v)
	}
	if v, ok := n.Get("height"); ok {
		h = asFloat(v)
	}
	return
}

func nodeGeometry(doc *Document, n *Node) boolMulti {
	typ := n.Str("type")
	switch typ {
	case "page", "group", "connector", "frame", "text", "image":
		return nil
	}
	w, h := nodeSize(n)
	rot := n.Num("rotation")
	x, y := n.Num("x"), n.Num("y")
	mode := ModeOf(doc, n)
	radiusRaw, _ := n.Get("radius")
	radii := ResolveCorners(doc, radiusRaw, mode)
	switch typ {
	case "rect":
		ring := mapRingLocal(rectRing(w, h, radii), x, y, w, h, rot)
		if len(ring) >= 3 {
			return boolMulti{{Outer: ensureCCW(ring)}}
		}
	case "ellipse":
		ring := mapRingLocal(ellipseRing(w, h), x, y, w, h, rot)
		if len(ring) >= 3 {
			return boolMulti{{Outer: ensureCCW(ring)}}
		}
	case "shape":
		d, _ := ShapeOutline(lengthsResolved(doc, n))
		segs, err := ParsePath(d)
		if err != nil {
			return nil
		}
		rings := []boolRing{}
		for _, r := range flattenSegments(segs) {
			if m := mapRingLocal(r, x, y, w, h, rot); len(m) >= 3 {
				rings = append(rings, m)
			}
		}
		return ringsToMulti(rings, "nonzero")
	case "path":
		segs, err := ParsePath(n.Str("d"))
		if err != nil {
			return nil
		}
		if vb := n.Arr("viewBox"); len(vb) == 4 {
			box := [4]float64{asFloat(vb[0]), asFloat(vb[1]), asFloat(vb[2]), asFloat(vb[3])}
			s := math.Min(w/box[2], h/box[3])
			mapped := make([]Segment, len(segs))
			for i, seg := range segs {
				mapP := func(p Point) Point { return applyViewBox(p, box, w, h) }
				switch seg.Cmd {
				case 'M', 'L':
					seg.To = mapP(seg.To)
				case 'C':
					seg.C1, seg.C2, seg.To = mapP(seg.C1), mapP(seg.C2), mapP(seg.To)
				case 'Q':
					seg.C, seg.To = mapP(seg.C), mapP(seg.To)
				case 'A':
					seg.Rx *= s
					seg.Ry *= s
					seg.To = mapP(seg.To)
				}
				mapped[i] = seg
			}
			segs = mapped
		}
		rings := []boolRing{}
		for _, r := range flattenSegments(segs) {
			if m := mapRingLocal(r, x, y, w, h, rot); len(m) >= 3 {
				rings = append(rings, m)
			}
		}
		fr := n.Str("fillRule")
		if fr == "" {
			fr = "nonzero"
		}
		return ringsToMulti(rings, fr)
	}
	return nil
}

func segIntersect(a1, a2, b1, b2 Point) (Point, bool) {
	dax, day := a2.X-a1.X, a2.Y-a1.Y
	dbx, dby := b2.X-b1.X, b2.Y-b1.Y
	den := crossXY(dax, day, dbx, dby)
	if math.Abs(den) < boolEPS {
		return Point{}, false
	}
	t := crossXY(b1.X-a1.X, b1.Y-a1.Y, dbx, dby) / den
	u := crossXY(b1.X-a1.X, b1.Y-a1.Y, dax, day) / den
	if t < -boolEPS || t > 1+boolEPS || u < -boolEPS || u > 1+boolEPS {
		return Point{}, false
	}
	return Point{Round4(a1.X + t*dax), Round4(a1.Y + t*day)}, true
}

func polyEdges(multi boolMulti, src int) []boolEdge {
	edges := []boolEdge{}
	add := func(ring boolRing) {
		n := len(ring)
		for i := range n {
			a, b := ring[i], ring[(i+1)%n]
			if !samePt(a, b) {
				edges = append(edges, boolEdge{A: a, B: b, Src: src})
			}
		}
	}
	for _, p := range multi {
		add(p.Outer)
		for _, h := range p.Holes {
			add(h)
		}
	}
	return edges
}

func splitEdges(edges []boolEdge) []boolEdge {
	out := []boolEdge{}
	for i, e := range edges {
		type cut struct {
			t float64
			p Point
		}
		cuts := []cut{}
		for j, o := range edges {
			if i == j {
				continue
			}
			p, ok := segIntersect(e.A, e.B, o.A, o.B)
			if !ok || samePt(p, e.A) || samePt(p, e.B) {
				continue
			}
			var t float64
			if math.Abs(e.B.X-e.A.X) >= math.Abs(e.B.Y-e.A.Y) {
				den := e.B.X - e.A.X
				if den == 0 {
					den = 1
				}
				t = (p.X - e.A.X) / den
			} else {
				den := e.B.Y - e.A.Y
				if den == 0 {
					den = 1
				}
				t = (p.Y - e.A.Y) / den
			}
			cuts = append(cuts, cut{t, p})
		}
		sort.SliceStable(cuts, func(a, b int) bool { return cuts[a].t < cuts[b].t })
		prev := e.A
		for _, c := range cuts {
			if samePt(prev, c.p) {
				continue
			}
			out = append(out, boolEdge{A: prev, B: c.p, Src: e.Src})
			prev = c.p
		}
		if !samePt(prev, e.B) {
			out = append(out, boolEdge{A: prev, B: e.B, Src: e.Src})
		}
	}
	return out
}

func midPt(a, b Point) Point { return Point{(a.X + b.X) / 2, (a.Y + b.Y) / 2} }

func selectFragment(inA, inB bool, src int, op BooleanOperation) string {
	switch op {
	case BoolUnion:
		if (src == 0 && !inB) || (src == 1 && !inA) {
			return "keep"
		}
	case BoolIntersect:
		if (src == 0 && inB) || (src == 1 && inA) {
			return "keep"
		}
	case BoolSubtract:
		if src == 0 && !inB {
			return "keep"
		}
		if src == 1 && inA {
			return "rev"
		}
	case BoolExclude:
		if src == 0 {
			if inB {
				return "rev"
			}
			return "keep"
		}
		if inA {
			return "rev"
		}
		return "keep"
	}
	return ""
}

func ptKey(p Point) string {
	return fmt.Sprintf("%g,%g", p.X+0, p.Y+0) // +0 folds -0 into 0, as JS template strings do
}

func linkRings(fragments []boolEdge) []boolRing {
	type link struct {
		to   Point
		used bool
	}
	adj := map[string][]link{}
	for _, e := range fragments {
		k := ptKey(e.A)
		adj[k] = append(adj[k], link{to: e.B})
	}
	rings := []boolRing{}
	// Same start order as the TS Map: first insertion, not sorted keys.
	keys := make([]string, 0, len(adj))
	seen := map[string]bool{}
	for _, e := range fragments {
		if k := ptKey(e.A); !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	for _, sk := range keys {
		list := adj[sk]
		for si := range list {
			if adj[sk][si].used {
				continue
			}
			var sx, sy float64
			if _, err := fmt.Sscanf(sk, "%f,%f", &sx, &sy); err != nil {
				continue
			}
			start := Point{sx, sy}
			ring := boolRing{start}
			cur := start
			next := adj[sk][si].to
			tmp := adj[sk]
			tmp[si].used = true
			adj[sk] = tmp
			for range 100000 {
				ring = append(ring, next)
				if samePt(next, start) && len(ring) > 2 {
					break
				}
				nk := ptKey(next)
				opts := []int{}
				for i, l := range adj[nk] {
					if !l.used {
						opts = append(opts, i)
					}
				}
				if len(opts) == 0 {
					break
				}
				best := opts[0]
				if len(opts) > 1 {
					inX, inY := next.X-cur.X, next.Y-cur.Y
					bestAng := math.Inf(1)
					for _, oi := range opts {
						opt := adj[nk][oi]
						outX, outY := opt.to.X-next.X, opt.to.Y-next.Y
						ang := math.Atan2(crossXY(inX, inY, outX, outY), dotXY(inX, inY, outX, outY))
						if ang < bestAng {
							bestAng = ang
							best = oi
						}
					}
				}
				tmp := adj[nk]
				tmp[best].used = true
				adj[nk] = tmp
				cur = next
				next = adj[nk][best].to
			}
			if len(ring) > 1 && samePt(ring[0], ring[len(ring)-1]) {
				ring = ring[:len(ring)-1]
			}
			if c := cleanRing(ring); len(c) >= 3 {
				rings = append(rings, c)
			}
		}
	}
	return rings
}

func nestRings(rings []boolRing) boolMulti {
	cleaned := []boolRing{}
	for _, r := range rings {
		if c := cleanRing(r); len(c) >= 3 {
			cleaned = append(cleaned, c)
		}
	}
	if len(cleaned) == 0 {
		return nil
	}
	type item struct {
		r boolRing
		a float64
	}
	items := make([]item, len(cleaned))
	for i, r := range cleaned {
		items[i] = item{r, math.Abs(ringArea(r))}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].a > items[j].a })
	parent := make([]int, len(items))
	for i := range parent {
		parent[i] = -1
	}
	for i := range items {
		p := items[i].r[0]
		for j := i - 1; j >= 0; j-- {
			if pointInRing(p, items[j].r) {
				parent[i] = j
				break
			}
		}
	}
	multi := boolMulti{}
	holesOf := map[int]*[]boolRing{}
	for i := range items {
		depth := 0
		for p := parent[i]; p >= 0; p = parent[p] {
			depth++
		}
		if depth%2 == 0 {
			poly := boolPoly{Outer: ensureCCW(items[i].r), Holes: []boolRing{}}
			multi = append(multi, poly)
			holesOf[i] = &multi[len(multi)-1].Holes
		} else {
			h := holesOf[parent[i]]
			*h = append(*h, ensureCW(items[i].r))
		}
	}
	return multi
}

func clonePoly(p boolPoly) boolPoly {
	out := boolPoly{Outer: append(boolRing{}, p.Outer...), Holes: make([]boolRing, len(p.Holes))}
	for i, h := range p.Holes {
		out.Holes[i] = append(boolRing{}, h...)
	}
	return out
}

func BooleanMulti(a, b boolMulti, op BooleanOperation) boolMulti {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	if len(a) == 0 {
		if op == BoolUnion || op == BoolExclude {
			out := make(boolMulti, len(b))
			for i, p := range b {
				out[i] = clonePoly(p)
			}
			return out
		}
		return nil
	}
	if len(b) == 0 {
		if op == BoolIntersect {
			return nil
		}
		out := make(boolMulti, len(a))
		for i, p := range a {
			out[i] = clonePoly(p)
		}
		return out
	}
	edges := splitEdges(append(polyEdges(a, 0), polyEdges(b, 1)...))
	kept := []boolEdge{}
	for _, e := range edges {
		m := midPt(e.A, e.B)
		sel := selectFragment(pointInMulti(m, a), pointInMulti(m, b), e.Src, op)
		if sel == "" {
			continue
		}
		if sel == "rev" {
			kept = append(kept, boolEdge{A: e.B, B: e.A})
		} else {
			kept = append(kept, boolEdge{A: e.A, B: e.B})
		}
	}
	return nestRings(linkRings(kept))
}

func multiBounds(multi boolMulti) (x, y, w, h float64) {
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, p := range multi {
		rs := append([]boolRing{p.Outer}, p.Holes...)
		for _, r := range rs {
			for _, q := range r {
				minX = math.Min(minX, q.X)
				minY = math.Min(minY, q.Y)
				maxX = math.Max(maxX, q.X)
				maxY = math.Max(maxY, q.Y)
			}
		}
	}
	if math.IsInf(minX, 1) {
		return 0, 0, 1, 1
	}
	return Round4(minX), Round4(minY), math.Max(1, Round4(maxX-minX)), math.Max(1, Round4(maxY-minY))
}

func ringToSegs(ring boolRing, closed bool) []Segment {
	if len(ring) == 0 {
		return nil
	}
	segs := []Segment{{Cmd: 'M', To: ring[0]}}
	for i := 1; i < len(ring); i++ {
		segs = append(segs, Segment{Cmd: 'L', To: ring[i]})
	}
	if closed {
		segs = append(segs, Segment{Cmd: 'Z'})
	}
	return segs
}

func multiToPath(multi boolMulti) (d string, x, y, w, h float64) {
	x, y, w, h = multiBounds(multi)
	segs := []Segment{}
	for _, p := range multi {
		segs = append(segs, ringToSegs(p.Outer, true)...)
		for _, hole := range p.Holes {
			segs = append(segs, ringToSegs(hole, true)...)
		}
	}
	return SerializePath(TranslatePath(segs, -x, -y)), x, y, w, h
}

// BooleanRings is kept for golden structure helpers that pass raw rings.
func BooleanRings(ringsA, ringsB []boolRing, op BooleanOperation) []boolRing {
	toMulti := func(rings []boolRing) boolMulti {
		cleaned := []boolRing{}
		for _, r := range rings {
			if c := cleanRing(r); len(c) >= 3 {
				cleaned = append(cleaned, c)
			}
		}
		return ringsToMulti(cleaned, "nonzero")
	}
	out := BooleanMulti(toMulti(ringsA), toMulti(ringsB), op)
	rings := []boolRing{}
	for _, p := range out {
		rings = append(rings, p.Outer)
		rings = append(rings, p.Holes...)
	}
	return rings
}

func styleFromNode(n *Node) *jsonv.Object {
	out := jsonv.NewObject()
	if n.Has("fill") {
		v, _ := n.Get("fill")
		out.Set("fill", jsonv.Clone(v))
	}
	if n.Has("gradient") {
		v, _ := n.Get("gradient")
		out.Set("gradient", jsonv.Clone(v))
	}
	if n.Has("stroke") {
		v, _ := n.Get("stroke")
		out.Set("stroke", jsonv.Clone(v))
	}
	if n.Has("opacity") && n.Num("opacity") != 1 {
		out.Set("opacity", n.Num("opacity"))
	}
	if n.Has("shadow") {
		v, _ := n.Get("shadow")
		out.Set("shadow", jsonv.Clone(v))
	}
	for _, k := range []string{"outline", "filter", "backdropFilter"} {
		if n.Has(k) {
			v, _ := n.Get(k)
			out.Set(k, jsonv.Clone(v))
		}
	}
	if n.Str("name") != "" {
		out.Set("name", n.Str("name"))
	}
	if n.Str("type") == "path" {
		fr := n.Str("fillRule")
		if fr == "" {
			fr = "nonzero"
		}
		out.Set("fillRule", fr)
		sc := n.Str("strokeCap")
		if sc == "" {
			sc = "round"
		}
		sj := n.Str("strokeJoin")
		if sj == "" {
			sj = "round"
		}
		out.Set("strokeCap", sc)
		out.Set("strokeJoin", sj)
	} else {
		out.Set("fillRule", "nonzero")
	}
	return out
}

// combineStyleOverrides are the keys of the explicit `style` object that overwrite the base node's style.
var combineStyleOverrides = []string{"fill", "gradient", "stroke", "opacity", "shadow", "outline", "filter", "backdropFilter"}

// CombinePathsOps plans create+delete ops for a boolean combine of shape nodes. op is the
// combine_paths operation: either ids + operation, or operations (a sequence of steps whose `as`
// names feed the next ones), plus optional style, id and name.
func CombinePathsOps(doc *Document, op *jsonv.Object) ([]any, string, error) {
	batch := op.Has("operations")
	if batch && (op.Has("ids") || op.Has("operation")) {
		return nil, "", errors.New("combine_paths takes either ids + operation or operations, not both")
	}
	if !batch && (!op.Has("ids") || !op.Has("operation")) {
		return nil, "", errors.New("combine_paths needs ids + operation, or operations")
	}
	type step struct {
		op    BooleanOperation
		ids   []string
		as    string
		hasAs bool
	}
	var steps []step
	if batch {
		for _, raw := range op.Arr("operations") {
			so, _ := raw.(*jsonv.Object)
			if so == nil {
				return nil, "", errors.New("combine_paths: operations must be objects")
			}
			steps = append(steps, step{op: BooleanOperation(so.Str("op")), ids: so.Strings("ids"), as: so.Str("as"), hasAs: so.Has("as")})
		}
	} else {
		steps = []step{{op: BooleanOperation(op.Str("operation")), ids: op.Strings("ids")}}
	}
	if len(steps) == 0 {
		return nil, "", errors.New("combine_paths: operations is empty")
	}

	named := map[string]boolMulti{}
	var reals []string
	var parentID any
	haveParent := false
	anchor := ""
	var result boolMulti
	for si, st := range steps {
		where := ""
		if batch {
			where = fmt.Sprintf("operations[%d] (%s): ", si, st.op)
		}
		fail := func(format string, args ...any) ([]any, string, error) {
			return nil, "", errors.New(where + fmt.Sprintf(format, args...))
		}
		if len(st.ids) < 2 {
			return fail("combine_paths needs at least two ids")
		}
		if st.op != BoolUnion && st.op != BoolSubtract && st.op != BoolIntersect && st.op != BoolExclude {
			return fail("unknown boolean operation %q; use union, subtract, intersect or exclude", string(st.op))
		}
		var unique []string
		seen := map[string]bool{}
		for _, v := range st.ids {
			if !seen[v] {
				seen[v] = true
				unique = append(unique, v)
			}
		}
		if len(unique) < 2 {
			return fail("combine_paths needs at least two distinct ids")
		}
		var missing, real []string
		for _, v := range unique {
			if _, ok := named[v]; ok {
				continue
			}
			if GetNode(doc, v) == nil {
				missing = append(missing, v)
			} else {
				real = append(real, v)
			}
		}
		if len(missing) > 0 {
			return fail("nodes do not exist: %s", strings.Join(missing, ", "))
		}
		for _, v := range real {
			n := GetNode(doc, v)
			if !combineTypes[n.Str("type")] {
				return fail("%q is %s; combine_paths only accepts path, rect, ellipse or shape", v, n.Str("type"))
			}
		}
		for _, v := range real {
			p, _ := GetNode(doc, v).Get("parentId")
			if !haveParent {
				haveParent, parentID, anchor = true, p, v
			} else if p != parentID {
				return fail("only nodes with the same parent can be combined (%q is in %s, %q in %s)", v, placeName(p), anchor, placeName(parentID))
			}
		}
		for _, v := range real {
			if indexOf(reals, v) < 0 {
				reals = append(reals, v)
			}
		}
		ordered := unique
		if st.op != BoolSubtract && len(real) == len(unique) {
			sib := siblingsOf(doc, parentID)
			ordered = append([]string(nil), unique...)
			sort.SliceStable(ordered, func(a, b int) bool { return indexOf(sib, ordered[a]) < indexOf(sib, ordered[b]) })
		}
		geom := func(id string) boolMulti {
			if m, ok := named[id]; ok {
				return m
			}
			return nodeGeometry(doc, GetNode(doc, id))
		}
		acc := geom(ordered[0])
		for i := 1; i < len(ordered); i++ {
			acc = BooleanMulti(acc, geom(ordered[i]), st.op)
		}
		if len(acc) == 0 {
			return fail("boolean %s produced an empty path", st.op)
		}
		if st.hasAs {
			if GetNode(doc, st.as) != nil {
				return fail("\"as\" name %q is already a node id; pick another name", st.as)
			}
			if _, ok := named[st.as]; ok {
				return fail("\"as\" name %q was already used by an earlier step", st.as)
			}
			named[st.as] = acc
		}
		result = acc
	}

	siblings := siblingsOf(doc, parentID)
	byZ := append([]string(nil), reals...)
	sort.SliceStable(byZ, func(a, b int) bool { return indexOf(siblings, byZ[a]) < indexOf(siblings, byZ[b]) })
	baseID := byZ[0]
	var overrides *jsonv.Object
	if cv, ok := op.Get("style"); ok {
		switch c := cv.(type) {
		case string:
			switch c {
			case "first":
				baseID = reals[0]
			case "last":
				baseID = reals[len(reals)-1]
			case "top":
				baseID = byZ[len(byZ)-1]
			case "bottom":
			default:
				return nil, "", fmt.Errorf("style %q is unknown; use first, last, bottom, top or {from, fill, ...}", c)
			}
		case *jsonv.Object:
			overrides = c
			if overrides.Has("from") {
				from := overrides.Str("from")
				f := GetNode(doc, from)
				if f == nil {
					return nil, "", fmt.Errorf("style.from %q does not exist", from)
				}
				if !combineTypes[f.Str("type")] {
					return nil, "", fmt.Errorf("style.from %q is %s; use a path, rect, ellipse or shape", from, f.Str("type"))
				}
				baseID = from
			}
		}
	}
	base := GetNode(doc, baseID)
	d, gx, gy, gw, gh := multiToPath(result)
	id := op.Str("id")
	if id == "" {
		id = NewID()
	}
	if GetNode(doc, id) != nil {
		return nil, "", fmt.Errorf("id %q already exists", id)
	}
	index := indexOf(siblings, byZ[0])
	style := styleFromNode(base)
	if overrides != nil {
		for _, k := range combineStyleOverrides {
			if v, ok := overrides.Get(k); ok {
				style.Set(k, jsonv.Clone(v))
			}
		}
		if overrides.Has("fill") && !overrides.Has("gradient") {
			style.Delete("gradient")
		}
	}
	if op.Str("name") != "" {
		style.Set("name", op.Str("name"))
	}
	hasHole := false
	for _, p := range result {
		if len(p.Holes) > 0 {
			hasHole = true
			break
		}
	}
	if hasHole {
		if base.Str("type") == "path" && base.Str("fillRule") != "" {
			style.Set("fillRule", base.Str("fillRule"))
		} else {
			style.Set("fillRule", "evenodd")
		}
	}
	node := jsonv.NewObject("type", "path", "id", id, "x", gx, "y", gy, "width", gw, "height", gh, "d", d)
	for _, k := range style.Keys() {
		v, _ := style.Get(k)
		node.Set(k, v)
	}
	ops := []any{jsonv.NewObject("op", "create", "parentId", parentID, "index", float64(index), "node", node)}
	for _, sid := range byZ {
		ops = append(ops, jsonv.NewObject("op", "delete", "id", sid))
	}
	return ops, id, nil
}

// silence unused import if strings ends unused - used in older code paths
