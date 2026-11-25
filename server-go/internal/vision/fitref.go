package vision

import (
	"errors"
	"fmt"
	"image"
	"math"
	"sort"
	"time"
)

// Fit tunes the numbers of a drawing against a reference. The structure (which shapes, in what
// order) comes from the agent; here a few parameters of chosen nodes (position, size, rotation,
// radius, path anchors) are searched to maximize the ink IoU of the frame against the reference.
//
// The frame is not screenshotted per try. The ink of everything that is not being tuned comes
// from one render with the tuned nodes left out (Fixed); the tuned nodes are rasterized here with
// a scanline filler (rects, rounded rects, ellipses and paths with rotation and fill rule) onto
// the same ink mask that Compare measures, and the IoU is updated incrementally for each try.
// Coordinate descent with a shrinking step, first on a coarse canvas, then on the compare canvas.

const (
	fitCoarseSide = 400
	fitMaxNodes   = 200
	fitFineRounds = 14
	fitLineSearch = 8
	fitMinIoUGain = 1e-7
)

// FitAnchor is one anchor of a path in the node's local coordinates, with its handles.
type FitAnchor struct {
	X, Y    float64
	In, Out *Point
}

// FitSub is one subpath.
type FitSub struct {
	Anchors []FitAnchor
	Closed  bool
}

// FitFree says which parameters of a node may move.
type FitFree struct {
	Position, Size, Rotation, Radius, PathPoints bool
	MaxAnchors                                   int // anchors of a path that may move (the ones with the largest local error); default 8
}

// FitNode is a node as the rasterizer needs it: its box in frame coordinates (rotation in
// degrees, clockwise, about the box center) and how it paints.
type FitNode struct {
	ID, Kind        string // rect, ellipse or path
	X, Y, W, H, Rot float64
	Radius          [4]float64 // rect corners: tl, tr, br, bl
	Path            []FitSub
	ViewBox         *[4]float64 // path viewBox; when set the geometry scales with the box and anchors stay put
	EvenOdd         bool

	Fill, Stroke                bool
	FillRGB, StrokeRGB          *[3]uint8 // nil: a color that cannot be read (token, gradient): counts as ink
	Alpha                       float64   // node opacity times the paint's own alpha; 0 means 1
	StrokeWidth                 float64
	StrokeInside, StrokeOutside bool
	Free                        FitFree
}

// FitInput is everything Fit needs. Fixed is the frame rendered without the nodes in Nodes.
type FitInput struct {
	Ref, Fixed     image.Image
	FrameW, FrameH float64
	Placed         Rect
	Nodes          []FitNode
	MaxIterations  int     // rounds over all nodes; default 60
	Target         float64 // stop once the mask IoU reaches it
	Deadline       time.Time
}

// FitMove is an anchor moved by (DX, DY) (handles move with it), indexed like path_info.anchors.
type FitMove struct {
	Index  int
	DX, DY float64
}

// FitNodeResult is the tuned state of one node.
type FitNodeResult struct {
	ID          string
	X, Y, W, H  float64
	Rot         float64
	Radius      [4]float64
	Moves       []FitMove
	Path        []FitSub // the whole path after size and anchor moves, in local coordinates (no viewBox)
	Changed     map[string]bool
	Skipped     string // why the node was not tuned, when it was not
	Contributes bool
}

// FitResult is the outcome.
type FitResult struct {
	Nodes     []FitNodeResult
	IoUBefore float64 // on the compare canvas, from the rasterizer
	IoUAfter  float64
	Rounds    int
	Canvas    Size
	Warnings  []string
	TimedOut  bool
}

const (
	pX = iota
	pY
	pW
	pH
	pRot
	pRad
	pAX
	pAY
	pL // left edge: grows the box to the left, keeping its right edge in the rotated frame
	pT
)

type fparam struct {
	kind, i  int
	base     float64 // first step, frame units (degrees for pRot, a factor for a radius scale)
	lo, hi   float64
	hasRange bool
}

type fstate struct {
	X, Y, W, H, Rot, R float64
	D                  []Point
}

type aref struct{ sub, idx, flat int }

type fnode struct {
	in        FitNode
	st, init  fstate
	w0, h0    float64
	rFactor   bool // R scales the corner radii instead of being the radius
	fillInk   bool
	strokeInk bool
	anchors   []aref
	params    []fparam
	cur, cand rmask
	bad       int
	skipped   string
}

type fpt struct{ x, y float64 }

type fpoly struct {
	pts    []fpt
	closed bool
}

// rmask is a binary mask over a rectangle of the canvas.
type rmask struct {
	x0, y0, w, h int
	bits         []bool
}

func (m *rmask) reset(x0, y0, x1, y1 int) {
	if x1 < x0 {
		x1 = x0
	}
	if y1 < y0 {
		y1 = y0
	}
	m.x0, m.y0, m.w, m.h = x0, y0, x1-x0, y1-y0
	n := m.w * m.h
	if cap(m.bits) < n {
		m.bits = make([]bool, n)
	} else {
		m.bits = m.bits[:n]
		clear(m.bits)
	}
}

