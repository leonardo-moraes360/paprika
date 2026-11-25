package vision

import (
	"image"
	"image/color"
	"math"
	"testing"
)

// aaImage paints fg over bg with the coverage of in (sampled 6x6 per pixel, so edges are
// anti-aliased the way a vector export would be).
func aaImage(w, h int, bg, fg color.NRGBA, in func(x, y float64) bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	const n = 6
	for y := range h {
		for x := range w {
			hit := 0
			for sy := range n {
				for sx := range n {
					if in(float64(x)+(float64(sx)+0.5)/n, float64(y)+(float64(sy)+0.5)/n) {
						hit++
					}
				}
			}
			a := float64(hit) / (n * n)
			mix := func(p, q uint8) uint8 { return uint8(math.Round(float64(p)*(1-a) + float64(q)*a)) }
			img.SetNRGBA(x, y, color.NRGBA{mix(bg.R, fg.R), mix(bg.G, fg.G), mix(bg.B, fg.B), 255})
		}
	}
	return img
}

// polyIn is the point-in-polygon test of a convex or concave polygon.
func polyIn(poly []pt) func(x, y float64) bool {
	return func(x, y float64) bool { return inPoly(poly, x, y) }
}

func allRings(t *testing.T, r *TraceResult) [][]pt {
	t.Helper()
	var rings [][]pt
	for _, p := range r.Paths {
		rings = append(rings, flatten(t, p.D)...)
	}
	return rings
}

// maxDeviation is the largest distance from the traced outline's vertices to the polygon's edges.
func maxDeviation(rings [][]pt, poly []pt) float64 {
	worst := 0.0
	for _, rg := range rings {
		for _, p := range rg {
			best := math.MaxFloat64
			for i := range poly {
				a, b := poly[i], poly[(i+1)%len(poly)]
				ab := b.sub(a)
				u := math.Max(0, math.Min(1, p.sub(a).dot(ab)/ab.dot(ab)))
				best = math.Min(best, dist(p, a.add(ab.mul(u))))
			}
			worst = math.Max(worst, best)
		}
	}
	return worst
}

var ink = color.NRGBA{28, 28, 28, 255}

// A straight-sided polygon, anti-aliased and 1.5x larger than the analysis raster: the outline
// must stay on its sides (no waves, no stair steps) and keep the corners.
func TestTraceStraightSidesStayStraight(t *testing.T) {
	poly := []pt{{150, 60}, {330, 150}, {330, 330}, {150, 420}, {40, 360}, {40, 120}}
	img := aaImage(960, 480, white, ink, polyIn(poly))
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 1 {
		t.Fatalf("paths: %d", len(r.Paths))
	}
	rings := allRings(t, r)
	if dev := maxDeviation(rings, poly); dev > 0.9 {
		t.Fatalf("outline strays %.2f px from the polygon", dev)
	}
	if got := r.Paths[0].Corners; got < len(poly) || got > len(poly)+2 {
		t.Fatalf("corners: %d, want about %d", got, len(poly))
	}
}

func discIn(cx, cy, r float64) func(x, y float64) bool {
	return func(x, y float64) bool { return math.Hypot(x-cx, y-cy) <= r }
}

// An anti-aliased disc on a disc: the blend between the two colors is not a shape of its own
// (no sliver path), the big disc is one ring (the small one fills its hole), and the small disc
// stays on its circle.
func TestTraceDiscOnDiscHasNoSliver(t *testing.T) {
	big, small := discIn(300, 300, 200), discIn(300, 300, 90)
	img := aaImage(600, 600, white, navy, big)
	inner := aaImage(600, 600, white, orange, small)
	for y := range 600 {
		for x := range 600 {
			if small(float64(x)+0.5, float64(y)+0.5) {
				img.SetNRGBA(x, y, inner.NRGBAAt(x, y))
			}
		}
	}
	// the rim of the small disc: blend orange into navy, not into white
	const n = 6
	for y := range 600 {
		for x := range 600 {
			hit := 0
			for sy := range n {
				for sx := range n {
					if small(float64(x)+(float64(sx)+0.5)/n, float64(y)+(float64(sy)+0.5)/n) {
						hit++
					}
				}
			}
			if hit > 0 && hit < n*n {
				a := float64(hit) / (n * n)
				mix := func(p, q uint8) uint8 { return uint8(math.Round(float64(p)*(1-a) + float64(q)*a)) }
				img.SetNRGBA(x, y, color.NRGBA{mix(navy.R, orange.R), mix(navy.G, orange.G), mix(navy.B, orange.B), 255})
			}
		}
	}
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 2 {
		t.Fatalf("paths: %d, want the two discs (rim blends are not shapes): %+v", len(r.Paths), r.Skipped)
	}
	for _, p := range r.Paths {
		if p.Rings != 1 {
			t.Fatalf("%s has %d rings: the small disc fills the hole of the big one", p.Color, p.Rings)
		}
	}
	for _, p := range r.Paths {
		want := discIn(300, 300, 200)
		rad := 200.0
		if p.Color != r.Paths[0].Color {
			want, rad = discIn(300, 300, 90), 90
		}
		_ = want
		for _, rg := range flatten(t, p.D) {
			for _, q := range rg {
				// the lower disc may reach under the upper one (seam cover): only check its outer edge
				if math.Abs(math.Hypot(q.x-300, q.y-300)-rad) > 1.2 && math.Abs(math.Hypot(q.x-300, q.y-300)-90) > 1.2 {
					t.Fatalf("%s: point %v is %.2f from the center, want %g", p.Color, q, math.Hypot(q.x-300, q.y-300), rad)
				}
			}
		}
	}
}

