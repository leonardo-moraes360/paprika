package vision

import (
	"math"
	"sort"
)

type comp struct {
	id      int32
	label   uint8
	area    int
	minX    int
	minY    int
	maxX    int
	maxY    int
	touches bool
}

func components(labels []uint8, w, h int) ([]int32, []comp) {
	ids := make([]int32, w*h)
	var comps []comp
	var stack []int32
	for start := range labels {
		if labels[start] == 255 || ids[start] != 0 {
			continue
		}
		id := int32(len(comps) + 1)
		lb := labels[start]
		c := comp{id: id, label: lb, minX: w, minY: h, maxX: -1, maxY: -1}
		ids[start] = id
		stack = append(stack[:0], int32(start))
		for len(stack) > 0 {
			i := int(stack[len(stack)-1])
			stack = stack[:len(stack)-1]
			x, y := i%w, i/w
			c.area++
			c.minX, c.maxX = min(c.minX, x), max(c.maxX, x)
			c.minY, c.maxY = min(c.minY, y), max(c.maxY, y)
			if x == 0 || y == 0 || x == w-1 || y == h-1 {
				c.touches = true
			}
			for dy := -1; dy <= 1; dy++ {
				ny := y + dy
				if ny < 0 || ny >= h {
					continue
				}
				for dx := -1; dx <= 1; dx++ {
					nx := x + dx
					if nx < 0 || nx >= w || (dx == 0 && dy == 0) {
						continue
					}
					j := ny*w + nx
					if ids[j] == 0 && labels[j] == lb {
						ids[j] = id
						stack = append(stack, int32(j))
					}
				}
			}
		}
		comps = append(comps, c)
	}
	return ids, comps
}

type pt struct{ x, y float64 }

type hole struct {
	area                   int
	minX, minY, maxX, maxY int
}

type geom struct {
	ox, oy       int
	w, h         int
	mask         []bool
	fill         []bool
	areaM        int
	areaF        int
	holes        []hole
	contour      []pt
	cx, cy       float64
	mcx, mcy     float64
	varX, varY   float64
	covXY        float64
	theta        float64
	lam1, lam2   float64
	hullPts      []pt
	hullArea     float64
	perimeterLen float64
}

func buildGeom(ids []int32, W int, c comp, holeFloor int) *geom {
	g := &geom{ox: c.minX, oy: c.minY, w: c.maxX - c.minX + 1, h: c.maxY - c.minY + 1}
	g.mask = make([]bool, g.w*g.h)
	for y := range g.h {
		row := (g.oy+y)*W + g.ox
		for x := range g.w {
			if ids[row+x] == c.id {
				g.mask[y*g.w+x] = true
				g.areaM++
			}
		}
	}
	g.fillHoles(holeFloor)
	g.moments()
	g.trace()
	return g
}

func (g *geom) fillHoles(holeFloor int) {
	pw, ph := g.w+2, g.h+2
	seen := make([]bool, pw*ph)
	at := func(x, y int) bool {
		x, y = x-1, y-1
		return x >= 0 && y >= 0 && x < g.w && y < g.h && g.mask[y*g.w+x]
	}
	var q []int
	flood := func(sx, sy int, onCell func(x, y int)) {
		q = append(q[:0], sy*pw+sx)
		seen[sy*pw+sx] = true
		for len(q) > 0 {
			i := q[len(q)-1]
			q = q[:len(q)-1]
			x, y := i%pw, i/pw
			if onCell != nil {
				onCell(x, y)
			}
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nx, ny := x+d[0], y+d[1]
				if nx < 0 || ny < 0 || nx >= pw || ny >= ph {
					continue
				}
				j := ny*pw + nx
				if !seen[j] && !at(nx, ny) {
					seen[j] = true
					q = append(q, j)
				}
			}
		}
	}
	flood(0, 0, nil)
	g.fill = make([]bool, g.w*g.h)
	copy(g.fill, g.mask)
	for y := range ph {
		for x := range pw {
			i := y*pw + x
			if seen[i] || at(x, y) {
				continue
			}
			hl := hole{minX: x - 1, minY: y - 1, maxX: x - 1, maxY: y - 1}
			flood(x, y, func(cx, cy int) {
				hl.area++
				hl.minX, hl.maxX = min(hl.minX, cx-1), max(hl.maxX, cx-1)
				hl.minY, hl.maxY = min(hl.minY, cy-1), max(hl.maxY, cy-1)
				g.fill[(cy-1)*g.w+cx-1] = true
			})
			if hl.area >= holeFloor {
				g.holes = append(g.holes, hl)
			}
		}
	}
	for _, v := range g.fill {
		if v {
			g.areaF++
		}
	}
	sort.SliceStable(g.holes, func(i, j int) bool { return g.holes[i].area > g.holes[j].area })
}