func (m *rmask) at(x, y int) bool {
	x -= m.x0
	y -= m.y0
	if x < 0 || y < 0 || x >= m.w || y >= m.h {
		return false
	}
	return m.bits[y*m.w+x]
}

// scan fills polygons with the nonzero or even-odd rule at pixel centers.
type scan struct {
	cross []crossing
}

type crossing struct {
	x float64
	d int
}

func (s *scan) fill(m *rmask, polys []fpoly, evenOdd bool) {
	for y := m.y0; y < m.y0+m.h; y++ {
		yc := float64(y) + 0.5
		s.cross = s.cross[:0]
		for _, p := range polys {
			n := len(p.pts)
			if n < 3 {
				continue
			}
			for i := range n {
				a, b := p.pts[i], p.pts[(i+1)%n]
				if (a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc) {
					x := a.x + (yc-a.y)*(b.x-a.x)/(b.y-a.y)
					d := 1
					if b.y < a.y {
						d = -1
					}
					s.cross = append(s.cross, crossing{x, d})
				}
			}
		}
		c := s.cross
		if len(c) < 2 {
			continue
		}
		sort.Slice(c, func(i, j int) bool { return c[i].x < c[j].x })
		wind := 0
		for k := 0; k < len(c)-1; k++ {
			if evenOdd {
				wind ^= 1
			} else {
				wind += c[k].d
			}
			if wind == 0 {
				continue
			}
			xs := int(math.Ceil(c[k].x - 0.5))
			xe := int(math.Ceil(c[k+1].x - 0.5))
			xs, xe = max(xs, m.x0), min(xe, m.x0+m.w)
			row := m.bits[(y-m.y0)*m.w : (y-m.y0+1)*m.w]
			for x := xs; x < xe; x++ {
				row[x-m.x0] = true
			}
		}
	}
}

// fcanvas is the working canvas of one stage: the reference ink, the ink of the rest of the
// frame, and how many tuned nodes cover each pixel.
type fcanvas struct {
	w, h        int
	fx, fy      float64
	ref, fixed  []bool
	cover       []uint16
	nRef        int
	nInk, inter int
}

func newFCanvas(cv canvasPlanes) *fcanvas {
	c := &fcanvas{w: cv.w, h: cv.h, fx: cv.fx, fy: cv.fy, ref: cv.rp.ink, fixed: cv.dp.ink, cover: make([]uint16, cv.w*cv.h)}
	for i := range c.ref {
		if c.ref[i] {
			c.nRef++
		}
		if c.fixed[i] {
			c.nInk++
			if c.ref[i] {
				c.inter++
			}
		}
	}
	return c
}

func (c *fcanvas) iou() float64 { return c.iouOf(0, 0) }

func (c *fcanvas) iouOf(dInk, dInter int) float64 {
	inter := c.inter + dInter
	uni := c.nRef + c.nInk + dInk - inter
	if uni <= 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

func unionRect(a, b *rmask) (x0, y0, x1, y1 int) {
	switch {
	case a.w*a.h == 0 && b.w*b.h == 0:
		return 0, 0, 0, 0
	case a.w*a.h == 0:
		return b.x0, b.y0, b.x0 + b.w, b.y0 + b.h
	case b.w*b.h == 0:
		return a.x0, a.y0, a.x0 + a.w, a.y0 + a.h
	}
	return min(a.x0, b.x0), min(a.y0, b.y0), max(a.x0+a.w, b.x0+b.w), max(a.y0+a.h, b.y0+b.h)
}

// delta is the change in drawn ink pixels and in ink intersection if old were replaced by nw.
func (c *fcanvas) delta(old, nw *rmask) (dInk, dInter int) {
	x0, y0, x1, y1 := unionRect(old, nw)
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			o, n := old.at(x, y), nw.at(x, y)
			if o == n {
				continue
			}
			i := y*c.w + x
			cov := int(c.cover[i])
			ncov := cov
			if o {
				ncov--
			}
			if n {
				ncov++
			}
			was, is := c.fixed[i] || cov > 0, c.fixed[i] || ncov > 0
			if was == is {
				continue
			}
			if is {
				dInk++
				if c.ref[i] {
					dInter++
				}
			} else {
				dInk--
				if c.ref[i] {
					dInter--
				}
			}
		}
	}
	return dInk, dInter
}

func (c *fcanvas) apply(old, nw *rmask) {
	x0, y0, x1, y1 := unionRect(old, nw)
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			o, n := old.at(x, y), nw.at(x, y)
			if o == n {
				continue
			}
			i := y*c.w + x
			cov := c.cover[i]
			was := c.fixed[i] || cov > 0
			if o {
				cov--
			}
			if n {
				cov++
			}
			c.cover[i] = cov
			is := c.fixed[i] || cov > 0
			if was == is {
				continue
			}
			d := 1
			if !is {
				d = -1
			}
			c.nInk += d
			if c.ref[i] {
				c.inter += d
			}
		}
	}
}

func (c *fcanvas) add(m *rmask) {
	empty := rmask{}
	c.apply(&empty, m)
}

func (c *fcanvas) drawnAt(i int) bool { return c.fixed[i] || c.cover[i] > 0 }

