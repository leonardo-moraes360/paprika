package core

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type Pt struct{ X, Y float64 }

type dbox struct{ x, y, w, h float64 }

const NoteFoldFill = "rgba(0,0,0,0.12)"

const (
	cloudOX = 10.0
	cloudOY = 8.0
	cloudW  = 162.0
	cloudH  = 90.0
)

var cloudCubics = [][6]float64{
	{18, 72, 10, 54, 26, 46},
	{16, 28, 40, 14, 62, 28},
	{74, 8, 112, 8, 122, 28},
	{148, 16, 168, 38, 152, 56},
	{172, 76, 146, 96, 114, 84},
	{100, 98, 54, 96, 40, 72},
}

func cloudMap(x, y, left, top, bw, bh float64) Pt {
	return Pt{left + ((x-cloudOX)/cloudW)*bw, top + ((y-cloudOY)/cloudH)*bh}
}

func dnum(v float64) string { return jsonv.FormatNumber(Round4(v)) }
func dpt(p Pt) string       { return dnum(p.X) + " " + dnum(p.Y) }

func ShapeDefaults(kind string) *jsonv.Object {
	if kind == "note" {
		return jsonv.NewObject(
			"fill", "#ffe8a3",
			"shadow", jsonv.NewObject("x", 0.0, "y", 2.0, "blur", 6.0, "spread", 0.0, "color", "rgba(30,35,54,0.18)"),
			"textAlign", "left", "width", 160.0, "height", 160.0,
		)
	}
	o := jsonv.NewObject("fill", "#ffffff", "stroke", jsonv.NewObject("color", "#1e2336", "width", 2.0))
	if kind == "rect" {
		o.Set("radius", 8.0)
	}
	return o
}

func ShapeOutline(n *Node) (d, fold string) {
	w, h := n.Num("width"), n.Num("height")
	sw := 0.0
	pos := "inside"
	if st := n.Obj("stroke"); st != nil && st.Num("width") > 0 {
		sw = st.Num("width")
		if p := st.Str("position"); p != "" {
			pos = p
		}
	}
	half := sw / 2
	raw := 0.0
	switch pos {
	case "inside":
		raw = half
	case "outside":
		raw = -half
	}
	maxI := math.Min(w/2, h/2)
	i := math.Max(-maxI, math.Min(maxI, raw))
	switch n.Str("shape") {
	case "ellipse":
		rx := math.Max(0, w/2-i)
		ry := math.Max(0, h/2-i)
		return "M" + dpt(Pt{i, h / 2}) + " A" + dnum(rx) + " " + dnum(ry) + " 0 1 0 " + dpt(Pt{w - i, h / 2}) +
			" A" + dnum(rx) + " " + dnum(ry) + " 0 1 0 " + dpt(Pt{i, h / 2}) + " Z", ""
	case "diamond":
		return "M" + dpt(Pt{w / 2, i}) + " L" + dpt(Pt{w - i, h / 2}) + " L" + dpt(Pt{w / 2, h - i}) + " L" + dpt(Pt{i, h / 2}) + " Z", ""
	case "triangle":
		return "M" + dpt(Pt{w / 2, i}) + " L" + dpt(Pt{w - i, h - i}) + " L" + dpt(Pt{i, h - i}) + " Z", ""
	case "parallelogram":
		bw := math.Max(0, w-2*i)
		skew := math.Min(bw*0.22, bw/2)
		return "M" + dpt(Pt{i + skew, i}) + " L" + dpt(Pt{w - i, i}) + " L" + dpt(Pt{w - i - skew, h - i}) + " L" + dpt(Pt{i, h - i}) + " Z", ""
	case "cylinder":
		left, right := i, w-i
		bw := math.Max(0, right-left)
		bh := math.Max(0, h-2*i)
		rx := bw / 2
		ry := math.Min(bh*0.18, rx)
		topCy := i + ry
		botCy := h - i - ry
		if rx <= 0 || ry <= 0 || botCy < topCy {
			return "M" + dpt(Pt{left, i}) + " L" + dpt(Pt{right, i}) + " L" + dpt(Pt{right, h - i}) + " L" + dpt(Pt{left, h - i}) + " Z", ""
		}
		arc := func(sweep int, p Pt) string {
			return "A" + dnum(rx) + " " + dnum(ry) + " 0 0 " + fmt.Sprint(sweep) + " " + dpt(p)
		}
		body := strings.Join([]string{
			"M" + dpt(Pt{left, topCy}),
			"L" + dpt(Pt{left, botCy}),
			arc(1, Pt{right, botCy}),
			"L" + dpt(Pt{right, topCy}),
			arc(0, Pt{left, topCy}),
			"Z",
		}, " ")
		cap := strings.Join([]string{
			"M" + dpt(Pt{left, topCy}),
			arc(1, Pt{right, topCy}),
			arc(0, Pt{left, topCy}),
		}, " ")
		return body + " " + cap, ""
	case "cloud":
		left, top := i, i
		bw := math.Max(0, w-2*i)
		bh := math.Max(0, h-2*i)
		start := cloudMap(40, 72, left, top, bw, bh)
		parts := []string{"M" + dpt(start)}
		for _, c := range cloudCubics {
			c1 := cloudMap(c[0], c[1], left, top, bw, bh)
			c2 := cloudMap(c[2], c[3], left, top, bw, bh)
			end := cloudMap(c[4], c[5], left, top, bw, bh)
			parts = append(parts, "C"+dpt(c1)+" "+dpt(c2)+" "+dpt(end))
		}
		parts = append(parts, "Z")
		return strings.Join(parts, " "), ""
	case "note":
		f := math.Min(24, math.Min(w/4, h/4))
		return "M" + dpt(Pt{i, i}) + " L" + dpt(Pt{w - i - f, i}) + " L" + dpt(Pt{w - i, i + f}) + " L" + dpt(Pt{w - i, h - i}) + " L" + dpt(Pt{i, h - i}) + " Z",
			"M" + dpt(Pt{w - i - f, i}) + " L" + dpt(Pt{w - i - f, i + f}) + " L" + dpt(Pt{w - i, i + f}) + " Z"
	default:
		r := math.Max(0, math.Min(n.Num("radius"), math.Min(w/2, h/2))-i)
		x0, y0, x1, y1 := i, i, w-i, h-i
		if r == 0 {
			return "M" + dpt(Pt{x0, y0}) + " L" + dpt(Pt{x1, y0}) + " L" + dpt(Pt{x1, y1}) + " L" + dpt(Pt{x0, y1}) + " Z", ""
		}
		a := func(p Pt) string { return "A" + dnum(r) + " " + dnum(r) + " 0 0 1 " + dpt(p) }
		return strings.Join([]string{
			"M" + dpt(Pt{x0 + r, y0}),
			"L" + dpt(Pt{x1 - r, y0}),
			a(Pt{x1, y0 + r}),
			"L" + dpt(Pt{x1, y1 - r}),
			a(Pt{x1 - r, y1}),
			"L" + dpt(Pt{x0 + r, y1}),
			a(Pt{x0, y1 - r}),
			"L" + dpt(Pt{x0, y0 + r}),
			a(Pt{x0 + r, y0}),
			"Z",
		}, " "), ""
	}
}