func (g *geom) moments() {
	var sx, sy, sxx, syy, sxy, mx, my float64
	n := 0.0
	for y := range g.h {
		for x := range g.w {
			i := y*g.w + x
			if g.mask[i] {
				mx += float64(x) + 0.5
				my += float64(y) + 0.5
			}
			if !g.fill[i] {
				continue
			}
			px, py := float64(x)+0.5, float64(y)+0.5
			n++
			sx += px
			sy += py
			sxx += px * px
			syy += py * py
			sxy += px * py
		}
	}
	if g.areaM > 0 {
		g.mcx, g.mcy = mx/float64(g.areaM), my/float64(g.areaM)
	}
	if n == 0 {
		return
	}
	g.cx, g.cy = sx/n, sy/n
	g.varX = sxx/n - g.cx*g.cx + 1.0/12
	g.varY = syy/n - g.cy*g.cy + 1.0/12
	g.covXY = sxy/n - g.cx*g.cy
	g.theta = 0.5 * math.Atan2(2*g.covXY, g.varX-g.varY)
	tr := g.varX + g.varY
	disc := math.Sqrt(math.Max(0, (g.varX-g.varY)*(g.varX-g.varY)/4+g.covXY*g.covXY))
	g.lam1, g.lam2 = tr/2+disc, math.Max(tr/2-disc, 1e-9)
}

func (g *geom) inFill(x, y int) bool {
	return x >= 0 && y >= 0 && x < g.w && y < g.h && g.fill[y*g.w+x]
}

func (g *geom) trace() {
	sx, sy := -1, -1
	for i, v := range g.fill {
		if v {
			sx, sy = i%g.w, i/g.w
			break
		}
	}
	if sx < 0 {
		return
	}
	dv := [4][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}
	ahead := func(vx, vy, d int) (left, right bool) {
		switch d {
		case 0:
			return g.inFill(vx, vy-1), g.inFill(vx, vy)
		case 1:
			return g.inFill(vx, vy), g.inFill(vx-1, vy)
		case 2:
			return g.inFill(vx-1, vy), g.inFill(vx-1, vy-1)
		default:
			return g.inFill(vx-1, vy-1), g.inFill(vx, vy-1)
		}
	}
	vx, vy, d := sx, sy, 3
	limit := 4*g.w*g.h + 16
	for range limit {
		l, r := ahead(vx, vy, d)
		nd := d
		switch {
		case l:
			nd = (d + 3) % 4
		case r:
		default:
			nd = (d + 1) % 4
		}
		if nd != d {
			g.contour = append(g.contour, pt{float64(vx), float64(vy)})
		}
		vx += dv[nd][0]
		vy += dv[nd][1]
		d = nd
		if vx == sx && vy == sy && d == 3 {
			break
		}
	}
	for i := range g.contour {
		j := (i + 1) % len(g.contour)
		g.perimeterLen += math.Hypot(g.contour[j].x-g.contour[i].x, g.contour[j].y-g.contour[i].y)
	}
	g.hullPts = convexHull(g.contour)
	g.hullArea = polyArea(g.hullPts)
}

func polyArea(p []pt) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i].x*p[j].y - p[j].x*p[i].y
	}
	return math.Abs(a) / 2
}

func convexHull(in []pt) []pt {
	p := append([]pt(nil), in...)
	sort.Slice(p, func(i, j int) bool {
		if p[i].x != p[j].x {
			return p[i].x < p[j].x
		}
		return p[i].y < p[j].y
	})
	if len(p) < 3 {
		return p
	}
	cross := func(o, a, b pt) float64 { return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x) }
	var h []pt
	for _, q := range p {
		for len(h) >= 2 && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	lower := len(h) + 1
	for i := len(p) - 2; i >= 0; i-- {
		q := p[i]
		for len(h) >= lower && cross(h[len(h)-2], h[len(h)-1], q) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	return h[:len(h)-1]
}

func simplify(p []pt, eps float64, maxPts int) []pt {
	if len(p) <= 3 {
		return p
	}
	far, fd := 0, -1.0
	for i := range p {
		if d := math.Hypot(p[i].x-p[0].x, p[i].y-p[0].y); d > fd {
			far, fd = i, d
		}
	}
	for {
		keep := make([]bool, len(p))
		keep[0], keep[far] = true, true
		dp(p, 0, far, eps, keep)
		dpWrap(p, far, eps, keep)
		var out []pt
		for i, k := range keep {
			if k {
				out = append(out, p[i])
			}
		}
		if len(out) <= maxPts || eps > 1e6 {
			return out
		}
		eps *= 1.3
	}
}

func segDist(q, a, b pt) float64 {
	dx, dy := b.x-a.x, b.y-a.y
	den := dx*dx + dy*dy
	if den == 0 {
		return math.Hypot(q.x-a.x, q.y-a.y)
	}
	t := math.Max(0, math.Min(1, ((q.x-a.x)*dx+(q.y-a.y)*dy)/den))
	return math.Hypot(q.x-(a.x+t*dx), q.y-(a.y+t*dy))
}

func dp(p []pt, i, j int, eps float64, keep []bool) {
	if j-i < 2 {
		return
	}
	bi, bd := -1, eps
	for k := i + 1; k < j; k++ {
		if d := segDist(p[k], p[i], p[j]); d > bd {
			bi, bd = k, d
		}
	}
	if bi < 0 {
		return
	}
	keep[bi] = true
	dp(p, i, bi, eps, keep)
	dp(p, bi, j, eps, keep)
}

func dpWrap(p []pt, far int, eps float64, keep []bool) {
	q := make([]pt, 0, len(p)-far+1)
	q = append(q, p[far:]...)
	q = append(q, p[0])
	k := make([]bool, len(q))
	k[0], k[len(q)-1] = true, true
	dp(q, 0, len(q)-1, eps, k)
	for i := 1; i < len(q)-1; i++ {
		if k[i] {
			keep[far+i] = true
		}
	}
}