// paintInk tells whether a paint shows up as ink against the frame's background.
func paintInk(rgb *[3]uint8, alpha float64, bg bgInfo) bool {
	if alpha <= 0 {
		alpha = 1
	}
	if bg.transparent {
		return alpha >= 0.5
	}
	if rgb == nil {
		return alpha >= 0.05
	}
	f := min(1, alpha)
	r := float64(rgb[0])*f + float64(bg.r)*(1-f)
	g := float64(rgb[1])*f + float64(bg.g)*(1-f)
	b := float64(rgb[2])*f + float64(bg.b)*(1-f)
	return labFromBytes(uint8(math.Round(r)), uint8(math.Round(g)), uint8(math.Round(b))).dist2(labFromBytes(bg.r, bg.g, bg.b)) > inkThreshold*inkThreshold
}

func wrapDeg(a float64) float64 {
	a = math.Mod(a+180, 360)
	if a < 0 {
		a += 360
	}
	return a - 180
}

func (n *fnode) get(p fparam) float64 {
	switch p.kind {
	case pX:
		return n.st.X
	case pY:
		return n.st.Y
	case pW:
		return n.st.W
	case pH:
		return n.st.H
	case pRot:
		return n.st.Rot
	case pRad:
		return n.st.R
	case pAX:
		return n.st.D[p.i].X
	case pL:
		return -n.st.W
	case pT:
		return -n.st.H
	}
	return n.st.D[p.i].Y
}

func (n *fnode) set(p fparam, v float64) {
	if p.hasRange {
		v = math.Max(p.lo, math.Min(p.hi, v))
	}
	switch p.kind {
	case pX:
		n.st.X = v
	case pY:
		n.st.Y = v
	case pW, pL:
		if p.kind == pL {
			v = -v
		}
		dw := v - n.st.W
		sin, cos := n.sincos()
		k := 1.0 // the edge that moves: right (+1) or left (-1)
		if p.kind == pL {
			k = -1
		}
		n.st.X += -dw/2 + k*dw/2*cos
		n.st.Y += k * dw / 2 * sin
		n.st.W = v
		n.clampRadius()
	case pH, pT:
		if p.kind == pT {
			v = -v
		}
		dh := v - n.st.H
		sin, cos := n.sincos()
		k := 1.0
		if p.kind == pT {
			k = -1
		}
		n.st.X += -k * dh / 2 * sin
		n.st.Y += -dh/2 + k*dh/2*cos
		n.st.H = v
		n.clampRadius()
	case pRot:
		n.st.Rot = wrapDeg(v)
	case pRad:
		n.st.R = v
		n.clampRadius()
	case pAX:
		n.st.D[p.i].X = v
	case pAY:
		n.st.D[p.i].Y = v
	}
}

func (n *fnode) sincos() (float64, float64) {
	rad := n.st.Rot * math.Pi / 180
	return math.Sin(rad), math.Cos(rad)
}

func (n *fnode) clampRadius() {
	if !n.rFactor {
		n.st.R = math.Max(0, math.Min(n.st.R, math.Min(n.st.W, n.st.H)/2))
	}
}

// radii are the corner radii of the current state, kept inside the box.
func (n *fnode) radii() [4]float64 {
	var r [4]float64
	for i := range r {
		if n.rFactor {
			r[i] = n.in.Radius[i] * n.st.R
		} else {
			r[i] = n.st.R
		}
		r[i] = math.Max(0, math.Min(r[i], math.Min(n.st.W, n.st.H)/2))
	}
	return r
}

// toFrame maps node-local coordinates (box top-left origin, before rotation) to frame coordinates.
func (n *fnode) toFrame(lx, ly float64) fpt {
	cx, cy := n.st.W/2, n.st.H/2
	dx, dy := lx-cx, ly-cy
	if n.st.Rot != 0 {
		rad := n.st.Rot * math.Pi / 180
		s, c := math.Sin(rad), math.Cos(rad)
		dx, dy = dx*c-dy*s, dx*s+dy*c
	}
	return fpt{n.st.X + cx + dx, n.st.Y + cy + dy}
}

// local maps a path point (path units) to node-local coordinates.
func (n *fnode) local(x, y float64, d Point) (float64, float64) {
	if vb := n.in.ViewBox; vb != nil && vb[2] > 0 && vb[3] > 0 {
		s := math.Min(n.st.W/vb[2], n.st.H/vb[3])
		return (x-vb[0])*s + (n.st.W-vb[2]*s)/2, (y-vb[1])*s + (n.st.H-vb[3]*s)/2
	}
	return x*n.st.W/n.w0 + d.X, y*n.st.H/n.h0 + d.Y
}