func ShapePadding(n *Node) (float64, float64) {
	w, h := n.Num("width"), n.Num("height")
	switch n.Str("shape") {
	case "diamond":
		return math.Max(8, h/4), math.Max(8, w/4)
	case "triangle":
		return math.Max(8, h/3), math.Max(8, w/4)
	case "ellipse":
		return math.Max(8, h*0.15), math.Max(8, w*0.15)
	case "cylinder":
		return math.Max(12, h*0.28), 12
	case "parallelogram":
		return 12, math.Max(12, w*0.18)
	case "cloud":
		return math.Max(12, h*0.25), math.Max(12, w*0.16)
	}
	return 12, 12
}

func originOf(doc *Document, parentID any) Pt {
	x, y := 0.0, 0.0
	id, _ := parentID.(string)
	for depth := 0; id != "" && depth < 1000; depth++ {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" {
			break
		}
		x += n.Num("x")
		y += n.Num("y")
		id, _ = mustGet(n, "parentId").(string)
	}
	return Pt{x, y}
}

func canvasBox(doc *Document, n *Node) dbox {
	o := originOf(doc, mustGet(n, "parentId"))
	return dbox{o.X + n.Num("x"), o.Y + n.Num("y"), numOr0(n, "width"), numOr0(n, "height")}
}

type dend struct {
	box     *dbox
	outline string
	side    string
	p       Pt
}

func resolveEnd(doc *Document, c *Node, key string, origin Pt) (dend, error) {
	e := c.Obj(key)
	cid := c.Str("id")
	if nid, ok := e.Get("nodeId"); ok {
		nodeID := nid.(string)
		n := GetNode(doc, nodeID)
		if n == nil {
			return dend{}, fmt.Errorf(`connector "%s": %s.nodeId "%s" does not exist`, cid, key, nodeID)
		}
		if nodeID == cid {
			return dend{}, fmt.Errorf(`connector "%s": %s.nodeId cannot be the connector itself`, cid, key)
		}
		if t := n.Str("type"); t == "page" || t == "connector" {
			return dend{}, fmt.Errorf(`connector "%s": %s.nodeId "%s" is a %s; attach to a shape or another node on the canvas`, cid, key, nodeID, t)
		}
		b := canvasBox(doc, n)
		outline := "rect"
		if n.Str("type") == "ellipse" {
			outline = "ellipse"
		} else if n.Str("type") == "shape" && (n.Str("shape") == "ellipse" || n.Str("shape") == "diamond" || n.Str("shape") == "triangle" || n.Str("shape") == "parallelogram") {
			outline = n.Str("shape")
		}
		side := e.Str("side")
		if side == "auto" {
			side = ""
		}
		return dend{&b, outline, side, Pt{b.x + b.w/2, b.y + b.h/2}}, nil
	}
	if !e.Has("x") || !e.Has("y") {
		return dend{}, fmt.Errorf("connector \"%s\": %s needs a nodeId (attached end) or both x and y (free end)", cid, key)
	}
	return dend{nil, "rect", "", Pt{origin.X + e.Num("x"), origin.Y + e.Num("y")}}, nil
}

func sidePoint(b dbox, s string) Pt {
	switch s {
	case "top":
		return Pt{b.x + b.w/2, b.y}
	case "right":
		return Pt{b.x + b.w, b.y + b.h/2}
	case "bottom":
		return Pt{b.x + b.w/2, b.y + b.h}
	}
	return Pt{b.x, b.y + b.h/2}
}

func clipToOutline(e dend, toward Pt) Pt {
	b := *e.box
	c := e.p
	dx := toward.X - c.X
	dy := toward.Y - c.Y
	hw := b.w / 2
	hh := b.h / 2
	if (dx == 0 && dy == 0) || hw == 0 || hh == 0 {
		return c
	}
	var t float64
	switch e.outline {
	case "ellipse":
		t = 1 / math.Sqrt((dx/hw)*(dx/hw)+(dy/hh)*(dy/hh))
	case "diamond":
		t = 1 / (math.Abs(dx)/hw + math.Abs(dy)/hh)
	case "triangle":
		t = clipRayToTriangle(hw, hh, dx, dy)
	case "parallelogram":
		t = clipRayToParallelogram(hw, hh, dx, dy)
	default:
		tx, ty := math.Inf(1), math.Inf(1)
		if dx != 0 {
			tx = hw / math.Abs(dx)
		}
		if dy != 0 {
			ty = hh / math.Abs(dy)
		}
		t = math.Min(tx, ty)
	}
	return Pt{c.X + dx*t, c.Y + dy*t}
}

