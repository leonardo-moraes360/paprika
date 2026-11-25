package vision

import (
	"math"
)

const cornerWindow = 5

type bez [4]pt

type seg struct {
	line bool
	b    bez
}

type fitted struct {
	start   pt
	segs    []seg
	corners int
	err     float64
}

func (a pt) add(b pt) pt        { return pt{a.x + b.x, a.y + b.y} }
func (a pt) sub(b pt) pt        { return pt{a.x - b.x, a.y - b.y} }
func (a pt) mul(k float64) pt   { return pt{a.x * k, a.y * k} }
func (a pt) dot(b pt) float64   { return a.x*b.x + a.y*b.y }
func (a pt) cross(b pt) float64 { return a.x*b.y - a.y*b.x }
func (a pt) len() float64       { return math.Hypot(a.x, a.y) }
func dist(a, b pt) float64      { return a.sub(b).len() }
func (a pt) unit() pt {
	l := a.len()
	if l == 0 {
		return pt{}
	}
	return pt{a.x / l, a.y / l}
}

func traceLoops(mask []bool, w, h int) [][]pt {
	W := w + 1
	out := make([]uint8, W*(h+1))
	in := func(x, y int) bool { return x >= 0 && y >= 0 && x < w && y < h && mask[y*w+x] }
	for y := range h {
		for x := range w {
			if !mask[y*w+x] {
				continue
			}
			if !in(x, y-1) {
				out[y*W+x] |= 1 << 0
			}
			if !in(x+1, y) {
				out[y*W+x+1] |= 1 << 1
			}
			if !in(x, y+1) {
				out[(y+1)*W+x+1] |= 1 << 2
			}
			if !in(x-1, y) {
				out[(y+1)*W+x] |= 1 << 3
			}
		}
	}
	dv := [4][2]int{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}
	var loops [][]pt
	for v0 := range out {
		for d0 := range 4 {
			if out[v0]&(1<<d0) == 0 {
				continue
			}
			var loop []pt
			v, d := v0, d0
			for {
				out[v] &^= 1 << d
				loop = append(loop, pt{float64(v % W), float64(v / W)})
				v += dv[d][0] + dv[d][1]*W
				next := -1
				for _, nd := range [3]int{(d + 3) % 4, d, (d + 1) % 4} {
					if out[v]&(1<<nd) != 0 {
						next = nd
						break
					}
				}
				if next < 0 {
					break
				}
				d = next
			}
			loops = append(loops, loop)
		}
	}
	return loops
}

func ringArea(p []pt) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i].x*p[j].y - p[j].x*p[i].y
	}
	return a / 2
}

func mod(i, n int) int { return ((i % n) + n) % n }

func findCorners(p []pt, thr float64) ([]int, map[int]pt) {
	n := len(p)
	k := cornerWindow
	if n < 4*k {
		return nil, nil
	}
	ang := make([]float64, n)
	for i := range p {
		a := p[i].sub(p[mod(i-k, n)])
		b := p[mod(i+k, n)].sub(p[i])
		ang[i] = math.Atan2(math.Abs(a.cross(b)), a.dot(b))
	}
	var idx []int
	for i := range p {
		if ang[i] < thr {
			continue
		}
		best := true
		for j := 1; j <= k && best; j++ {
			if ang[mod(i-j, n)] >= ang[i] || ang[mod(i+j, n)] > ang[i] {
				best = false
			}
		}
		if best {
			idx = append(idx, i)
		}
	}
	pos := make(map[int]pt, len(idx))
	for ci, c := range idx {
		pos[c] = p[c]
		prev, next := idx[mod(ci-1, len(idx))], idx[mod(ci+1, len(idx))]
		before := mod(c-prev, n)
		after := mod(next-c, n)
		if len(idx) == 1 {
			before, after = n, n
		}
		span := min(3*k, before/2, after/2)
		if span < k+2 {
			continue
		}
		pa := make([]pt, 0, span)
		pb := make([]pt, 0, span)
		for j := k; j <= span; j++ {
			pa = append(pa, p[mod(c-j, n)])
			pb = append(pb, p[mod(c+j, n)])
		}
		a0, ad, ok1 := lineThrough(pa)
		b0, bd, ok2 := lineThrough(pb)
		if !ok1 || !ok2 {
			continue
		}
		den := ad.cross(bd)
		if math.Abs(den) < 0.3 {
			continue
		}
		t := b0.sub(a0).cross(bd) / den
		x := a0.add(ad.mul(t))
		if dist(x, p[c]) <= 2*float64(k) {
			pos[c] = x
		}
	}
	return idx, pos
}

