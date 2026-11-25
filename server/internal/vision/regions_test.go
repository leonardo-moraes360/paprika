package vision

import (
	"encoding/json"
	"image"
	"image/color"
	"math"
	"math/rand"
	"testing"
)

func mixedSheet() *image.NRGBA {
	c := newCanvas(320, 240, white)
	rng := rand.New(rand.NewSource(7))
	for y := 20; y < 140; y++ {
		for x := 20; x < 140; x++ {
			v := func() uint8 { return uint8(60 + rng.Intn(140)) }
			c.img.SetNRGBA(x, y, color.NRGBA{v(), v(), v(), 255})
		}
	}
	c.ellipse(color.NRGBA{220, 30, 40, 255}, 230, 55, 30, 30, 0)
	for y := 105; y < 155; y++ {
		for x := 165; x < 295; x++ {
			f := float64(x-165) / 129
			c.img.SetNRGBA(x, y, color.NRGBA{uint8(30 + 220*f), uint8(60 + 90*f), uint8(200 - 170*f), 255})
		}
	}
	x := 30
	for i, w := range []int{6, 9, 5, 8, 7, 10, 5, 8, 6} {
		for yy := 185; yy < 200; yy++ {
			for xx := x; xx < x+w; xx++ {
				c.img.SetNRGBA(xx, yy, color.NRGBA{30, 30, 30, 255})
			}
		}
		x += w + 4 + i%2*3
	}
	c.roundRect(color.NRGBA{20, 40, 110, 255}, 245, 205, 45, 20, 8, 0)
	return c.img
}

func regionOf(res *Result, kind string) []ImageRegion {
	var out []ImageRegion
	for _, r := range res.Regions {
		if r.Kind == kind {
			out = append(out, r)
		}
	}
	return out
}