func clipRayToPolygon(verts []Pt, dx, dy float64) float64 {
	best := math.Inf(1)
	for k := range verts {
		a := verts[k]
		b := verts[(k+1)%len(verts)]
		ex, ey := b.X-a.X, b.Y-a.Y
		det := dx*ey - dy*ex
		if math.Abs(det) < 1e-12 {
			continue
		}
		t := (a.X*ey - a.Y*ex) / det
		s := (a.X*dy - a.Y*dx) / det
		if t > 1e-12 && s >= -1e-9 && s <= 1+1e-9 && t < best {
			best = t
		}
	}
	if math.IsInf(best, 1) {
		return 1
	}
	return best
}

func clipRayToTriangle(hw, hh, dx, dy float64) float64 {
	return clipRayToPolygon([]Pt{{0, -hh}, {hw, hh}, {-hw, hh}}, dx, dy)
}

func clipRayToParallelogram(hw, hh, dx, dy float64) float64 {
	skew := math.Min(hw*0.44, hw)
	return clipRayToPolygon([]Pt{{skew - hw, -hh}, {hw, -hh}, {hw - skew, hh}, {-hw, hh}}, dx, dy)
}

var sideDir = map[string]Pt{"top": {0, -1}, "right": {1, 0}, "bottom": {0, 1}, "left": {-1, 0}}

func isHorizontal(s string) bool { return s == "left" || s == "right" }

const elbowStub = 16.0
const elbowClear = 8.0

func autoSide(from, to Pt) string {
	dx := to.X - from.X
	dy := to.Y - from.Y
	if math.Abs(dx) >= math.Abs(dy) {
		if dx >= 0 {
			return "right"
		}
		return "left"
	}
	if dy >= 0 {
		return "bottom"
	}
	return "top"
}

func straightPoints(a, b dend) []Pt {
	refA, refB := a.p, b.p
	if a.box != nil && a.side != "" {
		refA = sidePoint(*a.box, a.side)
	}
	if b.box != nil && b.side != "" {
		refB = sidePoint(*b.box, b.side)
	}
	start, end := a.p, b.p
	if a.box != nil {
		if a.side != "" {
			start = refA
		} else {
			start = clipToOutline(a, refB)
		}
	}
	if b.box != nil {
		if b.side != "" {
			end = refB
		} else {
			end = clipToOutline(b, refA)
		}
	}
	return []Pt{start, end}
}

func elbowPoints(a, b dend, obstacles []dbox) []Pt {
	sa, sb := a.side, b.side
	if sa == "" {
		sa = autoSide(a.p, b.p)
	}
	if sb == "" {
		sb = autoSide(b.p, a.p)
	}
	start, end := a.p, b.p
	stubA, stubB := 0.0, 0.0
	if a.box != nil {
		start = sidePoint(*a.box, sa)
		stubA = elbowStub
	}
	if b.box != nil {
		end = sidePoint(*b.box, sb)
		stubB = elbowStub
	}
	s1 := Pt{start.X + sideDir[sa].X*stubA, start.Y + sideDir[sa].Y*stubA}
	e1 := Pt{end.X + sideDir[sb].X*stubB, end.Y + sideDir[sb].Y*stubB}
	var mid []Pt
	switch {
	case isHorizontal(sa) && isHorizontal(sb):
		mx := (s1.X + e1.X) / 2
		mid = []Pt{{mx, s1.Y}, {mx, e1.Y}}
	case !isHorizontal(sa) && !isHorizontal(sb):
		my := (s1.Y + e1.Y) / 2
		mid = []Pt{{s1.X, my}, {e1.X, my}}
	case isHorizontal(sa):
		mid = []Pt{{e1.X, s1.Y}}
	default:
		mid = []Pt{{s1.X, e1.Y}}
	}
	pts := append([]Pt{start, s1}, mid...)
	return avoidObstacles(simplifyPts(append(pts, e1, end)), obstacles)
}

func inflateBox(b dbox, m float64) dbox {
	return dbox{b.x - m, b.y - m, b.w + 2*m, b.h + 2*m}
}

func insideBox(p Pt, box dbox) bool {
	return p.X > box.x && p.X < box.x+box.w && p.Y > box.y && p.Y < box.y+box.h
}

func entryDistance(a, b Pt, box dbox) (float64, bool) {
	x0, y0 := box.x, box.y
	x1, y1 := box.x+box.w, box.y+box.h
	if math.Abs(a.Y-b.Y) <= 1e-6 {
		y := a.Y
		if y <= y0 || y >= y1 {
			return 0, false
		}
		lo := math.Max(math.Min(a.X, b.X), x0)
		hi := math.Min(math.Max(a.X, b.X), x1)
		if hi-lo <= 1e-6 {
			return 0, false
		}
		if insideBox(a, box) {
			return 0, true
		}
		entry := math.Min(a.X, x1)
		if a.X <= b.X {
			entry = math.Max(a.X, x0)
		}
		return math.Abs(entry - a.X), true
	}
	if math.Abs(a.X-b.X) <= 1e-6 {
		x := a.X
		if x <= x0 || x >= x1 {
			return 0, false
		}
		lo := math.Max(math.Min(a.Y, b.Y), y0)
		hi := math.Min(math.Max(a.Y, b.Y), y1)
		if hi-lo <= 1e-6 {
			return 0, false
		}
		if insideBox(a, box) {
			return 0, true
		}
		entry := math.Min(a.Y, y1)
		if a.Y <= b.Y {
			entry = math.Max(a.Y, y0)
		}
		return math.Abs(entry - a.Y), true
	}
	return 0, false
}

