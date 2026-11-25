package vision

import (
	"math"
)

type prim struct {
	kind      string
	cx, cy    float64
	rx, ry    float64
	rot       float64
	r         float64
	n         int
	iou       float64
	perCorner bool
	radii     [4]float64
	verts     []pt
	inner     float64
}

func (p prim) meanRadius() float64 {
	if !p.perCorner {
		return p.r
	}
	return (p.radii[0] + p.radii[1] + p.radii[2] + p.radii[3]) / 4
}

func (p prim) cornerRadius(u, v float64) float64 {
	if !p.perCorner {
		return p.r
	}
	i := 0
	switch {
	case u >= 0 && v < 0:
		i = 1
	case u >= 0 && v >= 0:
		i = 2
	case u < 0 && v >= 0:
		i = 3
	}
	return p.radii[i]
}

func (p prim) roundedPolygon() prim {
	if p.kind != "polygon" || p.r <= 0 {
		return p
	}
	a := p.rx * math.Cos(math.Pi/float64(p.n))
	p.inner = math.Max(a-p.r, 0)
	R := p.inner / math.Cos(math.Pi/float64(p.n))
	p.verts = make([]pt, p.n)
	for i := range p.verts {
		ang := p.rot + 2*math.Pi*float64(i)/float64(p.n)
		p.verts[i] = pt{R * math.Cos(ang), R * math.Sin(ang)}
	}
	return p
}

func (p prim) contains(x, y float64) bool {
	dx, dy := x-p.cx, y-p.cy
	switch p.kind {
	case "polygon":
		if p.r > 0 && p.verts != nil {
			return p.inRounded(dx, dy)
		}
		rho := math.Hypot(dx, dy)
		if rho == 0 {
			return true
		}
		step := 2 * math.Pi / float64(p.n)
		a := math.Mod(math.Atan2(dy, dx)-p.rot, step)
		if a < 0 {
			a += step
		}
		a -= step / 2
		return rho*math.Cos(a) <= p.rx*math.Cos(step/2)
	}
	c, s := math.Cos(p.rot), math.Sin(p.rot)
	u := dx*c + dy*s
	v := -dx*s + dy*c
	switch p.kind {
	case "rect":
		return math.Abs(u) <= p.rx && math.Abs(v) <= p.ry
	case "roundRect":
		r := p.cornerRadius(u, v)
		qx, qy := math.Abs(u)-(p.rx-r), math.Abs(v)-(p.ry-r)
		return math.Hypot(math.Max(qx, 0), math.Max(qy, 0))+math.Min(math.Max(qx, qy), 0)-r <= 0
	default:
		return (u/p.rx)*(u/p.rx)+(v/p.ry)*(v/p.ry) <= 1
	}
}

func (p prim) inRounded(dx, dy float64) bool {
	n := len(p.verts)
	inside := true
	for i := range n {
		phi := p.rot + (2*float64(i)+1)*math.Pi/float64(p.n)
		if dx*math.Cos(phi)+dy*math.Sin(phi) > p.inner {
			inside = false
			break
		}
	}
	if inside {
		return true
	}
	q := pt{dx, dy}
	for i := range n {
		if segDist(q, p.verts[i], p.verts[(i+1)%n]) <= p.r {
			return true
		}
	}
	return false
}

