package vision

import (
	"image"
	"image/color"
	"math"
	"strings"
	"testing"
)

// Backgrounds that are not flat: the ink is what differs from the modelled background at that
// pixel, so the same subject scores the same over a gradient, a vignette or a flat color.

func lerpC(a, b color.NRGBA, t float64) color.NRGBA {
	f := func(x, y uint8) uint8 { return uint8(math.Round(float64(x) + (float64(y)-float64(x))*t)) }
	return color.NRGBA{f(a.R, b.R), f(a.G, b.G), f(a.B, b.B), 255}
}

// onBackground paints the shapes over bg(x, y).
func onBackground(w, h int, bg func(x, y int) color.NRGBA, shapes ...shape) *image.NRGBA {
	img := paint(w, h, white, shapes...)
	ref := paint(w, h, white)
	for y := range h {
		for x := range w {
			if img.NRGBAAt(x, y) == ref.NRGBAAt(x, y) {
				img.SetNRGBA(x, y, bg(x, y))
			}
		}
	}
	return img
}

func linearBG(w, h int, a, b color.NRGBA) func(x, y int) color.NRGBA {
	return func(x, y int) color.NRGBA {
		return lerpC(a, b, (float64(x)/float64(w)+float64(y)/float64(h))/2)
	}
}

func vignetteBG(w, h int, centre, edge color.NRGBA) func(x, y int) color.NRGBA {
	return func(x, y int) color.NRGBA {
		dx, dy := (float64(x)-float64(w)/2)/(float64(w)/2), (float64(y)-float64(h)/2)/(float64(h)/2)
		return lerpC(centre, edge, math.Min(1, math.Hypot(dx, dy)/1.41))
	}
}

// a wordmark: a row of bars of the same height, like letter stems
func wordmark(dx float64) []shape {
	var s []shape
	for i := range 6 {
		s = append(s, shape{x: 60 + dx + float64(i)*38, y: 90, w: 14, h: 60, c: navy})
	}
	return s
}

func TestCompareTextOnLinearGradient(t *testing.T) {
	const w, h = 400, 240
	grad := linearBG(w, h, color.NRGBA{250, 215, 140, 255}, color.NRGBA{245, 160, 130, 255})
	ref := onBackground(w, h, grad, wordmark(0)...)

	// the same wordmark on the same gradient
	r := cmp(t, onBackground(w, h, grad, wordmark(0)...), ref, nil)
	if r.IoU < 0.99 || r.InkShare.Reference > 0.2 {
		t.Fatalf("same: iou %v ink %+v", r.IoU, r.InkShare)
	}
	if r.Background.ReferenceModel.Kind != "gradient" || r.Background.DrawnModel.Kind != "gradient" || len(r.Background.ReferenceModel.Corners) != 4 {
		t.Fatalf("kinds: %+v", r.Background)
	}
	if !hasWarning(r, "background is a gradient") {
		t.Fatalf("no gradient warning: %v", r.Warnings)
	}

	// over a flat color of a similar average, and over a different gradient: the ink is the same
	flat := onBackground(w, h, func(int, int) color.NRGBA { return color.NRGBA{248, 188, 135, 255} }, wordmark(0)...)
	if r := cmp(t, flat, ref, nil); r.IoU < 0.98 || r.Background.DrawnModel.Kind != "flat" {
		t.Fatalf("flat drawing: iou %v %+v", r.IoU, r.Background.DrawnModel)
	}
	other := onBackground(w, h, linearBG(w, h, color.NRGBA{252, 205, 150, 255}, color.NRGBA{240, 175, 125, 255}), wordmark(0)...)
	if r := cmp(t, other, ref, nil); r.IoU < 0.98 {
		t.Fatalf("another gradient: iou %v", r.IoU)
	}

	// a shift still costs, smoothly
	prev := 1.0
	for _, dx := range []float64{2, 4, 8} {
		r := cmp(t, onBackground(w, h, grad, wordmark(dx)...), ref, nil)
		if r.IoU >= prev || r.IoU < 0.15 {
			t.Fatalf("shift %v: iou %v after %v", dx, r.IoU, prev)
		}
		prev = r.IoU
	}

	// the colour score sees the same ink: no background colour leaks into the palettes
	if r := cmp(t, flat, ref, nil); r.Color.DeltaE > 3 || len(r.Color.Unmatched) != 0 {
		t.Fatalf("colour on gradient: %+v", r.Color)
	}
}