func firstHit(a, b Pt, obstacles []dbox) (dbox, bool) {
	var best dbox
	bestD := math.Inf(1)
	found := false
	for _, raw := range obstacles {
		d, ok := entryDistance(a, b, inflateBox(raw, elbowClear))
		if !ok || d >= bestD-1e-9 {
			continue
		}
		bestD = d
		best = raw
		found = true
	}
	return best, found
}

func detourSides(a, b Pt, box dbox) (float64, float64) {
	x0, y0 := box.x, box.y
	x1, y1 := box.x+box.w, box.y+box.h
	if math.Abs(a.Y-b.Y) <= 1e-6 {
		near := y1
		if a.Y-y0 <= y1-a.Y {
			near = y0
		}
		far := y0
		if near == y0 {
			far = y1
		}
		return near, far
	}
	near := x1
	if a.X-x0 <= x1-a.X {
		near = x0
	}
	far := x0
	if near == x0 {
		far = x1
	}
	return near, far
}

func buildDetour(a, b Pt, box dbox, side float64) []Pt {
	x0, y0 := box.x, box.y
	x1, y1 := box.x+box.w, box.y+box.h
	if math.Abs(a.Y-b.Y) <= 1e-6 {
		y := a.Y
		if insideBox(b, box) {
			exit := Pt{b.X, side}
			if insideBox(a, box) {
				return []Pt{{a.X, side}, exit}
			}
			entryX := math.Min(a.X, x1)
			if a.X <= b.X {
				entryX = math.Max(a.X, x0)
			}
			return []Pt{{entryX, y}, {entryX, side}, exit}
		}
		lo := math.Max(math.Min(a.X, b.X), x0)
		hi := math.Min(math.Max(a.X, b.X), x1)
		pLo := Pt{lo, y}
		pHi := Pt{hi, y}
		dLo := Pt{lo, side}
		dHi := Pt{hi, side}
		if a.X <= b.X {
			return []Pt{pLo, dLo, dHi, pHi, b}
		}
		return []Pt{pHi, dHi, dLo, pLo, b}
	}
	x := a.X
	if insideBox(b, box) {
		exit := Pt{side, b.Y}
		if insideBox(a, box) {
			return []Pt{{side, a.Y}, exit}
		}
		entryY := math.Min(a.Y, y1)
		if a.Y <= b.Y {
			entryY = math.Max(a.Y, y0)
		}
		return []Pt{{x, entryY}, {side, entryY}, exit}
	}
	lo := math.Max(math.Min(a.Y, b.Y), y0)
	hi := math.Min(math.Max(a.Y, b.Y), y1)
	pLo := Pt{x, lo}
	pHi := Pt{x, hi}
	dLo := Pt{side, lo}
	dHi := Pt{side, hi}
	if a.Y <= b.Y {
		return []Pt{pLo, dLo, dHi, pHi, b}
	}
	return []Pt{pHi, dHi, dLo, pLo, b}
}

func sideCrosses(a, b Pt, box dbox, side float64, obstacles []dbox) bool {
	x0, y0 := box.x, box.y
	x1, y1 := box.x+box.w, box.y+box.h
	var p, q Pt
	if math.Abs(a.Y-b.Y) <= 1e-6 {
		if insideBox(b, box) {
			entryX := a.X
			if !insideBox(a, box) {
				entryX = math.Min(a.X, x1)
				if a.X <= b.X {
					entryX = math.Max(a.X, x0)
				}
			}
			p = Pt{entryX, side}
			q = Pt{b.X, side}
		} else {
			lo := math.Max(math.Min(a.X, b.X), x0)
			hi := math.Min(math.Max(a.X, b.X), x1)
			p = Pt{lo, side}
			q = Pt{hi, side}
		}
	} else if insideBox(b, box) {
		entryY := a.Y
		if !insideBox(a, box) {
			entryY = math.Min(a.Y, y1)
			if a.Y <= b.Y {
				entryY = math.Max(a.Y, y0)
			}
		}
		p = Pt{side, entryY}
		q = Pt{side, b.Y}
	} else {
		lo := math.Max(math.Min(a.Y, b.Y), y0)
		hi := math.Min(math.Max(a.Y, b.Y), y1)
		p = Pt{side, lo}
		q = Pt{side, hi}
	}
	for _, raw := range obstacles {
		if _, ok := entryDistance(p, q, inflateBox(raw, elbowClear)); ok {
			return true
		}
	}
	return false
}

func detourAround(a, b Pt, raw dbox, obstacles []dbox) []Pt {
	box := inflateBox(raw, elbowClear)
	if insideBox(a, box) || insideBox(b, box) {
		if _, crosses := entryDistance(a, b, raw); !crosses {
			return []Pt{b}
		}
	}
	near, far := detourSides(a, b, box)
	if !sideCrosses(a, b, box, near, obstacles) {
		return buildDetour(a, b, box, near)
	}
	return buildDetour(a, b, box, far)
}