// polys builds the outlines of the node in canvas pixels.
func (n *fnode) polys(fx, fy float64) []fpoly {
	px := func(lx, ly float64) fpt {
		p := n.toFrame(lx, ly)
		return fpt{p.x / fx, p.y / fy}
	}
	w, h := n.st.W, n.st.H
	kpx := 1 / math.Max(fx, 1e-9)
	switch n.in.Kind {
	case "ellipse":
		steps := max(16, min(160, int(math.Pi*(w+h)/2*kpx/2)))
		pts := make([]fpt, steps)
		for i := range steps {
			a := 2 * math.Pi * float64(i) / float64(steps)
			pts[i] = px(w/2+w/2*math.Cos(a), h/2+h/2*math.Sin(a))
		}
		return []fpoly{{pts: pts, closed: true}}
	case "rect":
		r := n.radii()
		var pts []fpt
		corner := func(cx, cy, rad, a0 float64) {
			if rad < 1e-6 {
				pts = append(pts, px(cx, cy))
				return
			}
			steps := max(2, min(24, int(rad*kpx/1.5)+2))
			for i := 0; i <= steps; i++ {
				a := (a0 + 90*float64(i)/float64(steps)) * math.Pi / 180
				pts = append(pts, px(cx+rad*math.Cos(a), cy+rad*math.Sin(a)))
			}
		}
		corner(r[0], r[0], r[0], 180)
		corner(w-r[1], r[1], r[1], 270)
		corner(w-r[2], h-r[2], r[2], 0)
		corner(r[3], h-r[3], r[3], 90)
		return []fpoly{{pts: pts, closed: true}}
	}
	var out []fpoly
	flat := 0
	for _, sub := range n.in.Path {
		cnt := len(sub.Anchors)
		if cnt == 0 {
			continue
		}
		type lp struct{ x, y float64 }
		at := func(i int) (lp, lp, lp) { // position, in-handle, out-handle in local coordinates
			a := sub.Anchors[i]
			var d Point
			for k, r := range n.anchors {
				if r.flat == flat+i {
					d = n.st.D[k]
				}
			}
			x, y := n.local(a.X, a.Y, d)
			in, ou := lp{x, y}, lp{x, y}
			if a.In != nil {
				ix, iy := n.local(a.In.X, a.In.Y, d)
				in = lp{ix, iy}
			}
			if a.Out != nil {
				ox, oy := n.local(a.Out.X, a.Out.Y, d)
				ou = lp{ox, oy}
			}
			return lp{x, y}, in, ou
		}
		var pts []fpt
		p0, _, _ := at(0)
		pts = append(pts, px(p0.x, p0.y))
		segs := cnt - 1
		if sub.Closed && cnt > 1 {
			segs = cnt
		}
		for i := range segs {
			a, _, aOut := at(i)
			b, bIn, _ := at((i + 1) % cnt)
			straight := sub.Anchors[i].Out == nil && sub.Anchors[(i+1)%cnt].In == nil
			if straight {
				pts = append(pts, px(b.x, b.y))
				continue
			}
			ctrl := math.Hypot(aOut.x-a.x, aOut.y-a.y) + math.Hypot(bIn.x-aOut.x, bIn.y-aOut.y) + math.Hypot(b.x-bIn.x, b.y-bIn.y)
			steps := max(6, min(64, int(ctrl*kpx/3)+4))
			for s := 1; s <= steps; s++ {
				t := float64(s) / float64(steps)
				mt := 1 - t
				x := mt*mt*mt*a.x + 3*mt*mt*t*aOut.x + 3*mt*t*t*bIn.x + t*t*t*b.x
				y := mt*mt*mt*a.y + 3*mt*mt*t*aOut.y + 3*mt*t*t*bIn.y + t*t*t*b.y
				pts = append(pts, px(x, y))
			}
		}
		if sub.Closed && len(pts) > 1 && math.Hypot(pts[0].x-pts[len(pts)-1].x, pts[0].y-pts[len(pts)-1].y) < 1e-6 {
			pts = pts[:len(pts)-1]
		}
		out = append(out, fpoly{pts: pts, closed: sub.Closed})
		flat += cnt
	}
	return out
}

// strokePolys turns outlines into quads along the edges plus discs at the vertices (round joins).
func strokePolys(polys []fpoly, half float64) []fpoly {
	var out []fpoly
	orient := func(p []fpt) []fpt {
		a := 0.0
		for i := range p {
			j := (i + 1) % len(p)
			a += p[i].x*p[j].y - p[j].x*p[i].y
		}
		if a < 0 {
			for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
				p[i], p[j] = p[j], p[i]
			}
		}
		return p
	}
	disc := func(c fpt) {
		steps := max(8, min(24, int(half*3)))
		pts := make([]fpt, steps)
		for i := range steps {
			a := 2 * math.Pi * float64(i) / float64(steps)
			pts[i] = fpt{c.x + half*math.Cos(a), c.y + half*math.Sin(a)}
		}
		out = append(out, fpoly{pts: orient(pts), closed: true})
	}
	for _, p := range polys {
		n := len(p.pts)
		segs := n - 1
		if p.closed {
			segs = n
		}
		for i := range segs {
			a, b := p.pts[i], p.pts[(i+1)%n]
			dx, dy := b.x-a.x, b.y-a.y
			l := math.Hypot(dx, dy)
			if l < 1e-9 {
				continue
			}
			nx, ny := -dy/l*half, dx/l*half
			out = append(out, fpoly{pts: orient([]fpt{{a.x + nx, a.y + ny}, {b.x + nx, b.y + ny}, {b.x - nx, b.y - ny}, {a.x - nx, a.y - ny}}), closed: true})
		}
		if half > 1 {
			for _, v := range p.pts {
				disc(v)
			}
		}
	}
	return out
}

