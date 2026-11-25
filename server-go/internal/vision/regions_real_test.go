package vision

import (
	"image"
	"image/color"
	"math/rand"
	"testing"

	xdraw "golang.org/x/image/draw"
)

// Failures seen on real references (tuned before on synthetic images only):
//   - photo texture was measured after the downsample to the analysis size, which blurs the
//     grain of a real photo away: 0 photo regions on photos;
//   - one gradient background came back as dozens of rectangles because every shape on it cut
//     the ramp into pieces.

// A photo-like patch (fine, low-amplitude noise) on a flat sheet at 1600x1200. Measured at the
// analysis size (640 px) its grain is gone; measured at source size it is a photo.
func TestFineGrainIsAPhotoOnlyAtSourceSize(t *testing.T) {
	const w, h = 1600, 1200
	rng := rand.New(rand.NewSource(11))
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.NRGBA{245, 245, 245, 255}
			if x >= 200 && x < 1000 && y >= 200 && y < 800 {
				base := 110 + 30*float64(x-200)/800
				n := func() uint8 { return uint8(base + float64(rng.Intn(25)) - 12) }
				c = color.NRGBA{n(), n(), n(), 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	res, err := Analyze(img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	photos := regionOf(res, KindPhoto)
	if len(photos) == 0 {
		t.Fatalf("no photo region at source size: %+v", res.Regions)
	}
	var share float64
	for _, p := range photos {
		share += p.Box.Width * p.Box.Height
	}
	if want := 800.0 * 600; share < 0.7*want || share > 1.4*want {
		t.Errorf("photo area %.0f, want about %.0f: %+v", share, want, photos)
	}

	// the same picture already shrunk to 640 px has lost the grain: this is what measuring at the
	// analysis size would have seen
	small := image.NewNRGBA(image.Rect(0, 0, 640, 480))
	xdraw.BiLinear.Scale(small, small.Bounds(), img, img.Bounds(), xdraw.Src, nil)
	res, err = Analyze(small, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if n := len(regionOf(res, KindPhoto)); n != 0 {
		t.Fatalf("the shrunk copy still has %d photo regions: the fixture does not prove the point", n)
	}
}

// One vertical ramp behind a ring, a rounded square and a disc: a single gradient region over
// the whole image, fitted on the ramp's own pixels, and the shapes on it keep their own tool.
func TestGradientBackgroundWithShapesIsOneRegion(t *testing.T) {
	const w, h = 960, 720
	c := newCanvas(w, h, white)
	for y := range h {
		f := float64(y) / (h - 1)
		col := color.NRGBA{uint8(20 + 40*f), uint8(30 + 80*f), uint8(90 + 140*f), 255}
		for x := range w {
			c.img.SetNRGBA(x, y, col)
		}
	}
	c.ellipse(color.NRGBA{250, 200, 60, 255}, 480, 330, 170, 170, 0)
	c.ellipse(color.NRGBA{20, 60, 150, 255}, 480, 330, 110, 110, 0)
	c.roundRect(color.NRGBA{240, 240, 245, 255}, 180, 560, 90, 70, 20, 0)
	c.ellipse(color.NRGBA{230, 70, 90, 255}, 770, 150, 70, 70, 0)

	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	grads := regionOf(res, KindGradient)
	if len(grads) != 1 {
		t.Fatalf("want one gradient region, got %d: %+v", len(grads), res.Regions)
	}
	g := grads[0]
	if g.Box.Width*g.Box.Height < 0.9*w*h {
		t.Errorf("the gradient region should cover the background, got %+v", g.Box)
	}
	if g.Suggest != "gradient" || g.Gradient == nil || g.Gradient.Type != "linear" {
		t.Fatalf("gradient region: %+v", g)
	}
	if g.FitError <= 0 || g.FitError > rampGoodRMS {
		t.Errorf("fit error %.1f should be reported and small", g.FitError)
	}
	// the stops come from the ramp, not from the shapes on it
	first, last := g.Gradient.Stops[0].Color, g.Gradient.Stops[len(g.Gradient.Stops)-1].Color
	if first[1] != '1' && first[1] != '2' || last[1] != '3' && last[1] != '4' {
		t.Errorf("stops %+v do not follow the ramp (#141e5a to #3c50e6)", g.Gradient.Stops)
	}
	// shapes on the ramp are not skipped as bands of it (the bands of the ramp are)
	for _, at := range [][2]float64{{480, 330}, {180, 560}, {770, 150}} {
		b := blobNear(res, at[0], at[1])
		if b == nil {
			t.Errorf("no blob at %v", at)
		} else if b.Suggest == "skip-in-gradient" {
			t.Errorf("shape at %v was skipped as a band of the ramp: %+v", at, b)
		}
	}
	if len(regionOf(res, KindPhoto)) != 0 {
		t.Errorf("photo on a gradient: %+v", res.Regions)
	}
}