func avoidObstacles(pts []Pt, obstacles []dbox) []Pt {
	if len(obstacles) == 0 || len(pts) < 2 {
		return pts
	}
	cur := pts
	for range 8 {
		next := []Pt{cur[0]}
		changed := false
		for i := 0; i < len(cur)-1; i++ {
			a := next[len(next)-1]
			b := cur[i+1]
			hit, ok := firstHit(a, b, obstacles)
			if !ok {
				next = append(next, b)
				continue
			}
			changed = true
			next = append(next, detourAround(a, b, hit, obstacles)...)
		}
		cur = simplifyPts(next)
		if !changed {
			break
		}
	}
	return cur
}

func sameParent(a, b *Node) bool {
	av, aok := a.Get("parentId")
	bv, bok := b.Get("parentId")
	if !aok || !bok {
		return !aok && !bok
	}
	if av == nil || bv == nil {
		return av == nil && bv == nil
	}
	as, aok := av.(string)
	bs, bok := bv.(string)
	return aok && bok && as == bs
}

func elbowObstacles(doc *Document, c *Node) []dbox {
	skip := map[string]bool{c.Str("id"): true}
	for _, key := range []string{"from", "to"} {
		if e := c.Obj(key); e != nil {
			if v, ok := e.Get("nodeId"); ok {
				if s, isStr := v.(string); isStr {
					skip[s] = true
				}
			}
		}
	}
	var ids []string
	nodes := Nodes(doc)
	for _, id := range nodes.Keys() {
		n := nodes.Obj(id)
		if n == nil || n.Str("type") != "shape" || skip[id] || !sameParent(n, c) {
			continue
		}
		box := canvasBox(doc, n)
		if box.w <= 0 || box.h <= 0 {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]dbox, 0, len(ids))
	for _, id := range ids {
		out = append(out, canvasBox(doc, nodes.Obj(id)))
	}
	return out
}

func simplifyPts(pts []Pt) []Pt {
	same := func(p, q Pt) bool { return math.Abs(p.X-q.X) < 1e-6 && math.Abs(p.Y-q.Y) < 1e-6 }
	var uniq []Pt
	for _, p := range pts {
		if len(uniq) == 0 || !same(uniq[len(uniq)-1], p) {
			uniq = append(uniq, p)
		}
	}
	var out []Pt
	for k, p := range uniq {
		if len(out) > 0 && k+1 < len(uniq) {
			prev := out[len(out)-1]
			next := uniq[k+1]
			cross := (p.X-prev.X)*(next.Y-p.Y) - (p.Y-prev.Y)*(next.X-p.X)
			dot := (p.X-prev.X)*(next.X-p.X) + (p.Y-prev.Y)*(next.Y-p.Y)
			if math.Abs(cross) < 1e-6 && dot >= 0 {
				continue
			}
		}
		out = append(out, p)
	}
	return out
}

func arrowHead(tip, from Pt, sw float64) ([3]Pt, bool) {
	dx := tip.X - from.X
	dy := tip.Y - from.Y
	l := math.Sqrt(dx*dx + dy*dy)
	if l == 0 {
		return [3]Pt{}, false
	}
	ux := dx / l
	uy := dy / l
	size := 8 + 2*sw
	half := size / 2
	bx := tip.X - ux*size
	by := tip.Y - uy*size
	return [3]Pt{{bx - uy*half, by + ux*half}, tip, {bx + uy*half, by - ux*half}}, true
}

const curveOffset = 40.0

func defaultCurveControl(start, end Pt) Pt {
	mx := (start.X + end.X) / 2
	my := (start.Y + end.Y) / 2
	dx := end.X - start.X
	dy := end.Y - start.Y
	l := math.Sqrt(dx*dx + dy*dy)
	if l < 1e-6 {
		return Pt{mx, my - curveOffset}
	}
	return Pt{mx - (dy/l)*curveOffset, my + (dx/l)*curveOffset}
}

func quadraticToCubic(start, handle, end Pt) (c1, c2 Pt) {
	c1 = Pt{start.X + (2.0/3.0)*(handle.X-start.X), start.Y + (2.0/3.0)*(handle.Y-start.Y)}
	c2 = Pt{end.X + (2.0/3.0)*(handle.X-end.X), end.Y + (2.0/3.0)*(handle.Y-end.Y)}
	return
}

func roundedElbowPath(pts []Pt, radius float64) (dParts []string, samples []Pt) {
	if len(pts) < 2 {
		return nil, nil
	}
	if len(pts) < 3 || radius <= 0 {
		parts := make([]string, len(pts))
		for k, p := range pts {
			cmd := "L"
			if k == 0 {
				cmd = "M"
			}
			parts[k] = cmd + dpt(p)
		}
		return parts, append([]Pt{}, pts...)
	}
	samples = []Pt{pts[0]}
	dParts = []string{"M" + dpt(pts[0])}
	for i := 1; i < len(pts)-1; i++ {
		prev, cur, next := pts[i-1], pts[i], pts[i+1]
		d0x, d0y := cur.X-prev.X, cur.Y-prev.Y
		d1x, d1y := next.X-cur.X, next.Y-cur.Y
		len0 := math.Sqrt(d0x*d0x + d0y*d0y)
		len1 := math.Sqrt(d1x*d1x + d1y*d1y)
		if len0 < 1e-6 || len1 < 1e-6 {
			continue
		}
		r := math.Min(radius, math.Min(len0/2, len1/2))
		if r < 1e-6 {
			dParts = append(dParts, "L"+dpt(cur))
			samples = append(samples, cur)
			continue
		}
		ux0, uy0 := d0x/len0, d0y/len0
		ux1, uy1 := d1x/len1, d1y/len1
		pEnter := Pt{cur.X - ux0*r, cur.Y - uy0*r}
		pLeave := Pt{cur.X + ux1*r, cur.Y + uy1*r}
		dParts = append(dParts, "L"+dpt(pEnter))
		samples = append(samples, pEnter)
		cross := ux0*uy1 - uy0*ux1
		sweep := 0
		if cross > 0 {
			sweep = 1
		}
		dParts = append(dParts, fmt.Sprintf("A%s %s 0 0 %d %s", dnum(r), dnum(r), sweep, dpt(pLeave)))
		bx, by := ux1-ux0, uy1-uy0
		bl := math.Sqrt(bx*bx + by*by)
		if bl > 1e-6 {
			k := r * (math.Sqrt2 - 1)
			samples = append(samples, Pt{cur.X + (bx/bl)*k, cur.Y + (by/bl)*k})
		}
		samples = append(samples, pLeave)
	}
	last := pts[len(pts)-1]
	dParts = append(dParts, "L"+dpt(last))
	samples = append(samples, last)
	return dParts, samples
}