// raster paints the node's ink at the current state into m.
func (n *fnode) raster(s *scan, c *fcanvas, m *rmask) {
	polys := n.polys(c.fx, c.fy)
	var stroke []fpoly
	if n.strokeInk && n.in.StrokeWidth > 0 {
		w := n.in.StrokeWidth
		if n.in.Fill && n.in.StrokeInside {
			w = 0
		} else if n.in.Fill && n.in.StrokeOutside {
			w *= 2
		}
		if w > 0 {
			stroke = strokePolys(polys, w/c.fx/2)
		}
	}
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	grow := func(ps []fpoly) {
		for _, p := range ps {
			for _, q := range p.pts {
				minX, maxX = math.Min(minX, q.x), math.Max(maxX, q.x)
				minY, maxY = math.Min(minY, q.y), math.Max(maxY, q.y)
			}
		}
	}
	if n.fillInk {
		grow(polys)
	}
	grow(stroke)
	if math.IsInf(minX, 1) || math.IsNaN(minX) || math.IsNaN(maxX) || math.IsNaN(minY) || math.IsNaN(maxY) {
		m.reset(0, 0, 0, 0)
		return
	}
	x0, y0 := max(0, int(math.Floor(minX))), max(0, int(math.Floor(minY)))
	x1, y1 := min(c.w, int(math.Ceil(maxX))+1), min(c.h, int(math.Ceil(maxY))+1)
	if x1 <= x0 || y1 <= y0 {
		m.reset(0, 0, 0, 0)
		return
	}
	m.reset(x0, y0, x1, y1)
	if n.fillInk {
		s.fill(m, polys, n.in.EvenOdd)
	}
	if len(stroke) > 0 {
		s.fill(m, stroke, false)
	}
}

type fsearch struct {
	c        *fcanvas
	sc       scan
	nodes    []*fnode
	deadline time.Time
	timedOut bool
}

func (sg *fsearch) rasterAll() {
	for _, n := range sg.nodes {
		n.raster(&sg.sc, sg.c, &n.cur)
		sg.c.add(&n.cur)
	}
}

// try moves one parameter of n to v and keeps it when the IoU improves. It returns whether it did.
func (sg *fsearch) try(n *fnode, p fparam, v float64, cur *float64, minGain float64) bool {
	old, oldR := n.get(p), n.st.R
	n.set(p, v)
	if n.get(p) == old {
		return false
	}
	n.raster(&sg.sc, sg.c, &n.cand)
	dInk, dInter := sg.c.delta(&n.cur, &n.cand)
	if next := sg.c.iouOf(dInk, dInter); next > *cur+minGain {
		sg.c.apply(&n.cur, &n.cand)
		n.cur, n.cand = n.cand, n.cur
		*cur = next
		return true
	}
	n.set(p, old)
	n.st.R = oldR // a size change may have clamped the radius
	return false
}

// rounds runs up to maxRounds sweeps with the step scale going from sigma down to minSigma.
func (sg *fsearch) rounds(maxRounds int, sigma, minSigma, target float64) int {
	cur := sg.c.iou()
	done := 0
	for done < maxRounds && sigma >= minSigma && cur < target {
		done++
		improved := false
		for _, n := range sg.nodes {
			if !sg.deadline.IsZero() && time.Now().After(sg.deadline) {
				sg.timedOut = true
				return done
			}
			for _, p := range n.params {
				step := p.base * sigma
				for _, dir := range []float64{1, -1} {
					base := n.get(p)
					if !sg.try(n, p, base+dir*step, &cur, fitMinIoUGain) {
						continue
					}
					improved = true
					for range fitLineSearch {
						if !sg.try(n, p, n.get(p)+dir*step, &cur, fitMinIoUGain) {
							break
						}
					}
					break
				}
			}
		}
		if !improved {
			sigma /= 2
		}
	}
	return done
}

// snap rounds the tuned numbers to whole (or half) units where that does not lower the IoU, so
// the agent gets 120 and not 120.15.
func (sg *fsearch) snap() {
	cur := sg.c.iou()
	for _, n := range sg.nodes {
		for _, p := range n.params {
			switch {
			case p.kind == pL, p.kind == pT, p.kind == pAX, p.kind == pAY, p.kind == pRad && n.rFactor:
				continue
			}
			for _, q := range []float64{math.Round(n.get(p)), math.Round(n.get(p)*2) / 2} {
				if q != n.get(p) && sg.try(n, p, q, &cur, -1e-9) {
					break
				}
			}
		}
	}
}

