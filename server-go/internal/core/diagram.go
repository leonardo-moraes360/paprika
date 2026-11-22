package core

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Diagrams: shape outlines and connector routing (port of diagram.ts). A connector's geometry
// (x, y, width, height, d) is derived from from/to at the end of every transaction. Only + − × ÷
// and square roots are used, rounded with Round4, so the output matches the TypeScript reference.

// Pt is a point.
type Pt struct{ X, Y float64 }

type dbox struct{ x, y, w, h float64 }

// NoteFoldFill darkens the sticky note's folded corner.
const NoteFoldFill = "rgba(0,0,0,0.12)"

func dnum(v float64) string { return jsonv.FormatNumber(Round4(v)) }
func dpt(p Pt) string       { return dnum(p.X) + " " + dnum(p.Y) }

// ShapeDefaults are the fields a new shape gets when they are missing, by kind.
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

// ShapeOutline is the outline of a shape in local coordinates, inset half the stroke width.
// fold is "" except for the sticky note.
func ShapeOutline(n *Node) (d, fold string) {
	w, h := n.Num("width"), n.Num("height")
	sw := 0.0
	if st := n.Obj("stroke"); st != nil && st.Num("width") > 0 {
		sw = st.Num("width")
	}
	i := math.Min(sw/2, math.Min(w/2, h/2))
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

// ShapePadding is the text inset inside a shape: vertical, horizontal (px).
func ShapePadding(n *Node) (float64, float64) {
	w, h := n.Num("width"), n.Num("height")
	switch n.Str("shape") {
	case "diamond":
		return math.Max(8, h/4), math.Max(8, w/4)
	case "triangle":
		return math.Max(8, h/3), math.Max(8, w/4)
	case "ellipse":
		return math.Max(8, h*0.15), math.Max(8, w*0.15)
	}
	return 12, 12
}

// ---------------------------------------------------------------------------------------------
// Connectors

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
		} else if n.Str("type") == "shape" && (n.Str("shape") == "ellipse" || n.Str("shape") == "diamond" || n.Str("shape") == "triangle") {
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

// clipRayToTriangle is the ray-from-centre hit distance for the isosceles triangle of the box.
func clipRayToTriangle(hw, hh, dx, dy float64) float64 {
	verts := [3]Pt{{0, -hh}, {hw, hh}, {-hw, hh}}
	best := math.Inf(1)
	for k := range 3 {
		a := verts[k]
		b := verts[(k+1)%3]
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

var sideDir = map[string]Pt{"top": {0, -1}, "right": {1, 0}, "bottom": {0, 1}, "left": {-1, 0}}

func isHorizontal(s string) bool { return s == "left" || s == "right" }

const elbowStub = 16.0

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

func elbowPoints(a, b dend) []Pt {
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
	return simplifyPts(append(pts, e1, end))
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

// RouteConnector computes a connector's x, y, width, height and d. It mutates the node.
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
	var line []Pt
	if c.Str("route") == "elbow" {
		line = elbowPoints(a, b)
	} else {
		line = straightPoints(a, b)
	}
	sw := c.Obj("stroke").Num("width")
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
	all := append([]Pt{}, line...)
	for _, h := range heads {
		all = append(all, h[:]...)
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, p := range all {
		minX = math.Min(minX, p.X)
		minY = math.Min(minY, p.Y)
		maxX = math.Max(maxX, p.X)
		maxY = math.Max(maxY, p.Y)
	}
	pad := math.Max(1, sw)
	ox := Round4(minX - pad)
	oy := Round4(minY - pad)
	local := func(p Pt) Pt { return Pt{p.X - ox, p.Y - oy} }
	parts := make([]string, len(line))
	for k, p := range line {
		cmd := "L"
		if k == 0 {
			cmd = "M"
		}
		parts[k] = cmd + dpt(local(p))
	}
	var d strings.Builder
	d.WriteString(strings.Join(parts, " "))
	for _, h := range heads {
		d.WriteString(" M" + dpt(local(h[0])) + " L" + dpt(local(h[1])) + " L" + dpt(local(h[2])))
	}
	c.Set("x", Round4(ox-origin.X))
	c.Set("y", Round4(oy-origin.Y))
	c.Set("width", Round4(maxX-minX+2*pad))
	c.Set("height", Round4(maxY-minY+2*pad))
	c.Set("d", d.String())
	return nil
}

// RouteConnectors recomputes every connector of the document.
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

// ConnectorsAttachedTo lists the connectors attached to any of the ids (deleted with the shape).
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

// ---------------------------------------------------------------------------------------------
// draw_diagram: shapes + connectors in one transaction, with an optional layered layout

// DiagramPlan is what diagramOps returns.
type DiagramPlan struct {
	Ops   []any
	Nodes []string
	Edges []string
}

// JSON returns the plan as the TypeScript reference serializes it.
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

// DiagramOps plans a diagram (see diagramOps in diagram.ts). input is the validated tool input.
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
	for k, v := range nodesIn {
		n := v.(*jsonv.Object)
		nodes[k] = n
		idv, _ := n.Get("id")
		id, isStr := idv.(string)
		if !isStr || id == "" {
			return nil, errors.New("every diagram node needs an id (edges refer to it)")
		}
		if ids[id] {
			return nil, fmt.Errorf(`diagram node id "%s" is repeated`, id)
		}
		if GetNode(doc, id) != nil {
			return nil, fmt.Errorf(`id "%s" already exists; pick another id or refer to the existing node only in edges`, id)
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

	// Layers: longest path from the sources among new shapes; edges closing a cycle (found by a
	// depth-first search in input order) do not count.
	var auto []*jsonv.Object
	rank := map[string]int{}
	out := map[string][]int{}
	for _, n := range nodes {
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
		node := n.Spread()
		node.Set("type", "shape")
		if p, ok := pos[n.Str("id")]; ok {
			node.Set("x", p.X)
			node.Set("y", p.Y)
		}
		plan.Ops = append(plan.Ops, jsonv.NewObject("op", "create", "parentId", parentID, "node", node))
		plan.Nodes = append(plan.Nodes, n.Str("id"))
	}
	used := map[string]bool{}
	for id := range ids {
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
		for _, k := range []string{"name", "startArrow", "endArrow", "dashed", "stroke", "label"} {
			if v, ok := e.Get(k); ok {
				node.Set(k, jsonv.Clone(v))
			}
		}
		plan.Ops = append(plan.Ops, jsonv.NewObject("op", "create", "parentId", parentID, "node", node))
		plan.Edges = append(plan.Edges, id)
	}
	return plan, nil
}