type connectorFrame struct {
	ox, oy, width, height float64
	local                 func(Pt) Pt
}

func newConnectorFrame(bounds []Pt, sw float64) connectorFrame {
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, p := range bounds {
		minX = math.Min(minX, p.X)
		minY = math.Min(minY, p.Y)
		maxX = math.Max(maxX, p.X)
		maxY = math.Max(maxY, p.Y)
	}
	pad := math.Max(1, sw)
	ox := Round4(minX - pad)
	oy := Round4(minY - pad)
	return connectorFrame{
		ox:     ox,
		oy:     oy,
		width:  Round4(maxX - minX + 2*pad),
		height: Round4(maxY - minY + 2*pad),
		local:  func(p Pt) Pt { return Pt{p.X - ox, p.Y - oy} },
	}
}

func finishConnector(c *Node, origin Pt, frame connectorFrame, body string, heads [][3]Pt) {
	var d strings.Builder
	d.WriteString(body)
	for _, h := range heads {
		d.WriteString(" M" + dpt(frame.local(h[0])) + " L" + dpt(frame.local(h[1])) + " L" + dpt(frame.local(h[2])))
	}
	c.Set("x", Round4(frame.ox-origin.X))
	c.Set("y", Round4(frame.oy-origin.Y))
	c.Set("width", frame.width)
	c.Set("height", frame.height)
	c.Set("d", d.String())
}

func RouteConnector(doc *Document, c *Node) error {
	origin := originOf(doc, mustGet(c, "parentId"))
	a, err := resolveEnd(doc, c, "from", origin)
	if err != nil {
		return err
	}
	b, err := resolveEnd(doc, c, "to", origin)
	if err != nil {
		return err
	}
	swRaw, _ := c.Obj("stroke").Get("width")
	sw, _ := ResolveLength(doc, swRaw, ModeOf(doc, c))
	route := c.Str("route")

	if route == "curve" {
		line := straightPoints(a, b)
		start, end := line[0], line[1]
		var handle Pt
		if ctl := c.Obj("control"); ctl != nil {
			handle = Pt{origin.X + ctl.Num("x"), origin.Y + ctl.Num("y")}
		} else {
			handle = defaultCurveControl(start, end)
		}
		c1, c2 := quadraticToCubic(start, handle, end)
		var heads [][3]Pt
		if c.Str("endArrow") == "arrow" {
			if h, ok := arrowHead(end, c2, sw); ok {
				heads = append(heads, h)
			}
		}
		if c.Str("startArrow") == "arrow" {
			if h, ok := arrowHead(start, c1, sw); ok {
				heads = append(heads, h)
			}
		}
		bounds := []Pt{start, c1, c2, end, handle}
		for _, h := range heads {
			bounds = append(bounds, h[:]...)
		}
		frame := newConnectorFrame(bounds, sw)
		body := "M" + dpt(frame.local(start)) + " C" + dpt(frame.local(c1)) + " " + dpt(frame.local(c2)) + " " + dpt(frame.local(end))
		finishConnector(c, origin, frame, body, heads)
		return nil
	}

	var line []Pt
	if route == "elbow" || route == "rounded" {
		line = elbowPoints(a, b, elbowObstacles(doc, c))
	} else {
		line = straightPoints(a, b)
	}
	var heads [][3]Pt
	if c.Str("endArrow") == "arrow" && len(line) >= 2 {
		if h, ok := arrowHead(line[len(line)-1], line[len(line)-2], sw); ok {
			heads = append(heads, h)
		}
	}
	if c.Str("startArrow") == "arrow" && len(line) >= 2 {
		if h, ok := arrowHead(line[0], line[1], sw); ok {
			heads = append(heads, h)
		}
	}

	if route == "rounded" {
		radius := c.Num("radius")
		_, samples := roundedElbowPath(line, radius)
		bounds := append([]Pt{}, samples...)
		for _, h := range heads {
			bounds = append(bounds, h[:]...)
		}
		frame := newConnectorFrame(bounds, sw)
		localLine := make([]Pt, len(line))
		for i, p := range line {
			localLine[i] = frame.local(p)
		}
		parts, _ := roundedElbowPath(localLine, radius)
		finishConnector(c, origin, frame, strings.Join(parts, " "), heads)
		return nil
	}

	all := append([]Pt{}, line...)
	for _, h := range heads {
		all = append(all, h[:]...)
	}
	frame := newConnectorFrame(all, sw)
	parts := make([]string, len(line))
	for k, p := range line {
		cmd := "L"
		if k == 0 {
			cmd = "M"
		}
		parts[k] = cmd + dpt(frame.local(p))
	}
	finishConnector(c, origin, frame, strings.Join(parts, " "), heads)
	return nil
}