// FitReference searches the parameters of in.Nodes.
func FitReference(in FitInput) (*FitResult, error) {
	if in.Ref == nil || in.Fixed == nil {
		return nil, errors.New("fit needs a reference and a render")
	}
	if in.FrameW <= 0 || in.FrameH <= 0 {
		return nil, errors.New("the frame has no size")
	}
	if len(in.Nodes) == 0 {
		return nil, errors.New("no nodes to fit")
	}
	if len(in.Nodes) > fitMaxNodes {
		return nil, fmt.Errorf("at most %d nodes can be fitted at once (got %d)", fitMaxNodes, len(in.Nodes))
	}
	if in.MaxIterations <= 0 {
		in.MaxIterations = 60
	}
	if in.Target <= 0 {
		in.Target = 0.99
	}
	res := &FitResult{Warnings: []string{}}

	fine := buildPlanes(in.Fixed, in.Ref, in.FrameW, in.FrameH, in.Placed, compareMaxSide)
	res.Canvas = Size{Width: fine.w, Height: fine.h}
	if countTrue(fine.rp.ink) == 0 {
		return nil, errors.New("the reference has no ink (it is one flat color): nothing to fit to")
	}
	long := math.Max(in.FrameW, in.FrameH)
	posRef := math.Max(3, 0.05*long)

	nodes := make([]*fnode, 0, len(in.Nodes))
	byID := map[string]*fnode{}
	for _, fn := range in.Nodes {
		n := newFNode(fn, in.FrameW, in.FrameH, fine.drawnBG)
		byID[fn.ID] = n
		if n.skipped == "" {
			nodes = append(nodes, n)
		}
	}
	if len(nodes) == 0 {
		return finishFit(res, in.Nodes, byID, nil), nil
	}

	// iou before, on the compare canvas
	sg := &fsearch{c: newFCanvas(fine), nodes: nodes, deadline: in.Deadline}
	sg.rasterAll()
	res.IoUBefore = sg.c.iou()

	// the first canvas: coarse when the compare canvas is big, to make the early rounds cheap
	first := fine
	coarseDistinct := math.Max(float64(fine.w), float64(fine.h)) > fitCoarseSide*1.25
	if coarseDistinct {
		first = buildPlanes(in.Fixed, in.Ref, in.FrameW, in.FrameH, in.Placed, fitCoarseSide)
	}
	sc := &fsearch{c: newFCanvas(first), nodes: nodes, deadline: in.Deadline}
	if coarseDistinct {
		sc.rasterAll()
	} else {
		sc = sg
	}
	orderAndPlan(sc, posRef)

	minSigma := 0.12 * fine.fx / posRef
	switch {
	case coarseDistinct:
		coarseEnd := 1.5 * first.fx / posRef
		res.Rounds += sc.rounds(in.MaxIterations, 1, coarseEnd, in.Target)
		sg = &fsearch{c: newFCanvas(fine), nodes: nodes, deadline: in.Deadline}
		for _, n := range nodes {
			n.cur.reset(0, 0, 0, 0)
		}
		sg.rasterAll()
		if sg.c.iou() < in.Target && !sc.timedOut {
			res.Rounds += sg.rounds(min(in.MaxIterations, fitFineRounds), coarseEnd, minSigma, in.Target)
		}
		sg.timedOut = sg.timedOut || sc.timedOut
	default:
		res.Rounds += sg.rounds(in.MaxIterations, 1, minSigma, in.Target)
	}
	sg.snap()
	res.IoUAfter = sg.c.iou()
	res.TimedOut = sg.timedOut
	if res.TimedOut {
		res.Warnings = append(res.Warnings, "stopped at the time budget before the search converged; call again to keep going")
	}
	if res.IoUAfter < res.IoUBefore {
		// never hand back a worse drawing
		for _, n := range nodes {
			n.st = n.init
			n.st.D = append([]Point(nil), n.init.D...)
		}
		res.IoUAfter = res.IoUBefore
		res.Warnings = append(res.Warnings, "the search found nothing better; the nodes are unchanged")
	}
	return finishFit(res, in.Nodes, byID, nodes), nil
}

func newFNode(fn FitNode, fw, fh float64, bg bgInfo) *fnode {
	n := &fnode{in: fn}
	n.st = fstate{X: fn.X, Y: fn.Y, W: fn.W, H: fn.H, Rot: fn.Rot}
	n.w0, n.h0 = math.Max(fn.W, 1e-6), math.Max(fn.H, 1e-6)
	switch fn.Kind {
	case "rect", "ellipse", "path":
	default:
		n.skipped = fmt.Sprintf("a %s cannot be fitted", fn.Kind)
		return n
	}
	n.fillInk = fn.Fill && paintInk(fn.FillRGB, fn.Alpha, bg)
	n.strokeInk = fn.Stroke && fn.StrokeWidth > 0 && paintInk(fn.StrokeRGB, fn.Alpha, bg)
	if !n.fillInk && !n.strokeInk {
		n.skipped = "it paints the background color (or nothing), so it adds no ink to fit"
		return n
	}
	if fn.W <= 0 || fn.H <= 0 {
		n.skipped = "it has no size"
		return n
	}
	long := math.Max(fw, fh)
	free := fn.Free
	big, small := math.Max(fn.W, fn.H), math.Min(fn.W, fn.H)
	if free.Position {
		n.params = append(n.params, fparam{kind: pX, base: math.Max(3, 0.05*long)}, fparam{kind: pY, base: math.Max(3, 0.05*long)})
	}
	if free.Size {
		st := math.Max(2, 0.15*big)
		n.params = append(n.params,
			fparam{kind: pW, base: st, lo: 1, hi: 4 * long, hasRange: true},
			fparam{kind: pH, base: st, lo: 1, hi: 4 * long, hasRange: true})
		if free.Position {
			// moving one edge alone, so that a shifted and too small box does not need two moves at once
			n.params = append(n.params,
				fparam{kind: pL, base: st, lo: -4 * long, hi: -1, hasRange: true},
				fparam{kind: pT, base: st, lo: -4 * long, hi: -1, hasRange: true})
		}
	}
	if free.Rotation {
		n.params = append(n.params, fparam{kind: pRot, base: 8})
	}
	if free.Radius && fn.Kind == "rect" {
		uniform := true
		for _, r := range fn.Radius {
			if math.Abs(r-fn.Radius[0]) > 1e-9 {
				uniform = false
			}
		}
		if uniform {
			n.st.R = fn.Radius[0]
			n.params = append(n.params, fparam{kind: pRad, base: math.Max(1, 0.2*small), lo: 0, hi: math.Max(fn.W, fn.H), hasRange: true})
		} else {
			n.rFactor = true
			n.st.R = 1
			n.params = append(n.params, fparam{kind: pRad, base: 0.25, lo: 0, hi: 8, hasRange: true})
		}
	}
	n.init = n.st
	return n
}

