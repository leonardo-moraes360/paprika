package vision

import (
	"maps"
	"math"
	"sort"
)

// Vectorizing one boundary: the pixel-edge ring of a mask becomes a closed chain of line and
// cubic bezier segments. Corners are found by the turning angle over a short chord, the points
// between corners are smoothed (staircase noise out, corners pinned) and fitted with Schneider's
// least-squares cubic fit ("An Algorithm for Automatically Fitting Digitized Curves", Graphics
// Gems), splitting where the error exceeds the tolerance.

const cornerWindow = 5 // steps on each side used to measure the turning angle (default)

type bez [4]pt

// seg is one fitted segment; line segments only use p3 (p0 is the previous end).
type seg struct {
	line bool
	b    bez
}

// fitted is a closed ring turned into segments. Start is the first anchor.
type fitted struct {
	start   pt
	segs    []seg
	corners int
	err     float64 // largest distance from a ring point to its segment, analysis px
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

func ringArea(p []pt) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i].x*p[j].y - p[j].x*p[i].y
	}
	return a / 2
}

func mod(i, n int) int { return ((i % n) + n) % n }

// findCorners returns the indices of the points where the ring turns by at least thr radians
// (measured between chords of k steps), refined to the intersection of the lines fitted along
// both sides when that moves the corner by less than 2k.
func findCorners(p []pt, thr float64, k int) ([]int, map[int]pt) {
	n := len(p)
	if n < 4*k {
		return nil, nil
	}
	turn := func(i, k int) float64 {
		a := p[i].sub(p[mod(i-k, n)])
		b := p[mod(i+k, n)].sub(p[i])
		return math.Atan2(math.Abs(a.cross(b)), a.dot(b))
	}
	// Corners are measured over chords of k steps and, separately, over shorter ones (3), so that
	// the ends of a stroke thinner than k still get theirs; a pixel-scale notch or bump turns
	// little over a chord of 3 steps (a single pixel step turns 45 degrees at most), so the short
	// chord only counts from 60 degrees. The candidates of both scales are merged, the sharper
	// winning when two lie within 3 steps.
	scale := func(kk int, thr float64) map[int]float64 {
		ang := make([]float64, n)
		for i := range p {
			ang[i] = turn(i, kk)
		}
		out := map[int]float64{}
		for i := range p {
			if ang[i] < thr {
				continue
			}
			best := true
			for j := 1; j <= kk && best; j++ {
				if ang[mod(i-j, n)] >= ang[i] || ang[mod(i+j, n)] > ang[i] {
					best = false
				}
			}
			if best {
				out[i] = ang[i]
			}
		}
		return out
	}
	cand := scale(k, thr)
	if ks := min(k, 3); ks < k {
		small := scale(ks, math.Max(thr, 60*math.Pi/180))
		for i := range cand {
			for j := range small {
				if d := mod(i-j, n); min(d, n-d) <= k {
					delete(cand, i) // the sharp corners next to it say more than the wide measure
					break
				}
			}
		}
		maps.Copy(cand, small)
	}
	var idx []int
	for i := range cand {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	var kept []int
	for _, i := range idx {
		if m := len(kept); m > 0 && i-kept[m-1] <= 3 {
			if cand[i] > cand[kept[m-1]] {
				kept[m-1] = i
			}
			continue
		}
		kept = append(kept, i)
	}
	if m := len(kept); m > 1 && mod(kept[0]-kept[m-1], n) <= 3 {
		if cand[kept[0]] > cand[kept[m-1]] {
			kept[m-1] = kept[0]
		}
		kept = kept[1:]
		sort.Ints(kept)
	}
	idx = kept
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

// lineThrough is the total-least-squares line through the points: a point on it and a unit
// direction. ok is false when the points are not close to collinear.
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

// smoothRing averages each point with its neighbours (twice), narrowing the window next to a
// corner so the corner stays where it is.
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

// fitRing vectorizes a closed ring. thr is the corner threshold in radians and tol the largest
// distance, in ring units, a fitted curve may stray from the ring. k is the chord, in steps, that
// corners are measured over.
func fitRing(p []pt, thr, tol float64, k int) fitted {
	n := len(p)
	if n < 12 {
		poly := simplify(p, 0.7, 12)
		f := fitted{start: poly[0], corners: len(poly)}
		for i := 1; i <= len(poly); i++ {
			f.segs = append(f.segs, seg{line: true, b: bez{3: poly[i%len(poly)]}})
		}
		return f
	}
	idx, pos := findCorners(p, thr, k)
	sm := smoothRing(p, idx)
	f := fitted{corners: len(idx)}
	lineTol := math.Max(tol, 0.6)
	deviation := func(s []pt) float64 {
		devMax := 0.0
		chord := s[len(s)-1].sub(s[0])
		cl := chord.len()
		// the points next to a corner are not smoothed: leave them out of the straightness test
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
		return devMax
	}
	piece := func(s []pt, tIn, tOut pt) {
		if len(s) < 2 {
			return
		}
		devMax := deviation(s)
		if len(s) < 6 || devMax <= lineTol {
			f.segs = append(f.segs, seg{line: true, b: bez{3: s[len(s)-1]}})
			f.err = math.Max(f.err, devMax)
			return
		}
		t1, t2 := tIn, tOut
		if t1 == (pt{}) {
			t1 = s[min(4, len(s)-1)].sub(s[0]).unit()
		}
		if t2 == (pt{}) {
			t2 = s[max(len(s)-5, 0)].sub(s[len(s)-1]).unit()
		}
		var out []bez
		e := fitCubic(s, t1, t2, tol*tol, 0, &out)
		for _, b := range out {
			f.segs = append(f.segs, seg{b: b})
		}
		f.err = math.Max(f.err, math.Sqrt(e))
	}
	// emit fits one stretch between anchors. Long, almost perfectly straight runs inside it become
	// line segments of their own and the curves around them leave along the run's direction: fitted
	// as one curve, a straight side between two rounded corners shows as a gentle wave.
	emit := func(s []pt) {
		var runs [][2]int
		if len(s) >= 6 && deviation(s) > lineTol {
			runs = straightRuns(s, straightMin, straightTol)
		}
		if len(runs) == 0 {
			piece(s, pt{}, pt{})
			return
		}
		at := 0
		var dirIn pt
		for _, r := range runs {
			dir := s[r[1]].sub(s[r[0]]).unit()
			if r[0] > at {
				piece(s[at:r[0]+1], dirIn, dir.mul(-1))
			}
			f.segs = append(f.segs, seg{line: true, b: bez{3: s[r[1]]}})
			f.err = math.Max(f.err, straightTol)
			at, dirIn = r[1], dir
		}
		if at < len(s)-1 {
			piece(s[at:], dirIn, pt{})
		}
	}
	if len(idx) == 0 {
		// a ring without corners: start where it is most curved, so no straight run wraps around
		start := mostCurved(sm)
		s := make([]pt, 0, n+1)
		for i := 0; i <= n; i++ {
			s = append(s, sm[(start+i)%n])
		}
		f.start = s[0]
		if len(straightRuns(s, straightMin, straightTol)) > 0 {
			emit(s)
			return f
		}
		t := s[4].sub(s[n-4]).unit()
		var out []bez
		e := fitCubic(s, t, t.mul(-1), tol*tol, 0, &out)
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

// fitCubic fits cubic beziers to d (open, in order) with the given unit end tangents, pointing
// into the curve at both ends. errSq is the squared tolerance. It returns the largest squared
// error left.
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

const (
	straightMin = 28.0 // ring units: shortest run that is cut out as a line
	straightTol = 0.25 // ring units: how far from its chord a run may stray
)

// straightRuns finds the maximal stretches of s (index ranges, in order, not overlapping) that
// are at least minLen long and stay within tol of the chord between their ends.
func straightRuns(s []pt, minLen, tol float64) [][2]int {
	var runs [][2]int
	n := len(s)
	i := 0
	for i < n-2 {
		j := i + 1
		best := -1
		for j < n {
			chord := s[j].sub(s[i])
			cl := chord.len()
			if cl == 0 {
				j++
				continue
			}
			ok := true
			for q := i + 1; q < j; q++ {
				if math.Abs(s[q].sub(s[i]).cross(chord))/cl > tol {
					ok = false
					break
				}
			}
			if !ok {
				break
			}
			if cl >= minLen {
				best = j
			}
			j++
		}
		if best > 0 {
			runs = append(runs, [2]int{i, best})
			i = best
		} else {
			i += max(1, (j-i)/3)
		}
	}
	return runs
}

// mostCurved is the index where the ring turns the most over a short chord.
func mostCurved(p []pt) int {
	n := len(p)
	k := min(cornerWindow, n/4)
	if k < 1 {
		return 0
	}
	best, bi := -1.0, 0
	for i := range p {
		a := p[i].sub(p[mod(i-k, n)])
		b := p[mod(i+k, n)].sub(p[i])
		if v := math.Atan2(math.Abs(a.cross(b)), a.dot(b)); v > best {
			best, bi = v, i
		}
	}
	return bi
}