func RouteConnectors(doc *Document) error {
	nodes := Nodes(doc)
	for _, id := range nodes.Keys() {
		if n := nodes.Obj(id); n != nil && n.Str("type") == "connector" {
			if err := RouteConnector(doc, n); err != nil {
				return err
			}
		}
	}
	return nil
}

func ConnectorsAttachedTo(doc *Document, ids map[string]bool) []string {
	var out []string
	nodes := Nodes(doc)
	for _, id := range nodes.Keys() {
		n := nodes.Obj(id)
		if n == nil || n.Str("type") != "connector" || ids[id] {
			continue
		}
		hit := false
		for _, k := range []string{"from", "to"} {
			if v, ok := n.Obj(k).Get("nodeId"); ok && ids[v.(string)] {
				hit = true
			}
		}
		if hit {
			out = append(out, id)
		}
	}
	return out
}

type DiagramPlan struct {
	Ops   []any
	Nodes []string
	Edges []string
}

func (p *DiagramPlan) JSON() *jsonv.Object {
	nodes := make([]any, len(p.Nodes))
	for k, v := range p.Nodes {
		nodes[k] = v
	}
	edges := make([]any, len(p.Edges))
	for k, v := range p.Edges {
		edges[k] = v
	}
	return jsonv.NewObject("ops", p.Ops, "nodes", nodes, "edges", edges)
}

func diagramSize(n *jsonv.Object) (float64, float64) {
	dw, dh := 160.0, 80.0
	if s, ok := n.Get("shape"); ok && s == "note" {
		dw, dh = 160, 160
	}
	if v, ok := n.Get("width"); ok {
		if f, isNum := v.(float64); isNum {
			dw = f
		}
	}
	if v, ok := n.Get("height"); ok {
		if f, isNum := v.(float64); isNum {
			dh = f
		}
	}
	return dw, dh
}

func isNumField(o *jsonv.Object, k string) bool {
	v, ok := o.Get(k)
	if !ok {
		return false
	}
	_, isNum := v.(float64)
	return isNum
}