func (g *geom) iou(p prim) float64 {
	pad := max(2, max(g.w, g.h)/4)
	step := max(1, (max(g.w, g.h)+2*pad+159)/160)
	inter, uni := 0, 0
	for y := -pad; y < g.h+pad; y += step {
		for x := -pad; x < g.w+pad; x += step {
			a := g.inFill(x, y)
			b := p.contains(float64(x)+0.5, float64(y)+0.5)
			if a && b {
				inter++
			}
			if a || b {
				uni++
			}
		}
	}
	if uni == 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

func normAxes(rx, ry, rot float64) (float64, float64, float64) {
	for rot > math.Pi/4 {
		rot -= math.Pi / 2
		rx, ry = ry, rx
	}
	for rot <= -math.Pi/4 {
		rot += math.Pi / 2
		rx, ry = ry, rx
	}
	if math.Abs(rot) < 0.5*math.Pi/180 {
		rot = 0
	}
	return rx, ry, rot
}

func (g *geom) fitEllipse() prim {
	a := 2 * math.Sqrt(g.lam1)
	b := 2 * math.Sqrt(g.lam2)
	k := math.Sqrt(float64(g.areaF) / (math.Pi * a * b))
	a, b = a*k, b*k
	rx, ry, rot := normAxes(a, b, g.theta)
	return prim{kind: "ellipse", cx: g.cx, cy: g.cy, rx: rx, ry: ry, rot: rot}
}

func (g *geom) fitCircle() prim {
	r := math.Sqrt(float64(g.areaF) / math.Pi)
	return prim{kind: "circle", cx: g.cx, cy: g.cy, rx: r, ry: r}
}

func (g *geom) minAreaAngle() float64 {
	h := g.hullPts
	if len(h) < 3 {
		return 0
	}
	bestA, bestArea := 0.0, math.MaxFloat64
	for i := range h {
		j := (i + 1) % len(h)
		ang := math.Atan2(h[j].y-h[i].y, h[j].x-h[i].x)
		c, s := math.Cos(ang), math.Sin(ang)
		u0, u1, v0, v1 := math.MaxFloat64, -math.MaxFloat64, math.MaxFloat64, -math.MaxFloat64
		for _, p := range h {
			u := p.x*c + p.y*s
			v := -p.x*s + p.y*c
			u0, u1, v0, v1 = math.Min(u0, u), math.Max(u1, u), math.Min(v0, v), math.Max(v1, v)
		}
		area := (u1 - u0) * (v1 - v0)
		_, _, na := normAxes(1, 1, ang)
		_, _, nb := normAxes(1, 1, bestA)
		if area < bestArea-1e-9 || (math.Abs(area-bestArea) <= 1e-9 && math.Abs(na) < math.Abs(nb)) {
			bestA, bestArea = ang, area
		}
	}
	return bestA
}

func (g *geom) fitRect() (prim, prim) {
	ang := g.minAreaAngle()
	c, s := math.Cos(ang), math.Sin(ang)
	u0, u1, v0, v1 := math.MaxFloat64, -math.MaxFloat64, math.MaxFloat64, -math.MaxFloat64
	for y := range g.h {
		for x := range g.w {
			if !g.fill[y*g.w+x] {
				continue
			}
			px, py := float64(x)+0.5, float64(y)+0.5
			u := px*c + py*s
			v := -px*s + py*c
			u0, u1, v0, v1 = math.Min(u0, u), math.Max(u1, u), math.Min(v0, v), math.Max(v1, v)
		}
	}
	hu, hv := (u1-u0)/2+0.5, (v1-v0)/2+0.5
	mu, mv := (u0+u1)/2, (v0+v1)/2
	cx, cy := mu*c-mv*s, mu*s+mv*c
	rx, ry, rot := normAxes(hu, hv, ang)
	rect := prim{kind: "rect", cx: cx, cy: cy, rx: rx, ry: ry, rot: rot}
	rr := rect
	rr.kind = "roundRect"
	rad := g.cornerRadii(rect)
	mean := (rad[0] + rad[1] + rad[2] + rad[3]) / 4
	spread := 0.0
	for _, r := range rad {
		spread = math.Max(spread, math.Abs(r-mean))
	}
	rr.r = mean
	if spread > math.Max(1, 0.15*mean) {
		rr.perCorner, rr.radii = true, rad
	}
	return rect, rr
}

func (g *geom) cornerRadii(p prim) [4]float64 {
	var out [4]float64
	m := math.Min(p.rx, p.ry)
	if m < 1 {
		return out
	}
	step := math.Max(0.5, m/48)
	c, s := math.Cos(p.rot), math.Sin(p.rot)
	for i, sg := range [4][2]float64{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}} {
		empty, total := 0.0, 0.0
		for a := step / 2; a < m; a += step {
			for b := step / 2; b < m; b += step {
				u, v := sg[0]*(p.rx-a), sg[1]*(p.ry-b)
				x, y := p.cx+u*c-v*s, p.cy+u*s+v*c
				total++
				if !g.inFill(int(math.Floor(x)), int(math.Floor(y))) {
					empty++
				}
			}
		}
		r := math.Sqrt(empty / total * m * m / (1 - math.Pi/4))
		if r < 0.8 {
			r = 0
		}
		out[i] = math.Min(r, m)
	}
	return out
}