func lineThrough(p []pt) (pt, pt, bool) {
	if len(p) < 3 {
		return pt{}, pt{}, false
	}
	var c pt
	for _, q := range p {
		c = c.add(q)
	}
	c = c.mul(1 / float64(len(p)))
	var sxx, syy, sxy float64
	for _, q := range p {
		d := q.sub(c)
		sxx += d.x * d.x
		syy += d.y * d.y
		sxy += d.x * d.y
	}
	th := 0.5 * math.Atan2(2*sxy, sxx-syy)
	dir := pt{math.Cos(th), math.Sin(th)}
	worst := 0.0
	for _, q := range p {
		worst = math.Max(worst, math.Abs(q.sub(c).cross(dir)))
	}
	return c, dir, worst < 1.2
}

func smoothRing(p []pt, corners []int) []pt {
	n := len(p)
	const R = 2
	near := make([]int, n)
	for i := range near {
		near[i] = n
	}
	for _, c := range corners {
		for j := 0; j <= R+1 && j < n; j++ {
			for _, i := range [2]int{mod(c-j, n), mod(c+j, n)} {
				near[i] = min(near[i], j)
			}
		}
	}
	cur := p
	for range 2 {
		nxt := make([]pt, n)
		for i := range cur {
			r := min(R, max(near[i]-1, 0))
			var s pt
			for j := -r; j <= r; j++ {
				s = s.add(cur[mod(i+j, n)])
			}
			nxt[i] = s.mul(1 / float64(2*r+1))
		}
		cur = nxt
	}
	return cur
}

func fitRing(p []pt, thr, tol float64) fitted {
	n := len(p)
	if n < 12 {
		poly := simplify(p, 0.7, 12)
		f := fitted{start: poly[0], corners: len(poly)}
		for i := 1; i <= len(poly); i++ {
			f.segs = append(f.segs, seg{line: true, b: bez{3: poly[i%len(poly)]}})
		}
		return f
	}
	idx, pos := findCorners(p, thr)
	sm := smoothRing(p, idx)
	f := fitted{corners: len(idx)}
	lineTol := math.Max(tol, 0.6)
	emit := func(s []pt) {
		if len(s) < 2 {
			return
		}
		devMax := 0.0
		chord := s[len(s)-1].sub(s[0])
		cl := chord.len()
		lo, hi := 1, len(s)-1
		if len(s) > 14 {
			lo, hi = 4, len(s)-4
		}
		for _, q := range s[lo:hi] {
			if cl == 0 {
				devMax = math.Max(devMax, dist(q, s[0]))
			} else {
				devMax = math.Max(devMax, math.Abs(q.sub(s[0]).cross(chord))/cl)
			}
		}
		if len(s) < 6 || devMax <= lineTol {
			f.segs = append(f.segs, seg{line: true, b: bez{3: s[len(s)-1]}})
			f.err = math.Max(f.err, devMax)
			return
		}
		t1 := s[min(4, len(s)-1)].sub(s[0]).unit()
		t2 := s[max(len(s)-5, 0)].sub(s[len(s)-1]).unit()
		var out []bez
		e := fitCubic(s, t1, t2, tol*tol, 0, &out)
		for _, b := range out {
			f.segs = append(f.segs, seg{b: b})
		}
		f.err = math.Max(f.err, math.Sqrt(e))
	}
	if len(idx) == 0 {
		t := sm[mod(4, n)].sub(sm[mod(-4, n)]).unit()
		s := append(append([]pt(nil), sm...), sm[0])
		var out []bez
		e := fitCubic(s, t, t.mul(-1), tol*tol, 0, &out)
		f.start = sm[0]
		for _, b := range out {
			f.segs = append(f.segs, seg{b: b})
		}
		f.err = math.Sqrt(e)
		return f
	}
	f.start = pos[idx[0]]
	for ci, c := range idx {
		nc := idx[(ci+1)%len(idx)]
		var s []pt
		for i := c; ; i = (i + 1) % n {
			s = append(s, sm[i])
			if i == nc && len(s) > 1 {
				break
			}
		}
		s[0], s[len(s)-1] = pos[c], pos[nc]
		emit(s)
	}
	return f
}

