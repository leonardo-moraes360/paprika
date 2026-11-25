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
	grad := linearBG(w, h, color.NRGBA{252, 228, 150, 255}, color.NRGBA{240, 130, 115, 255})
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
	flat := onBackground(w, h, func(int, int) color.NRGBA { return color.NRGBA{246, 179, 132, 255} }, wordmark(0)...)
	if r := cmp(t, flat, ref, nil); r.IoU < 0.98 || r.Background.DrawnModel.Kind != "flat" {
		t.Fatalf("flat drawing: iou %v %+v", r.IoU, r.Background.DrawnModel)
	}
	other := onBackground(w, h, linearBG(w, h, color.NRGBA{252, 215, 145, 255}, color.NRGBA{242, 145, 120, 255}), wordmark(0)...)
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

// A sheet of solid-color tiles that touch each other (some close to white) is not a gradient:
// the background is the white sheet, and a blurred copy scores the same.
func TestCompareGridOfSolidTilesStaysFlat(t *testing.T) {
	const w, h = 360, 240
	tiles := []color.NRGBA{
		{200, 20, 45, 255}, white, {230, 250, 225, 255}, white, {12, 12, 12, 255}, white,
		white, {160, 180, 255, 255}, white, {238, 238, 238, 255}, white, {40, 205, 210, 255},
		{232, 232, 232, 255}, white, {216, 216, 216, 255}, white, {214, 214, 214, 255}, white,
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, tiles[(y/80)*6+x/60])
		}
	}
	for i := range 6 { // a mark on every tile
		for j := range 3 {
			for y := j*80 + 25; y < j*80+55; y++ {
				for x := i*60 + 18; x < i*60+42; x++ {
					img.SetNRGBA(x, y, color.NRGBA{20, 20, 24, 255})
				}
			}
		}
	}
	r := cmp(t, boxBlurTest(img), img, nil)
	if r.Background.ReferenceModel.Kind != "flat" || r.Background.DrawnModel.Kind != "flat" {
		t.Fatalf("tiles are not a gradient: %+v", r.Background)
	}
	if r.IoU < 0.9 {
		t.Fatalf("a blurred copy of the same tiles: iou %v", r.IoU)
	}
	if r := cmp(t, img, img, nil); r.IoU != 1 {
		t.Fatalf("identical: %v", r.IoU)
	}
}

func boxBlurTest(src *image.NRGBA) *image.NRGBA {
	b := src.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			var s [3]int
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					c := src.NRGBAAt(min(max(x+dx, b.Min.X), b.Max.X-1), min(max(y+dy, b.Min.Y), b.Max.Y-1))
					s[0] += int(c.R)
					s[1] += int(c.G)
					s[2] += int(c.B)
				}
			}
			out.SetNRGBA(x, y, color.NRGBA{uint8(s[0] / 9), uint8(s[1] / 9), uint8(s[2] / 9), 255})
		}
	}
	return out
}

// A silk-like background (soft diagonal ridges) under a wordmark, against a replica whose frame
// is one flat color: each side's ink is what differs from its own background, so the replica
// still matches.
func TestCompareSilkReferenceAgainstFlatReplica(t *testing.T) {
	const w, h = 400, 300
	silk := func(x, y int) color.NRGBA {
		u := (float64(x)/w + float64(y)/h) * 2 * math.Pi * 1.5
		k := 0.5 + 0.5*math.Sin(u)*math.Cos(float64(x)/w*3)
		return lerpC(color.NRGBA{252, 226, 150, 255}, color.NRGBA{246, 160, 130, 255}, k)
	}
	word := []shape{
		{x: 60, y: 120, w: 40, h: 60, c: navy}, {x: 120, y: 120, w: 40, h: 60, c: navy},
		{x: 180, y: 120, w: 40, h: 60, c: navy}, {x: 240, y: 120, w: 40, h: 60, c: navy},
	}
	ref := onBackground(w, h, silk, word...)
	flat := onBackground(w, h, func(int, int) color.NRGBA { return color.NRGBA{249, 193, 140, 255} }, word...)
	r := cmp(t, flat, ref, nil)
	if r.Background.ReferenceModel.Kind != "gradient" || r.Background.DrawnModel.Kind != "flat" {
		t.Fatalf("kinds: %+v", r.Background)
	}
	if r.IoU < 0.9 || r.Extra > 0.05 {
		t.Fatalf("flat replica of a silk reference: iou %v missing %v extra %v ink %+v", r.IoU, r.Missing, r.Extra, r.InkShare)
	}
	if r := cmp(t, onBackground(w, h, silk, word...), ref, nil); r.IoU != 1 {
		t.Fatalf("identical: %v", r.IoU)
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