// orderAndPlan sorts nodes by how much they are off, then picks the path anchors that may move.
func orderAndPlan(sg *fsearch, posRef float64) {
	c := sg.c
	for _, n := range sg.nodes {
		bad := 0
		for y := range n.cur.h {
			for x := range n.cur.w {
				i := (n.cur.y0+y)*c.w + n.cur.x0 + x
				if n.cur.bits[y*n.cur.w+x] && !c.ref[i] {
					bad++
				}
			}
		}
		// reference ink around the node that nothing draws
		padX, padY := max(2, n.cur.w/4), max(2, n.cur.h/4)
		for y := max(0, n.cur.y0-padY); y < min(c.h, n.cur.y0+n.cur.h+padY); y++ {
			for x := max(0, n.cur.x0-padX); x < min(c.w, n.cur.x0+n.cur.w+padX); x++ {
				if i := y*c.w + x; c.ref[i] && !c.drawnAt(i) {
					bad++
				}
			}
		}
		n.bad = bad
		if n.in.Kind == "path" && n.in.Free.PathPoints && n.in.ViewBox == nil {
			pickAnchors(sg, n)
		}
	}
	sort.SliceStable(sg.nodes, func(i, j int) bool { return sg.nodes[i].bad > sg.nodes[j].bad })
}

// pickAnchors chooses the anchors of a path with the largest mismatch around them.
func pickAnchors(sg *fsearch, n *fnode) {
	c := sg.c
	limit := n.in.Free.MaxAnchors
	if limit <= 0 {
		limit = 8
	}
	type scored struct {
		a   aref
		err int
	}
	var all []scored
	flat := 0
	radius := max(3, int(math.Round(0.08*math.Max(n.in.W, n.in.H)/c.fx)))
	for si, sub := range n.in.Path {
		for ai, a := range sub.Anchors {
			lx, ly := n.local(a.X, a.Y, Point{})
			p := n.toFrame(lx, ly)
			cx, cy := int(math.Round(p.x/c.fx)), int(math.Round(p.y/c.fy))
			errs := 0
			for y := max(0, cy-radius); y < min(c.h, cy+radius+1); y++ {
				for x := max(0, cx-radius); x < min(c.w, cx+radius+1); x++ {
					if i := y*c.w + x; c.ref[i] != c.drawnAt(i) {
						errs++
					}
				}
			}
			all = append(all, scored{aref{si, ai, flat}, errs})
			flat++
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].err > all[j].err })
	if len(all) > limit {
		all = all[:limit]
	}
	step := math.Max(2, 0.1*math.Max(n.in.W, n.in.H))
	for _, s := range all {
		if s.err == 0 {
			continue
		}
		n.anchors = append(n.anchors, s.a)
	}
	n.st.D = make([]Point, len(n.anchors))
	n.init.D = make([]Point, len(n.anchors))
	for i := range n.anchors {
		n.params = append(n.params, fparam{kind: pAX, i: i, base: step}, fparam{kind: pAY, i: i, base: step})
	}
}

