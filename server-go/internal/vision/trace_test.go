package vision

import (
	"image"
	"image/color"
	"math"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// shapeImage paints fg wherever in(x+.5, y+.5) holds on a white w x h canvas.
func shapeImage(w, h int, fg color.NRGBA, in func(x, y float64) bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.NRGBA{255, 255, 255, 255}
			if in(float64(x)+0.5, float64(y)+0.5) {
				c = fg
			}
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

var tokRe = regexp.MustCompile(`[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?`)

// flatten parses a traced d (M L C Z only) into polygons, sampling the cubics.
func flatten(t *testing.T, d string) [][]pt {
	t.Helper()
	toks := tokRe.FindAllString(d, -1)
	var rings [][]pt
	var cur []pt
	var last pt
	i := 0
	num := func() float64 {
		v, err := strconv.ParseFloat(toks[i], 64)
		if err != nil {
			t.Fatalf("bad number %q in %q", toks[i], d)
		}
		i++
		return v
	}
	for i < len(toks) {
		cmd := toks[i]
		i++
		switch cmd {
		case "M":
			cur = []pt{{num(), num()}}
			last = cur[0]
		case "L":
			last = pt{num(), num()}
			cur = append(cur, last)
		case "C":
			c1 := pt{num(), num()}
			c2 := pt{num(), num()}
			e := pt{num(), num()}
			for s := 1; s <= 24; s++ {
				cur = append(cur, bezPoint(bez{last, c1, c2, e}, float64(s)/24))
			}
			last = e
		case "Z":
			rings = append(rings, cur)
		default:
			t.Fatalf("unexpected %q", cmd)
		}
	}
	return rings
}

// covers is the even-odd test of a point against all rings.
func covers(rings [][]pt, x, y float64) bool {
	in := false
	for _, r := range rings {
		for i := range r {
			a, b := r[i], r[(i+1)%len(r)]
			if (a.y > y) != (b.y > y) && x < a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y) {
				in = !in
			}
		}
	}
	return in
}

func pathIoU(t *testing.T, paths []TracedPath, w, h int, want func(x, y float64) bool) float64 {
	t.Helper()
	var rings [][]pt
	for _, p := range paths {
		rings = append(rings, flatten(t, p.D)...)
	}
	inter, uni := 0, 0
	for y := range h {
		for x := range w {
			fx, fy := float64(x)+0.5, float64(y)+0.5
			a, b := covers(rings, fx, fy), want(fx, fy)
			if a && b {
				inter++
			}
			if a || b {
				uni++
			}
		}
	}
	return float64(inter) / float64(uni)
}

func traceOf(t *testing.T, img image.Image, opt TraceOptions) *TraceResult {
	t.Helper()
	r, err := Trace(img, opt)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestTraceCircle(t *testing.T) {
	disc := func(x, y float64) bool { return math.Hypot(x-100, y-100) <= 70 }
	r := traceOf(t, shapeImage(200, 200, red, disc), TraceOptions{})
	if len(r.Paths) != 1 {
		t.Fatalf("paths: %d", len(r.Paths))
	}
	p := r.Paths[0]
	if p.Lines != 0 || p.Curves > 8 || p.Curves < 2 || p.Corners != 0 {
		t.Fatalf("circle: %+v", p)
	}
	if p.Color != "#dc1e28" {
		t.Fatalf("color %s", p.Color)
	}
	iou := pathIoU(t, r.Paths, 200, 200, disc)
	t.Logf("circle: %d cubics, IoU %.4f, error %.2f px", p.Curves, iou, p.Error)
	if iou < 0.98 {
		t.Fatalf("IoU %.4f", iou)
	}
}

func TestTraceSquareKeepsCorners(t *testing.T) {
	sq := func(x, y float64) bool { return x >= 40 && x < 160 && y >= 40 && y < 160 }
	r := traceOf(t, shapeImage(200, 200, red, sq), TraceOptions{})
	p := r.Paths[0]
	if p.Corners != 4 || p.Lines != 4 || p.Curves != 0 {
		t.Fatalf("square: %+v", p)
	}
	if iou := pathIoU(t, r.Paths, 200, 200, sq); iou < 0.99 {
		t.Fatalf("IoU %.4f", iou)
	}
	rot := func(x, y float64) bool {
		u, v := (x-100)*math.Cos(0.5)+(y-100)*math.Sin(0.5), -(x-100)*math.Sin(0.5)+(y-100)*math.Cos(0.5)
		return math.Abs(u) <= 60 && math.Abs(v) <= 60
	}
	r = traceOf(t, shapeImage(200, 200, red, rot), TraceOptions{})
	if p := r.Paths[0]; p.Corners != 4 || p.Curves != 0 {
		t.Fatalf("rotated square: %+v", p)
	}
	if iou := pathIoU(t, r.Paths, 200, 200, rot); iou < 0.98 {
		t.Fatalf("rotated IoU %.4f", iou)
	}
}

func TestTraceRingKeepsHole(t *testing.T) {
	ring := func(x, y float64) bool { d := math.Hypot(x-100, y-100); return d <= 80 && d >= 40 }
	r := traceOf(t, shapeImage(200, 200, red, ring), TraceOptions{})
	if len(r.Paths) != 1 || r.Paths[0].Holes != 1 || r.Paths[0].Rings != 2 {
		t.Fatalf("ring: %+v", r.Paths)
	}
	if strings.Count(r.Paths[0].D, "M") != 2 {
		t.Fatalf("d: %s", r.Paths[0].D)
	}
	iou := pathIoU(t, r.Paths, 200, 200, ring)
	if iou < 0.97 {
		t.Fatalf("IoU %.4f", iou)
	}
	t.Logf("ring: %d segments, IoU %.4f", r.Paths[0].Segments, iou)
}

func TestTraceStarKeepsPoints(t *testing.T) {
	poly := make([]pt, 10)
	for i := range poly {
		r := 90.0
		if i%2 == 1 {
			r = 36
		}
		a := -math.Pi/2 + float64(i)*math.Pi/5
		poly[i] = pt{100 + r*math.Cos(a), 100 + r*math.Sin(a)}
	}
	star := func(x, y float64) bool { return inPoly(poly, x, y) }
	r := traceOf(t, shapeImage(200, 200, red, star), TraceOptions{})
	p := r.Paths[0]
	if p.Corners != 10 || p.Curves != 0 || p.Lines != 10 {
		t.Fatalf("star: %+v", p)
	}
	iou := pathIoU(t, r.Paths, 200, 200, star)
	t.Logf("star: %d corners, IoU %.4f", p.Corners, iou)
	if iou < 0.97 {
		t.Fatalf("IoU %.4f", iou)
	}
}

func TestTraceDropsNoiseAndHonoursOptions(t *testing.T) {
	disc := func(x, y float64) bool {
		return math.Hypot(x-100, y-100) <= 60 || (x >= 5 && x < 8 && y >= 5 && y < 8) // a 3x3 speck
	}
	img := shapeImage(200, 200, red, disc)
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 1 {
		t.Fatalf("noise kept: %d paths", len(r.Paths))
	}
	r = traceOf(t, img, TraceOptions{MinArea: 0.00005})
	if len(r.Paths) != 2 {
		t.Fatalf("speck dropped: %d paths", len(r.Paths))
	}
	r = traceOf(t, img, TraceOptions{MinArea: 0.00005, MaxPaths: 1})
	if len(r.Paths) != 1 || !r.Truncated || r.PathCount != 2 {
		t.Fatalf("truncation: %d %v %d", len(r.Paths), r.Truncated, r.PathCount)
	}
	r = traceOf(t, img, TraceOptions{IncludeBackground: true})
	if len(r.Paths) != 2 || r.Paths[0].Color != "#ffffff" {
		t.Fatalf("background: %+v", r.Paths)
	}
	r = traceOf(t, img, TraceOptions{Colors: []string{"#dc1e28"}})
	if len(r.Paths) != 1 || len(r.Warnings) != 0 {
		t.Fatalf("colors: %+v %v", r.Paths, r.Warnings)
	}
	r = traceOf(t, img, TraceOptions{Colors: []string{"#00ff00"}})
	if len(r.Warnings) == 0 {
		t.Fatal("expected a palette warning")
	}
	if _, err := Trace(img, TraceOptions{Colors: []string{"nope"}}); err == nil {
		t.Fatal("expected a hex error")
	}
}

func TestTraceNestedOrderAndFrame(t *testing.T) {
	blue := color.NRGBA{20, 40, 160, 255}
	img := image.NewNRGBA(image.Rect(0, 0, 200, 100))
	for y := range 100 {
		for x := range 200 {
			c := color.NRGBA{255, 255, 255, 255}
			fx, fy := float64(x)+0.5, float64(y)+0.5
			if math.Hypot(fx-100, fy-50) <= 45 {
				c = red
			}
			if math.Hypot(fx-100, fy-50) <= 20 {
				c = blue
			}
			img.SetNRGBA(x, y, c)
		}
	}
	// 200x100 fitted in 800x800: scale 4, y offset 200
	r := traceOf(t, img, TraceOptions{Scale: 4, OffsetY: 200})
	if len(r.Paths) != 2 || r.Paths[0].Color != "#dc1e28" || r.Paths[1].Color != "#1428a0" {
		t.Fatalf("order: %+v", r.Paths)
	}
	if r.Paths[0].Holes != 0 {
		t.Fatalf("the red disc's hole is filled by the blue one on top: %+v", r.Paths[0])
	}
	bb := r.Paths[0].BBox
	if math.Abs(bb.X-220) > 6 || math.Abs(bb.Y-(200+20)) > 6 || math.Abs(bb.Width-360) > 8 {
		t.Fatalf("bbox in frame space: %+v", bb)
	}
}

func TestTraceDeterministicAndRegion(t *testing.T) {
	disc := func(x, y float64) bool { return math.Hypot(x-100, y-100) <= 70 }
	img := shapeImage(200, 200, red, disc)
	a, b := traceOf(t, img, TraceOptions{}), traceOf(t, img, TraceOptions{})
	if a.Paths[0].D != b.Paths[0].D {
		t.Fatal("not deterministic")
	}
	if _, err := Trace(img, TraceOptions{Region: &Rect{X: 900, Y: 900, Width: 5, Height: 5}}); err == nil {
		t.Fatal("expected a region error")
	}
	r := traceOf(t, img, TraceOptions{Region: &Rect{X: 100, Y: 0, Width: 100, Height: 200}})
	if len(r.Paths) != 1 || r.Paths[0].BBox.X < 99 || r.Paths[0].BBox.X > 101 {
		t.Fatalf("region: %+v", r.Paths)
	}
}