// Touching squares of two colors: the shape drawn first reaches under the one drawn on top, so
// no hairline of background shows between them once both are anti-aliased.
func TestTraceTouchingSquaresOverlap(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 400, 200))
	for y := range 200 {
		for x := range 400 {
			c := white
			switch {
			case x >= 50 && x < 150 && y >= 50 && y < 150:
				c = red
			case x >= 150 && x < 250 && y >= 50 && y < 150:
				c = navy
			}
			img.SetNRGBA(x, y, c)
		}
	}
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 2 {
		t.Fatalf("paths: %d", len(r.Paths))
	}
	reach := func(p TracedPath, x, y float64) bool { return covers(flatten(t, p.D), x, y) }
	for _, y := range []float64{70, 100, 130} {
		overlapped := false
		for _, p := range r.Paths {
			if reach(p, 149.4, y) && reach(p, 150.6, y) {
				overlapped = true
			}
		}
		if !overlapped {
			t.Fatalf("no shape spans the shared edge at y=%g: a seam shows", y)
		}
	}
	// and the outer edges stay where they are
	for _, p := range r.Paths {
		bb := p.BBox
		if bb.Y < 49.5 || bb.Y+bb.Height > 150.5 || bb.X < 49.5 || bb.X+bb.Width > 250.5 {
			t.Fatalf("%s box %+v leaves the squares", p.Color, bb)
		}
	}
}

// A slanted (italic) stroke anti-aliased at an angle: four corners, no notches along the sides.
func TestTraceItalicStrokeHasNoNotches(t *testing.T) {
	poly := []pt{{100, 400}, {116, 400}, {236, 60}, {220, 60}}
	img := aaImage(480, 480, white, ink, polyIn(poly))
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 1 {
		t.Fatalf("paths: %d", len(r.Paths))
	}
	if c := r.Paths[0].Corners; c < 4 || c > 6 {
		t.Fatalf("corners: %d (the stroke has 4); pixel steps must not become corners", c)
	}
	if dev := maxDeviation(allRings(t, r), poly); dev > 0.8 {
		t.Fatalf("outline strays %.2f px from the stroke", dev)
	}
	if r.Paths[0].Segments > 8 {
		t.Fatalf("segments: %d for a plain stroke", r.Paths[0].Segments)
	}
}

// A row of small letter-like glyphs (L and T, strokes 5 px thick): every one is traced, each at
// its box, with a bounded number of corners.
func TestTraceGlyphRow(t *testing.T) {
	var polys [][]pt
	for i := range 6 {
		x := 40 + float64(i)*50
		if i%2 == 0 { // L
			polys = append(polys, []pt{{x, 40}, {x + 5, 40}, {x + 5, 65}, {x + 18, 65}, {x + 18, 70}, {x, 70}})
		} else { // T
			polys = append(polys, []pt{{x, 40}, {x + 20, 40}, {x + 20, 45}, {x + 12.5, 45}, {x + 12.5, 70}, {x + 7.5, 70}, {x + 7.5, 45}, {x, 45}})
		}
	}
	in := func(x, y float64) bool {
		for _, p := range polys {
			if inPoly(p, x, y) {
				return true
			}
		}
		return false
	}
	img := aaImage(400, 110, white, ink, in)
	r := traceOf(t, img, TraceOptions{MinArea: 0.0002})
	if len(r.Paths) != 6 {
		t.Fatalf("glyphs traced: %d, want 6", len(r.Paths))
	}
	for _, p := range r.Paths {
		if p.Corners < 6 || p.Corners > 9 {
			t.Fatalf("glyph at %+v has %d corners", p.BBox, p.Corners)
		}
	}
	worst := 0.0
	for _, p := range r.Paths {
		for _, pl := range polys {
			bb := p.BBox
			if math.Abs(bb.X-pl[0].x) < 3 {
				worst = math.Max(worst, maxDeviation(flatten(t, p.D), pl))
			}
		}
	}
	if worst > 0.9 {
		t.Fatalf("a glyph strays %.2f px from its outline", worst)
	}
}