func (g *geom) polygonPhase(n int) float64 {
	var pts []pt
	for i := range g.contour {
		j := (i + 1) % len(g.contour)
		pts = append(pts, g.contour[i], pt{(g.contour[i].x + g.contour[j].x) / 2, (g.contour[i].y + g.contour[j].y) / 2})
	}
	mean := 0.0
	for _, p := range pts {
		mean += math.Hypot(p.x-g.cx, p.y-g.cy)
	}
	mean /= float64(len(pts))
	var sr, si float64
	for _, p := range pts {
		rho := math.Hypot(p.x-g.cx, p.y-g.cy)
		psi := math.Atan2(p.y-g.cy, p.x-g.cx)
		sr += (rho - mean) * math.Cos(float64(n)*psi)
		si += (rho - mean) * math.Sin(float64(n)*psi)
	}
	return math.Atan2(si, sr) / float64(n)
}

func (g *geom) fitPolygon(n int) prim {
	area := float64(g.areaF)
	R := math.Sqrt(2 * area / (float64(n) * math.Sin(2*math.Pi/float64(n))))
	ph := g.polygonPhase(n)
	best := prim{kind: "polygon", cx: g.cx, cy: g.cy, rx: R, ry: R, n: n, rot: ph}
	best.iou = g.iou(best)
	d := math.Pi / float64(n) / 8
	for _, off := range []float64{-d, d} {
		c := best
		c.rot = ph + off
		if c.iou = g.iou(c); c.iou > best.iou {
			best = c
		}
	}
	if best.iou >= 0.997 || best.iou < 0.9 {
		return best
	}
	T := math.Tan(math.Pi / float64(n))
	sharp := best
	for _, q := range []float64{0.12, 0.25, 0.4, 0.55} {
		a := math.Sqrt(area / (float64(n) * (T - q*q*(T-math.Pi/float64(n)))))
		c := prim{kind: "polygon", cx: g.cx, cy: g.cy, rx: a / math.Cos(math.Pi/float64(n)), n: n, rot: sharp.rot, r: q * a}
		c.ry = c.rx
		c = c.roundedPolygon()
		if c.iou = g.iou(c); c.iou > best.iou+0.003 {
			best = c
		}
	}
	return best
}

func penalty(p prim) float64 {
	switch p.kind {
	case "ellipse":
		return 0.004
	case "roundRect":
		if p.perCorner {
			return 0.008
		}
		return 0.004
	case "polygon":
		if p.r > 0 {
			return 0.016
		}
		return 0.012
	}
	return 0
}

const acceptIoU = 0.9

func (g *geom) bestFit() prim {
	var cands []prim
	add := func(p prim) {
		p.iou = g.iou(p)
		cands = append(cands, p)
	}
	ell := g.fitEllipse()
	add(ell)
	if ell.ry/ell.rx > 0.85 {
		add(g.fitCircle())
	}
	rect, rr := g.fitRect()
	add(rect)
	if rr.meanRadius() >= 0.02*2*math.Min(rr.rx, rr.ry) {
		add(rr)
	}
	top := 0.0
	for _, c := range cands {
		top = math.Max(top, c.iou)
	}
	if top < 0.985 && g.areaF >= 12 {
		for n := 3; n <= 8; n++ {
			cands = append(cands, g.fitPolygon(n))
		}
	}
	best := cands[0]
	bs := best.iou - penalty(best)
	for _, c := range cands[1:] {
		if s := c.iou - penalty(c); s > bs+1e-9 {
			best, bs = c, s
		}
	}
	return best
}
