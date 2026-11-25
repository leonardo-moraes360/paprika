package vision

import (
	"math"
	"testing"
)

func squareMask(w, h, x0, y0, x1, y1 int) []bool {
	m := make([]bool, w*h)
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			m[y*w+x] = true
		}
	}
	return m
}

func TestEdgeMetricsDistance(t *testing.T) {
	const w, h = 120, 100
	a := squareMask(w, h, 20, 20, 80, 80)
	if e := edgeMetrics(a, a, w, h, 1, 0); e == nil || e.Mean != 0 || e.P95 != 0 || e.Score != 1 || !e.Pass {
		t.Fatalf("identical masks: %+v", e)
	}
	// the same square 3 px to the right: the vertical sides are 3 px apart, the horizontal ones
	// overlap, so the mean sits between and the p95 at the full shift
	b := squareMask(w, h, 23, 20, 83, 80)
	e := edgeMetrics(a, b, w, h, 1, 0)
	if e == nil || e.Mean < 0.8 || e.Mean > 2.5 || math.Abs(e.P95-3) > 0.2 {
		t.Fatalf("shifted by 3: %+v", e)
	}
	if e.Score <= 0 || e.Score >= 0.8 || !e.Pass {
		t.Fatalf("score without a target: %+v", e)
	}
	if f := edgeMetrics(a, b, w, h, 1, 0.9); f.Pass || f.Target != 0.9 {
		t.Fatalf("target 0.9 must fail: %+v", f)
	}
	// frame units: a canvas pixel of 2 units doubles the distances
	if g := edgeMetrics(a, b, w, h, 2, 0); math.Abs(g.P95-6) > 0.4 {
		t.Fatalf("unit 2: %+v", g)
	}
	if edgeMetrics(a, make([]bool, w*h), w, h, 1, 0) != nil {
		t.Fatal("an empty mask has no outline")
	}
}