func DiagramOps(doc *Document, input *jsonv.Object) (*DiagramPlan, error) {
	nodesIn := input.Arr("nodes")
	edgesIn := input.Arr("edges")
	if len(nodesIn) == 0 && len(edgesIn) == 0 {
		return nil, errors.New("pass at least one node or edge")
	}
	var parentID any
	if roots := doc.Strings("rootIds"); len(roots) > 0 {
		if n := GetNode(doc, roots[0]); n != nil && n.Str("type") == "page" {
			parentID = roots[0]
		}
	}
	if v, ok := input.Get("parentId"); ok && v != nil {
		parentID = v
	}
	if pid, ok := parentID.(string); ok {
		p := GetNode(doc, pid)
		if p == nil {
			return nil, fmt.Errorf(`parent "%s" does not exist`, pid)
		}
		if t := p.Str("type"); t != "frame" && t != "page" && t != "group" {
			return nil, fmt.Errorf(`parent "%s" is %s; only frame, group and page have children`, pid, t)
		}
	}
	nodes := make([]*jsonv.Object, len(nodesIn))
	ids := map[string]bool{}
	existing := map[string]*Node{}
	relayout := input.Bool("relayout")
	for k, v := range nodesIn {
		n := v.(*jsonv.Object)
		nodes[k] = n
		idv, _ := n.Get("id")
		id, isStr := idv.(string)
		if !isStr || id == "" {
			return nil, errors.New("every diagram node needs an id (edges refer to it)")
		}
		if ids[id] || existing[id] != nil {
			return nil, fmt.Errorf(`diagram node id "%s" is repeated`, id)
		}
		if prev := GetNode(doc, id); prev != nil {
			if !relayout {
				return nil, fmt.Errorf(`id "%s" already exists; pick another id or refer to the existing node only in edges`, id)
			}
			if prev.Str("type") != "shape" {
				return nil, fmt.Errorf(`id "%s" is a %s; relayout only updates existing shapes`, id, prev.Str("type"))
			}
			existing[id] = prev
			continue
		}
		ids[id] = true
	}
	edges := make([]*jsonv.Object, len(edgesIn))
	for k, v := range edgesIn {
		e := v.(*jsonv.Object)
		edges[k] = e
		for _, end := range []string{e.Str("from"), e.Str("to")} {
			if !ids[end] && GetNode(doc, end) == nil {
				return nil, fmt.Errorf(`edges[%d]: "%s" is neither a diagram node nor an existing node`, k, end)
			}
		}
	}

	var auto []*jsonv.Object
	rank := map[string]int{}
	out := map[string][]int{}
	for _, n := range nodes {
		if existing[n.Str("id")] != nil {
			continue
		}
		if !isNumField(n, "x") || !isNumField(n, "y") {
			auto = append(auto, n)
			rank[n.Str("id")] = 0
			out[n.Str("id")] = nil
		}
	}
	for k, e := range edges {
		_, okF := rank[e.Str("from")]
		_, okT := rank[e.Str("to")]
		if okF && okT && e.Str("from") != e.Str("to") {
			out[e.Str("from")] = append(out[e.Str("from")], k)
		}
	}
	state := map[string]int{}
	var forward []*jsonv.Object
	var visit func(id string)
	visit = func(id string) {
		state[id] = 1
		for _, k := range out[id] {
			to := edges[k].Str("to")
			st := state[to]
			if st == 1 {
				continue
			}
			forward = append(forward, edges[k])
			if st == 0 {
				visit(to)
			}
		}
		state[id] = 2
	}
	for _, n := range auto {
		if _, seen := state[n.Str("id")]; !seen {
			visit(n.Str("id"))
		}
	}
	for pass, changed := 0, true; changed && pass <= len(auto); pass++ {
		changed = false
		for _, e := range forward {
			next := rank[e.Str("from")] + 1
			if rank[e.Str("to")] < next {
				rank[e.Str("to")] = next
				changed = true
			}
		}
	}
	maxRank := -1
	for _, n := range auto {
		if r := rank[n.Str("id")]; r > maxRank {
			maxRank = r
		}
	}
	layers := make([][]*jsonv.Object, maxRank+1)
	for _, n := range auto {
		r := rank[n.Str("id")]
		layers[r] = append(layers[r], n)
	}
	var rows [][]*jsonv.Object
	for _, l := range layers {
		if len(l) > 0 {
			rows = append(rows, l)
		}
	}
	cellW, cellH := 0.0, 0.0
	for _, n := range auto {
		w, h := diagramSize(n)
		cellW = math.Max(cellW, w)
		cellH = math.Max(cellH, h)
	}
	gap := 64.0
	if v, ok := input.Get("gap"); ok {
		gap = v.(float64)
	}
	down := input.Str("direction") == "" || input.Str("direction") == "down"
	var ox, oy float64
	hasX, hasY := input.Has("x"), input.Has("y")
	if hasX {
		ox = input.Num("x")
	}
	if hasY {
		oy = input.Num("y")
	}
	if !hasX || !hasY {
		var siblings []string
		if pid, ok := parentID.(string); ok {
			siblings = GetNode(doc, pid).Strings("children")
		} else {
			siblings = doc.Strings("rootIds")
		}
		right, top := math.Inf(-1), math.Inf(1)
		for _, id := range siblings {
			s := GetNode(doc, id)
			if s == nil || s.Str("type") == "page" {
				continue
			}
			right = math.Max(right, s.Num("x")+numOr0(s, "width"))
			top = math.Min(top, s.Num("y"))
		}
		empty := math.IsInf(right, -1)
		inset := 0.0
		if pid, ok := parentID.(string); ok && GetNode(doc, pid).Str("type") == "frame" {
			inset = 24
		}
		if !hasX {
			if empty {
				ox = inset
			} else {
				ox = jsonv.Round(right + 80)
			}
		}
		if !hasY {
			if empty {
				oy = inset
			} else {
				oy = jsonv.Round(top)
			}
		}
	}
	widest := 0
	for _, l := range rows {
		if len(l) > widest {
			widest = len(l)
		}
	}
	pos := map[string]Pt{}
	for r, layer := range rows {
		for k, n := range layer {
			w, h := diagramSize(n)
			stepAlong, stepAcross := cellH, cellW
			if down {
				stepAlong, stepAcross = cellW, cellH
			}
			along := (float64(widest-len(layer))/2 + float64(k)) * (stepAlong + gap)
			across := float64(r) * (stepAcross + gap)
			var x, y float64
			if down {
				x = along + (cellW-w)/2
				y = across + (cellH-h)/2
			} else {
				x = across + (cellW-w)/2
				y = along + (cellH-h)/2
			}
			pos[n.Str("id")] = Pt{jsonv.Round(ox + x), jsonv.Round(oy + y)}
		}
	}

	plan := &DiagramPlan{Ops: []any{}, Nodes: []string{}, Edges: []string{}}
	for _, n := range nodes {
		id := n.Str("id")
		if prev := existing[id]; prev != nil {
			props := jsonv.NewObject()
			if isNumField(n, "x") {
				props.Set("x", n.Num("x"))
			}
			if isNumField(n, "y") {
				props.Set("y", n.Num("y"))
			}
			if props.Len() == 0 {
				props.Set("x", prev.Num("x"))
			}
			plan.Ops = append(plan.Ops, jsonv.NewObject("op", "update", "id", id, "props", props))
			plan.Nodes = append(plan.Nodes, id)
			continue
		}
		node := n.Spread()
		node.Set("type", "shape")
		if p, ok := pos[id]; ok {
			node.Set("x", p.X)
			node.Set("y", p.Y)
		}
		plan.Ops = append(plan.Ops, jsonv.NewObject("op", "create", "parentId", parentID, "node", node))
		plan.Nodes = append(plan.Nodes, id)
	}
	used := map[string]bool{}
	for id := range ids {
		used[id] = true
	}
	for id := range existing {
		used[id] = true
	}
	for _, e := range edges {
		var id string
		if v, ok := e.Get("id"); ok {
			id = v.(string)
		} else {
			base := e.Str("from") + "-to-" + e.Str("to")
			id = base
			for k := 2; used[id] || GetNode(doc, id) != nil; k++ {
				id = fmt.Sprintf("%s-%d", base, k)
			}
		}
		used[id] = true
		end := func(nodeID, sideKey string) *jsonv.Object {
			o := jsonv.NewObject("nodeId", nodeID)
			if s, ok := e.Get(sideKey); ok {
				o.Set("side", s)
			}
			return o
		}
		route := any("elbow")
		if v, ok := e.Get("route"); ok {
			route = v
		}
		node := jsonv.NewObject("type", "connector", "id", id, "from", end(e.Str("from"), "fromSide"), "to", end(e.Str("to"), "toSide"), "route", route)
		for _, k := range []string{"name", "startArrow", "endArrow", "dashed", "stroke", "label", "radius", "control"} {
			if v, ok := e.Get(k); ok {
				node.Set(k, jsonv.Clone(v))
			}
		}
		plan.Ops = append(plan.Ops, jsonv.NewObject("op", "create", "parentId", parentID, "node", node))
		plan.Edges = append(plan.Edges, id)
	}
	return plan, nil
}