func TestRegionsKinds(t *testing.T) {
	res, err := Analyze(mixedSheet(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	js, _ := json.Marshal(res.Regions)
	t.Logf("regions: %s", js)

	area := 0.0
	for i, a := range res.Regions {
		area += a.Box.Width * a.Box.Height
		for _, b := range res.Regions[i+1:] {
			ix := math.Min(a.Box.X+a.Box.Width, b.Box.X+b.Box.Width) - math.Max(a.Box.X, b.Box.X)
			iy := math.Min(a.Box.Y+a.Box.Height, b.Box.Y+b.Box.Height) - math.Max(a.Box.Y, b.Box.Y)
			if ix > 0.5 && iy > 0.5 {
				t.Errorf("%s and %s overlap", a.ID, b.ID)
			}
		}
	}
	if math.Abs(area-320*240) > 320 {
		t.Errorf("regions cover %.0f of %d", area, 320*240)
	}

	photos := regionOf(res, KindPhoto)
	if len(photos) != 1 {
		t.Fatalf("want 1 photo region, got %d", len(photos))
	}
	p := photos[0]
	near(t, "photo x", p.Box.X, 20, 21)
	near(t, "photo y", p.Box.Y, 20, 21)
	near(t, "photo w", p.Box.Width, 120, 21)
	near(t, "photo h", p.Box.Height, 120, 21)
	if p.Suggest != "import_image" {
		t.Errorf("photo suggest %q", p.Suggest)
	}

	grads := regionOf(res, KindGradient)
	if len(grads) != 1 {
		t.Fatalf("want 1 gradient region, got %d", len(grads))
	}
	g := grads[0]
	near(t, "gradient x", g.Box.X, 165, 3)
	near(t, "gradient w", g.Box.Width, 130, 4)
	near(t, "gradient y", g.Box.Y, 105, 3)
	near(t, "gradient h", g.Box.Height, 50, 3)
	if g.Suggest != "gradient" || g.Gradient == nil || g.Gradient.Type != "linear" {
		t.Fatalf("gradient region %+v", g)
	}
	near(t, "gradient angle", *g.Gradient.Angle, 90, 3)
	first, last := g.Gradient.Stops[0], g.Gradient.Stops[len(g.Gradient.Stops)-1]
	if first.Offset != 0 || last.Offset != 1 || first.Color == last.Color {
		t.Errorf("stops %+v", g.Gradient.Stops)
	}
	if first.Color[1:3] > "50" || last.Color[1:3] < "d0" {
		t.Errorf("stop colors %s .. %s", first.Color, last.Color)
	}

	texts := regionOf(res, KindText)
	if len(texts) != 1 {
		t.Fatalf("want 1 text region, got %d", len(texts))
	}
	tx := texts[0]
	near(t, "text x", tx.Box.X, 30, 3)
	near(t, "text y", tx.Box.Y, 185, 3)
	near(t, "text h", tx.Box.Height, 15, 4)
	if tx.Suggest != "text" || tx.FontSize < 14 || tx.FontSize > 28 || tx.Lines != 1 {
		t.Errorf("text region %+v", tx)
	}

	flats := regionOf(res, KindFlat)
	if len(flats) == 0 {
		t.Fatal("no flat region")
	}
	disc := blobNear(res, 230, 55)
	if disc == nil || disc.Suggest != "primitive" || disc.Fit.Kind != "circle" {
		t.Fatalf("disc blob %+v", disc)
	}
	if reg := regionByID(res, disc.Region); reg.Kind != KindFlat || reg.Suggest != "primitive" {
		t.Errorf("disc region %+v", reg)
	}
	rr := blobNear(res, 245, 205)
	if rr == nil || rr.Suggest != "primitive" {
		t.Fatalf("round rect blob %+v", rr)
	}
	for _, b := range res.Blobs {
		reg := regionByID(res, b.Region)
		switch reg.Kind {
		case KindPhoto:
			if b.Suggest != "skip-in-photo" {
				t.Errorf("%s in the photo suggests %s", b.ID, b.Suggest)
			}
		case KindText:
			if b.Suggest != "text" {
				t.Errorf("%s in the text suggests %s", b.ID, b.Suggest)
			}
		}
	}
}

func blobNear(res *Result, x, y float64) *Blob {
	for i := range res.Blobs {
		b := &res.Blobs[i]
		if math.Hypot(b.Centroid.X-x, b.Centroid.Y-y) < 6 {
			return b
		}
	}
	return nil
}

func regionByID(res *Result, id string) ImageRegion {
	for _, r := range res.Regions {
		if r.ID == id {
			return r
		}
	}
	return ImageRegion{}
}

func TestGradientIsNotAPhoto(t *testing.T) {
	cases := map[string]func(x, y int) color.NRGBA{
		"linear": func(x, y int) color.NRGBA {
			f := float64(x+y) / 510
			return color.NRGBA{uint8(250 - 200*f), uint8(80 + 120*f), uint8(40 + 190*f), 255}
		},
		"radial": func(x, y int) color.NRGBA {
			f := math.Min(1, math.Hypot(float64(x-128), float64(y-128))/128)
			return color.NRGBA{uint8(255 - 200*f), uint8(220 - 150*f), uint8(80 + 100*f), 255}
		},
	}
	for name, fn := range cases {
		img := image.NewNRGBA(image.Rect(0, 0, 256, 256))
		for y := range 256 {
			for x := range 256 {
				img.SetNRGBA(x, y, fn(x, y))
			}
		}
		res, err := Analyze(img, Options{})
		if err != nil {
			t.Fatal(err)
		}
		if len(regionOf(res, KindPhoto)) != 0 {
			t.Errorf("%s: classified as a photo: %+v", name, res.Regions)
		}
		var withGrad *ImageRegion
		for i, r := range res.Regions {
			if r.Kind == KindGradient && r.Gradient != nil && (withGrad == nil || r.Share > withGrad.Share) {
				withGrad = &res.Regions[i]
			}
		}
		if withGrad == nil || withGrad.Share < 0.8 || withGrad.Suggest != "gradient" {
			t.Errorf("%s: no gradient region: %+v", name, res.Regions)
			continue
		}
		if g := withGrad.Gradient; g.Type != name || len(g.Stops) < 2 {
			t.Errorf("%s: gradient %+v", name, g)
		}
	}
}

func TestTextAndIconsAreNotPhotos(t *testing.T) {
	c := newCanvas(320, 120, white)
	x := 10
	for range 30 {
		for yy := 30; yy < 44; yy++ {
			for xx := x; xx < x+3; xx++ {
				c.img.SetNRGBA(xx, yy, color.NRGBA{0, 0, 0, 255})
			}
		}
		x += 6
	}
	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(regionOf(res, KindPhoto)) != 0 {
		t.Errorf("stripes taken for a photo: %+v", res.Regions)
	}
}

func TestRowOfIdenticalBlobsIsNotText(t *testing.T) {
	c := newCanvas(320, 120, white)
	for i := range 6 {
		c.ellipse(color.NRGBA{200, 30, 30, 255}, float64(40+i*48), 60, 12, 12, 0)
	}
	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(regionOf(res, KindText)) != 0 {
		t.Errorf("dots taken for text: %+v", res.Regions)
	}
	for _, b := range res.Blobs {
		if b.Suggest != "primitive" {
			t.Errorf("%s suggests %s", b.ID, b.Suggest)
		}
	}
}

func TestFlatOrganicSuggestsTrace(t *testing.T) {
	c := newCanvas(240, 240, white)
	c.polygon(color.NRGBA{30, 140, 60, 255}, []pt{{30, 200}, {60, 90}, {110, 40}, {190, 30}, {210, 70}, {150, 100}, {170, 150}, {90, 210}})
	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Blobs) == 0 || res.Blobs[0].Suggest != "trace_image" {
		t.Fatalf("blobs %+v", res.Blobs)
	}
	flat := regionOf(res, KindFlat)
	if len(flat) != 1 || flat[0].Suggest != "trace_image" {
		t.Errorf("regions %+v", res.Regions)
	}
}

func TestPerCornerRoundRect(t *testing.T) {
	c := newCanvas(240, 200, white)
	col := color.NRGBA{20, 40, 110, 255}
	radii := [4]float64{30, 0, 14, 0}
	x0, y0, x1, y1 := 40.0, 50.0, 200.0, 150.0
	c.paint(col, func(x, y float64) bool {
		if x < x0 || x > x1 || y < y0 || y > y1 {
			return false
		}
		corner := func(cx, cy, r float64, sx, sy float64) bool {
			if r == 0 || (x-cx)*sx < 0 || (y-cy)*sy < 0 {
				return true
			}
			return math.Hypot(x-cx, y-cy) <= r
		}
		return corner(x0+radii[0], y0+radii[0], radii[0], -1, -1) &&
			corner(x1-radii[2], y1-radii[2], radii[2], 1, 1)
	})
	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	b := res.Blobs[0]
	if b.Fit.Kind != "roundRect" {
		t.Fatalf("fit %+v", b.Fit)
	}
	rad, ok := b.Fit.Node.Radius.([]float64)
	if !ok || len(rad) != 4 {
		t.Fatalf("radius %#v", b.Fit.Node.Radius)
	}
	for i, want := range radii {
		near(t, "corner", rad[i], want, 3)
	}
	if b.Fit.IoU < 0.97 || b.Fit.Simplicity.Nodes != 1 || b.Fit.Simplicity.Params != 9 {
		t.Errorf("fit %+v", b.Fit)
	}
}

func TestRoundedHexagon(t *testing.T) {
	c := newCanvas(240, 240, white)
	rot := 0.0
	R, rc := 90.0, 20.0
	n := 6
	a := R * math.Cos(math.Pi/float64(n))
	in := a - rc
	verts := make([]pt, n)
	for i := range verts {
		ang := rot + 2*math.Pi*float64(i)/float64(n)
		verts[i] = pt{in / math.Cos(math.Pi/float64(n)) * math.Cos(ang), in / math.Cos(math.Pi/float64(n)) * math.Sin(ang)}
	}
	col := color.NRGBA{200, 80, 20, 255}
	c.paint(col, func(x, y float64) bool {
		q := pt{x - 120, y - 120}
		if inPoly(verts, q.x, q.y) {
			return true
		}
		for i := range verts {
			if segDist(q, verts[i], verts[(i+1)%n]) <= rc {
				return true
			}
		}
		return false
	})
	res, err := Analyze(c.img, Options{})
	if err != nil {
		t.Fatal(err)
	}
	b := res.Blobs[0]
	if b.Fit.Kind != "polygon" || b.Fit.Sides != 6 {
		t.Fatalf("fit %+v (nearest %s %.3f)", b.Fit, b.Fit.Nearest, b.Fit.NearestIoU)
	}
	near(t, "corner radius", b.Fit.CornerRadius, rc, 4)
	near(t, "circumradius", b.Fit.Radius, R, 4)
	if b.Fit.Node == nil || b.Fit.Node.Type != "path" || b.Fit.Node.D == "" {
		t.Fatalf("node %+v", b.Fit.Node)
	}
	if b.Fit.IoU < 0.97 || b.Fit.Simplicity.Nodes != 1 {
		t.Errorf("fit %+v", b.Fit)
	}
	if b.Suggest != "primitive" {
		t.Errorf("suggest %s", b.Suggest)
	}
}