func finishFit(res *FitResult, all []FitNode, byID map[string]*fnode, tuned []*fnode) *FitResult {
	for _, fn := range all {
		n := byID[fn.ID]
		out := FitNodeResult{ID: fn.ID, X: n.st.X, Y: n.st.Y, W: n.st.W, H: n.st.H, Rot: n.st.Rot, Skipped: n.skipped, Changed: map[string]bool{}}
		out.Radius = n.radii()
		if n.skipped == "" {
			out.Contributes = true
			const eps = 1e-6
			if math.Abs(n.st.X-n.init.X) > eps || math.Abs(n.st.Y-n.init.Y) > eps {
				out.Changed["position"] = true
			}
			if math.Abs(n.st.W-n.init.W) > eps || math.Abs(n.st.H-n.init.H) > eps {
				out.Changed["size"] = true
			}
			if math.Abs(n.st.Rot-n.init.Rot) > eps {
				out.Changed["rotation"] = true
			}
			if n.in.Kind == "rect" {
				base := n.init
				cmp := fnode{in: n.in, st: base, rFactor: n.rFactor}
				if r0 := cmp.radii(); r0 != out.Radius {
					out.Changed["radius"] = true
				}
			}
			for i, a := range n.anchors {
				if d := n.st.D[i]; math.Abs(d.X) > eps || math.Abs(d.Y) > eps {
					out.Moves = append(out.Moves, FitMove{Index: a.flat, DX: d.X, DY: d.Y})
				}
			}
			if len(out.Moves) > 0 {
				out.Changed["pathPoints"] = true
			}
			if n.in.Kind == "path" && n.in.ViewBox == nil && (out.Changed["pathPoints"] || out.Changed["size"]) {
				out.Path = n.finalPath()
			}
		}
		res.Nodes = append(res.Nodes, out)
	}
	return res
}

// finalPath is the path after scaling to the new size and moving the anchors, in local coordinates.
func (n *fnode) finalPath() []FitSub {
	var out []FitSub
	flat := 0
	for _, sub := range n.in.Path {
		ns := FitSub{Closed: sub.Closed}
		for _, a := range sub.Anchors {
			var d Point
			for k, r := range n.anchors {
				if r.flat == flat {
					d = n.st.D[k]
				}
			}
			x, y := n.local(a.X, a.Y, d)
			na := FitAnchor{X: x, Y: y}
			if a.In != nil {
				ix, iy := n.local(a.In.X, a.In.Y, d)
				na.In = &Point{X: ix, Y: iy}
			}
			if a.Out != nil {
				ox, oy := n.local(a.Out.X, a.Out.Y, d)
				na.Out = &Point{X: ox, Y: oy}
			}
			ns.Anchors = append(ns.Anchors, na)
			flat++
		}
		out = append(out, ns)
	}
	return out
}

// FitIoU is the ink IoU of a rendered frame against the reference on the compare canvas, without
// the extras of Compare. It is what Fit's mask IoU is checked against.
func FitIoU(drawn, ref image.Image, frameW, frameH float64, placed Rect) float64 {
	cv := buildPlanes(drawn, ref, frameW, frameH, placed, compareMaxSide)
	inter, uni := 0, 0
	for i := range cv.rp.ink {
		a, b := cv.rp.ink[i], cv.dp.ink[i]
		if a && b {
			inter++
		}
		if a || b {
			uni++
		}
	}
	if uni == 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

// ParseCSSColor reads #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(); ok is false for anything else.
func ParseCSSColor(s string) (rgb [3]uint8, alpha float64, ok bool) {
	var r, g, b, a float64
	a = 1
	hexv := func(c byte) (int, bool) {
		switch {
		case c >= '0' && c <= '9':
			return int(c - '0'), true
		case c >= 'a' && c <= 'f':
			return int(c-'a') + 10, true
		case c >= 'A' && c <= 'F':
			return int(c-'A') + 10, true
		}
		return 0, false
	}
	if len(s) > 0 && s[0] == '#' {
		h := s[1:]
		vals := make([]int, len(h))
		for i := range h {
			v, good := hexv(h[i])
			if !good {
				return rgb, 1, false
			}
			vals[i] = v
		}
		switch len(h) {
		case 3, 4:
			r, g, b = float64(vals[0]*17), float64(vals[1]*17), float64(vals[2]*17)
			if len(h) == 4 {
				a = float64(vals[3]*17) / 255
			}
		case 6, 8:
			r, g, b = float64(vals[0]*16+vals[1]), float64(vals[2]*16+vals[3]), float64(vals[4]*16+vals[5])
			if len(h) == 8 {
				a = float64(vals[6]*16+vals[7]) / 255
			}
		default:
			return rgb, 1, false
		}
		return [3]uint8{uint8(r), uint8(g), uint8(b)}, a, true
	}
	var n int
	var err error
	switch {
	case len(s) > 5 && s[:5] == "rgba(":
		n, err = fmt.Sscanf(s, "rgba(%f,%f,%f,%f)", &r, &g, &b, &a)
		if err != nil || n != 4 {
			n, err = fmt.Sscanf(s, "rgba(%f, %f, %f, %f)", &r, &g, &b, &a)
		}
		if err != nil || n != 4 {
			return rgb, 1, false
		}
	case len(s) > 4 && s[:4] == "rgb(":
		n, err = fmt.Sscanf(s, "rgb(%f,%f,%f)", &r, &g, &b)
		if err != nil || n != 3 {
			n, err = fmt.Sscanf(s, "rgb(%f, %f, %f)", &r, &g, &b)
		}
		if err != nil || n != 3 {
			return rgb, 1, false
		}
	default:
		return rgb, 1, false
	}
	clamp := func(v float64) uint8 { return uint8(math.Max(0, math.Min(255, math.Round(v)))) }
	return [3]uint8{clamp(r), clamp(g), clamp(b)}, math.Max(0, math.Min(1, a)), true
}