func TestCompareShapeOnRadialVignette(t *testing.T) {
	const w, h = 300, 300
	vig := vignetteBG(w, h, color.NRGBA{70, 30, 60, 255}, color.NRGBA{12, 4, 20, 255})
	icon := []shape{{x: 90, y: 90, w: 120, h: 120, ellipse: true, c: color.NRGBA{255, 200, 60, 255}}}
	ref := onBackground(w, h, vig, icon...)

	r := cmp(t, onBackground(w, h, vig, icon...), ref, nil)
	if r.IoU < 0.99 || r.InkShare.Reference > 0.3 {
		t.Fatalf("same: iou %v ink %+v", r.IoU, r.InkShare)
	}
	if r.Background.ReferenceModel.Kind != "gradient" {
		t.Fatalf("vignette kind: %+v", r.Background.ReferenceModel)
	}

	// the replica fits a linear gradient to the vignette: the same icon scores about the same
	lin := onBackground(w, h, linearBG(w, h, color.NRGBA{60, 25, 50, 255}, color.NRGBA{20, 8, 30, 255}), icon...)
	if r := cmp(t, lin, ref, nil); r.IoU < 0.97 {
		t.Fatalf("fitted linear gradient: iou %v", r.IoU)
	}
	flat := onBackground(w, h, func(int, int) color.NRGBA { return color.NRGBA{40, 16, 38, 255} }, icon...)
	if r := cmp(t, flat, ref, nil); r.IoU < 0.97 {
		t.Fatalf("flat background: iou %v", r.IoU)
	}

	// a different shape still fails
	small := onBackground(w, h, vig, shape{x: 110, y: 110, w: 80, h: 80, ellipse: true, c: color.NRGBA{255, 200, 60, 255}})
	if r := cmp(t, small, ref, nil); r.IoU > 0.6 || r.Missing < 0.3 {
		t.Fatalf("smaller icon: %+v", r)
	}
}

func TestCompareFlatBackgroundIsReportedFlat(t *testing.T) {
	a := paint(300, 200, white, logo(0, 0)...)
	r := cmp(t, a, paint(300, 200, white, logo(0, 0)...), nil)
	if r.Background.ReferenceModel.Kind != "flat" || r.Background.ReferenceModel.Color != "#ffffff" || r.Background.ReferenceModel.Border != 1 {
		t.Fatalf("flat: %+v", r.Background.ReferenceModel)
	}
	for _, w := range r.Warnings {
		if strings.Contains(w, "border") || strings.Contains(w, "gradient") {
			t.Fatalf("warning on a flat background: %q", w)
		}
	}
}

func TestCompareWarnsWhenTheBorderIsNotUniform(t *testing.T) {
	// a reference whose border is half flat, half a busy stripe pattern
	ref := paint(300, 200, white, logo(0, 0)...)
	for x := range 150 {
		for y := range 6 {
			c := color.NRGBA{30, 30, 30, 255}
			if (x/3)%2 == 0 {
				c = color.NRGBA{220, 90, 20, 255}
			}
			ref.SetNRGBA(x, y, c)
		}
	}
	r := cmp(t, paint(300, 200, white, logo(0, 0)...), ref, nil)
	if !hasWarning(r, "border is not uniform") {
		t.Fatalf("no border warning: %v (%+v)", r.Warnings, r.Background.ReferenceModel)
	}
}

// A subject that touches the border is not the background, however flat it is.
func TestCompareSubjectOnTheBorderStaysInk(t *testing.T) {
	ref := paint(300, 200, white, shape{x: 200, y: 60, w: 100, h: 60, c: navy}, shape{x: 40, y: 50, w: 70, h: 70, ellipse: true, c: red})
	r := cmp(t, paint(300, 200, white), ref, nil)
	if r.Background.ReferenceModel.Kind != "flat" || r.Background.ReferenceModel.Color != "#ffffff" {
		t.Fatalf("background: %+v", r.Background.ReferenceModel)
	}
	if r.Missing < 0.99 {
		t.Fatalf("an empty drawing should miss all the ink, including the bar on the border: %+v", r)
	}
}

func hasWarning(r *Comparison, sub string) bool {
	for _, w := range r.Warnings {
		if strings.Contains(w, sub) {
			return true
		}
	}
	return false
}
