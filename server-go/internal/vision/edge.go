package vision

import (
	"math"
	"slices"
)

// Edge measures how far apart the outlines of two ink masks are. IoU barely moves for a 1-2 px
// edge error (a thin ring of pixels out of a large area), so a drawing can pass at 0.95 and still
// show stair steps, slivers or a shifted edge once zoomed. The metric is a symmetric chamfer
// distance: every contour pixel of one mask is matched to the nearest contour pixel of the other,
// in both directions, and the distances are reported in frame units.
const (
	edgeMaxSide = 1600 // the edge canvas may be larger than the IoU canvas to see sub-pixel errors
	// edgeScoreSpan is the sum of mean and 95th percentile distance (frame units) at which the
	// score reaches zero: score = 1 - (mean + p95) / edgeScoreSpan.
	edgeScoreSpan = 8.0
)

// EdgeStat is the mean and the 95th percentile of a set of contour distances.
type EdgeStat struct {
	Mean float64 `json:"mean"`
	P95  float64 `json:"p95"`
}

// Edge is the contour distance between the reference ink and the drawn ink, in frame units.
type Edge struct {
	Mean             float64  `json:"mean"` // over both directions together
	P95              float64  `json:"p95"`
	Score            float64  `json:"score"` // 0..1: 1 - (mean + p95) / 8, floored at 0
	ReferenceToDrawn EdgeStat `json:"referenceToDrawn"`
	DrawnToReference EdgeStat `json:"drawnToReference"`
	Target           float64  `json:"target,omitempty"` // edgeTarget, when one was given
	Pass             bool     `json:"pass"`             // score >= target (true when no target was given)
}

// contourPixels lists the ink pixels that touch a non-ink pixel (4-neighbours); the image border
// is not an edge.
func contourPixels(m []bool, w, h int) []int {
	var out []int
	for y := range h {
		for x := range w {
			i := y*w + x
			if !m[i] {
				continue
			}
			if (x > 0 && !m[i-1]) || (x < w-1 && !m[i+1]) || (y > 0 && !m[i-w]) || (y < h-1 && !m[i+w]) {
				out = append(out, i)
			}
		}
	}
	return out
}

// distanceTo is the Euclidean distance, per pixel, to the nearest of the seed pixels
// (Felzenszwalb and Huttenlocher's linear-time transform).
func distanceTo(seeds []int, w, h int) []float32 {
	const inf = 1e12
	f := make([]float64, w*h)
	for i := range f {
		f[i] = inf
	}
	for _, s := range seeds {
		f[s] = 0
	}
	n := max(w, h)
	d := make([]float64, n)
	v := make([]int, n)
	z := make([]float64, n+1)
	pass := func(get func(i int) float64, set func(i int, v float64), length int) {
		k := 0
		v[0] = 0
		z[0], z[1] = -inf, inf
		for q := 1; q < length; q++ {
			var s float64
			for {
				vk := float64(v[k])
				s = ((get(q) + float64(q*q)) - (get(v[k]) + vk*vk)) / float64(2*q-2*v[k])
				if k > 0 && s <= z[k] {
					k--
					continue
				}
				break
			}
			k++
			v[k] = q
			z[k] = s
			z[k+1] = inf
		}
		k = 0
		for q := range length {
			for z[k+1] < float64(q) {
				k++
			}
			dq := float64(q - v[k])
			d[q] = dq*dq + get(v[k])
		}
		for q := range length {
			set(q, d[q])
		}
	}
	for x := range w {
		pass(func(i int) float64 { return f[i*w+x] }, func(i int, val float64) { f[i*w+x] = val }, h)
	}
	for y := range h {
		pass(func(i int) float64 { return f[y*w+i] }, func(i int, val float64) { f[y*w+i] = val }, w)
	}
	out := make([]float32, w*h)
	for i, v := range f {
		out[i] = float32(math.Sqrt(v))
	}
	return out
}

func statOf(d []float32) EdgeStat {
	if len(d) == 0 {
		return EdgeStat{}
	}
	s := append([]float32(nil), d...)
	slices.Sort(s)
	sum := 0.0
	for _, v := range s {
		sum += float64(v)
	}
	return EdgeStat{Mean: sum / float64(len(s)), P95: float64(s[min(len(s)-1, int(math.Ceil(0.95*float64(len(s))))-1)])}
}

// edgeDistances matches the contours of ref and drawn (w x h masks) and returns the distances,
// in pixels, from each reference contour pixel to the drawn contour and back. ok is false when
// either mask has no contour.
func edgeDistances(ref, drawn []bool, w, h int) (refToDrawn, drawnToRef []float32, ok bool) {
	rc, dc := contourPixels(ref, w, h), contourPixels(drawn, w, h)
	if len(rc) == 0 || len(dc) == 0 {
		return nil, nil, false
	}
	dd, dr := distanceTo(dc, w, h), distanceTo(rc, w, h)
	refToDrawn = make([]float32, len(rc))
	for i, p := range rc {
		refToDrawn[i] = dd[p]
	}
	drawnToRef = make([]float32, len(dc))
	for i, p := range dc {
		drawnToRef[i] = dr[p]
	}
	return refToDrawn, drawnToRef, true
}

// edgeMetrics scores the contour distance of two ink masks on a w x h canvas whose pixels are
// unit frame units wide. nil when either has no ink contour.
func edgeMetrics(ref, drawn []bool, w, h int, unit, target float64) *Edge {
	a, b, ok := edgeDistances(ref, drawn, w, h)
	if !ok {
		return nil
	}
	all := append(append([]float32(nil), a...), b...)
	both := statOf(all)
	sc := func(s EdgeStat) EdgeStat { return EdgeStat{Mean: r3(s.Mean * unit), P95: r3(s.P95 * unit)} }
	e := &Edge{
		Mean: r3(both.Mean * unit), P95: r3(both.P95 * unit),
		ReferenceToDrawn: sc(statOf(a)), DrawnToReference: sc(statOf(b)),
	}
	e.Score = r3(math.Max(0, 1-(both.Mean+both.P95)*unit/edgeScoreSpan))
	e.Target = target
	e.Pass = target <= 0 || e.Score >= target
	return e
}