func fitCubic(d []pt, t1, t2 pt, errSq float64, depth int, out *[]bez) float64 {
	n := len(d)
	if n == 2 {
		l := dist(d[0], d[1]) / 3
		*out = append(*out, bez{d[0], d[0].add(t1.mul(l)), d[1].add(t2.mul(l)), d[1]})
		return 0
	}
	u := chordParams(d)
	b := genBezier(d, u, t1, t2)
	maxErr, split := bezError(d, b, u)
	if maxErr < errSq {
		*out = append(*out, b)
		return maxErr
	}
	if maxErr < errSq*4 {
		for range 4 {
			nu := make([]float64, n)
			for i := range d {
				nu[i] = newton(b, d[i], u[i])
			}
			u = nu
			b = genBezier(d, u, t1, t2)
			maxErr, split = bezError(d, b, u)
			if maxErr < errSq {
				*out = append(*out, b)
				return maxErr
			}
		}
	}
	if depth > 40 {
		*out = append(*out, b)
		return maxErr
	}
	tc := d[split-1].sub(d[split+1]).unit()
	e1 := fitCubic(d[:split+1], t1, tc, errSq, depth+1, out)
	e2 := fitCubic(d[split:], tc.mul(-1), t2, errSq, depth+1, out)
	return math.Max(e1, e2)
}

func chordParams(d []pt) []float64 {
	u := make([]float64, len(d))
	for i := 1; i < len(d); i++ {
		u[i] = u[i-1] + dist(d[i], d[i-1])
	}
	if u[len(u)-1] == 0 {
		for i := range u {
			u[i] = float64(i) / float64(len(u)-1)
		}
		return u
	}
	for i := 1; i < len(u); i++ {
		u[i] /= u[len(u)-1]
	}
	return u
}

func bezPoint(b bez, t float64) pt {
	s := 1 - t
	a, bb, c, dd := s*s*s, 3*s*s*t, 3*s*t*t, t*t*t
	return pt{a*b[0].x + bb*b[1].x + c*b[2].x + dd*b[3].x, a*b[0].y + bb*b[1].y + c*b[2].y + dd*b[3].y}
}

func genBezier(d []pt, u []float64, t1, t2 pt) bez {
	n := len(d)
	var c00, c01, c11, x0, x1 float64
	for i := range n {
		t := u[i]
		s := 1 - t
		b0, b1, b2, b3 := s*s*s, 3*s*s*t, 3*s*t*t, t*t*t
		a1 := t1.mul(b1)
		a2 := t2.mul(b2)
		c00 += a1.dot(a1)
		c01 += a1.dot(a2)
		c11 += a2.dot(a2)
		tmp := d[i].sub(d[0].mul(b0 + b1)).sub(d[n-1].mul(b2 + b3))
		x0 += a1.dot(tmp)
		x1 += a2.dot(tmp)
	}
	seglen := dist(d[0], d[n-1])
	det := c00*c11 - c01*c01
	al, ar := 0.0, 0.0
	if math.Abs(det) > 1e-12 {
		al = (x0*c11 - x1*c01) / det
		ar = (c00*x1 - c01*x0) / det
	}
	eps := 1e-6 * seglen
	if math.Abs(det) <= 1e-12 || al < eps || ar < eps {
		al, ar = seglen/3, seglen/3
	}
	return bez{d[0], d[0].add(t1.mul(al)), d[n-1].add(t2.mul(ar)), d[n-1]}
}

func newton(b bez, p pt, u float64) float64 {
	q1 := [3]pt{b[1].sub(b[0]).mul(3), b[2].sub(b[1]).mul(3), b[3].sub(b[2]).mul(3)}
	q2 := [2]pt{q1[1].sub(q1[0]).mul(2), q1[2].sub(q1[1]).mul(2)}
	s := 1 - u
	q := bezPoint(b, u)
	d1 := q1[0].mul(s * s).add(q1[1].mul(2 * s * u)).add(q1[2].mul(u * u))
	d2 := q2[0].mul(s).add(q2[1].mul(u))
	num := q.sub(p).dot(d1)
	den := d1.dot(d1) + q.sub(p).dot(d2)
	if den == 0 {
		return u
	}
	return math.Max(0, math.Min(1, u-num/den))
}

func bezError(d []pt, b bez, u []float64) (float64, int) {
	split := len(d) / 2
	worst := 0.0
	for i := 1; i < len(d)-1; i++ {
		e := bezPoint(b, u[i]).sub(d[i])
		if v := e.dot(e); v >= worst {
			worst, split = v, i
		}
	}
	split = max(1, min(split, len(d)-2))
	return worst, split
}
