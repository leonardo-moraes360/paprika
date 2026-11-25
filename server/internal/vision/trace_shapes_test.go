package vision

import (
	"image"
	"math"
	"testing"
)

func TestFitCubicQuarterArc(t *testing.T) {
	var arc []pt
	for i := 0; i <= 40; i++ {
		a := float64(i) / 40 * math.Pi / 2
		arc = append(arc, pt{50 * math.Cos(a), 50 * math.Sin(a)})
	}
	var out []bez
	e := fitCubic(arc, pt{0, 1}, pt{1, 0}, 0.25*0.25, 0, &out)
	if len(out) != 1 || e > 0.25*0.25 {
		t.Fatalf("a quarter circle is one cubic: %d segments, error %.4f", len(out), e)
	}
}

func TestTraceOrganicShape(t *testing.T) {
	wavy := func(x, y float64) bool {
		a := math.Atan2(y-100, x-100)
		return math.Hypot(x-100, y-100) <= 62+12*math.Sin(5*a)
	}
	r := traceOf(t, shapeImage(200, 200, red, wavy), TraceOptions{})
	p := r.Paths[0]
	iou := pathIoU(t, r.Paths, 200, 200, wavy)
	t.Logf("organic: %d segments (%d corners), IoU %.4f", p.Segments, p.Corners, iou)
	if iou < 0.97 || p.Segments > 24 || p.Corners != 0 {
		t.Fatalf("organic: IoU %.4f, %+v", iou, p)
	}
}

func TestTraceTransparentBackground(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := range 120 {
		for x := range 120 {
			if d := math.Hypot(float64(x)+0.5-60, float64(y)+0.5-60); d <= 50 && d >= 25 {
				img.SetNRGBA(x, y, red)
			}
		}
	}
	r := traceOf(t, img, TraceOptions{})
	if len(r.Paths) != 1 || r.Paths[0].Holes != 1 || !r.Background.Transparent {
		t.Fatalf("%+v", r)
	}
}
