package vision

import (
	"encoding/json"
	"image"
	"image/color"
	"math"
	"testing"
	"time"
)

// canvas draws anti-aliased shapes (3x3 supersampling) onto an opaque background.
type canvas struct {
	img *image.NRGBA
}

func newCanvas(w, h int, bg color.NRGBA) *canvas {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = bg.R, bg.G, bg.B, bg.A
	}
	return &canvas{img}
}

func (c *canvas) paint(col color.NRGBA, inside func(x, y float64) bool) {
	b := c.img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			n := 0
			for sy := range 3 {
				for sx := range 3 {
					if inside(float64(x)+(float64(sx)+0.5)/3, float64(y)+(float64(sy)+0.5)/3) {
						n++
					}
				}
			}
			if n == 0 {
				continue
			}
			t := float64(n) / 9
			o := c.img.NRGBAAt(x, y)
			mix := func(a, b uint8) uint8 { return uint8(math.Round(float64(a)*(1-t) + float64(b)*t)) }
			c.img.SetNRGBA(x, y, color.NRGBA{mix(o.R, col.R), mix(o.G, col.G), mix(o.B, col.B), 255})
		}
	}
}

func (c *canvas) ellipse(col color.NRGBA, cx, cy, rx, ry, deg float64) {
	s, co := math.Sincos(deg * math.Pi / 180)
	c.paint(col, func(x, y float64) bool {
		dx, dy := x-cx, y-cy
		u, v := dx*co+dy*s, -dx*s+dy*co
		return (u/rx)*(u/rx)+(v/ry)*(v/ry) <= 1
	})
}

func (c *canvas) roundRect(col color.NRGBA, cx, cy, hw, hh, r, deg float64) {
	s, co := math.Sincos(deg * math.Pi / 180)
	c.paint(col, func(x, y float64) bool {
		dx, dy := x-cx, y-cy
		u, v := math.Abs(dx*co+dy*s)-(hw-r), math.Abs(-dx*s+dy*co)-(hh-r)
		return math.Hypot(math.Max(u, 0), math.Max(v, 0))+math.Min(math.Max(u, v), 0)-r <= 0
	})
}

func (c *canvas) polygon(col color.NRGBA, p []pt) {
	c.paint(col, func(x, y float64) bool { return inPoly(p, x, y) })
}

func regular(cx, cy, r float64, n int, deg float64) []pt {
	out := make([]pt, n)
	for i := range out {
		a := (deg + 360*float64(i)/float64(n)) * math.Pi / 180
		out[i] = pt{cx + r*math.Cos(a), cy + r*math.Sin(a)}
	}
	return out
}

var (
	white  = color.NRGBA{255, 255, 255, 255}
	red    = color.NRGBA{220, 30, 40, 255}
	navy   = color.NRGBA{20, 40, 110, 255}
	orange = color.NRGBA{250, 140, 20, 255}
	green  = color.NRGBA{30, 150, 80, 255}
	black  = color.NRGBA{10, 10, 10, 255}
)

func near(t *testing.T, name string, got, want, tol float64) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s = %.2f, want %.2f ± %.2f", name, got, want, tol)
	}
}

func analyze(t *testing.T, img image.Image, opt Options) *Result {
	t.Helper()
	r, err := Analyze(img, opt)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func hasBlob(t *testing.T, r *Result, kind, color string) *Blob {
	t.Helper()
	for i := range r.Blobs {
		if r.Blobs[i].Fit.Kind == kind && r.Blobs[i].Color == color {
			return &r.Blobs[i]
		}
	}
	t.Fatalf("no %s blob of %s in %s", kind, color, r.Summary())
	return nil
}

func TestCircle(t *testing.T) {
	c := newCanvas(400, 300, white)
	c.ellipse(red, 200, 150, 80, 80, 0)
	r := analyze(t, c.img, Options{})
	if r.Background.Color != "#ffffff" {
		t.Errorf("background %+v", r.Background)
	}
	if len(r.Palette) != 2 || r.Palette[0].Color != "#ffffff" || r.Palette[1].Color != "#dc1e28" {
		t.Errorf("palette %+v", r.Palette)
	}
	if len(r.Blobs) != 1 {
		t.Fatalf("blobs: %s", r.Summary())
	}
	b := r.Blobs[0]
	if b.Fit.Kind != "circle" || b.Fit.IoU < 0.97 {
		t.Fatalf("fit %+v", b.Fit)
	}
	n := b.Fit.Node
	near(t, "x", n.X, 120, 1.5)
	near(t, "y", n.Y, 70, 1.5)
	near(t, "width", *n.Width, 160, 2)
	near(t, "height", *n.Height, 160, 2)
	near(t, "centroid.x", b.Centroid.X, 200, 1)
	near(t, "areaPx", b.AreaPx, math.Pi*80*80, 0.02*math.Pi*80*80)
	if b.Symmetry.MirrorX < 0.97 || b.Symmetry.MirrorY < 0.97 {
		t.Errorf("symmetry %+v", b.Symmetry)
	}
}

func TestRotatedEllipse(t *testing.T) {
	c := newCanvas(400, 300, white)
	c.ellipse(navy, 190, 140, 100, 40, 25)
	r := analyze(t, c.img, Options{})
	b := hasBlob(t, r, "ellipse", "#14286e")
	n := b.Fit.Node
	near(t, "width", *n.Width, 200, 4)
	near(t, "height", *n.Height, 80, 4)
	near(t, "rotation", n.Rotation, 25, 2)
	near(t, "orientation", b.Orientation, 25, 2)
	near(t, "center x", n.X+*n.Width/2, 190, 1.5)
	near(t, "center y", n.Y+*n.Height/2, 140, 1.5)
}

func TestRoundedRect(t *testing.T) {
	c := newCanvas(400, 300, white)
	c.roundRect(green, 200, 150, 80, 45, 20, 0)
	r := analyze(t, c.img, Options{})
	b := hasBlob(t, r, "roundRect", "#1e9650")
	n := b.Fit.Node
	if n.Type != "rect" {
		t.Errorf("node %+v", n)
	}
	near(t, "width", *n.Width, 160, 2)
	near(t, "height", *n.Height, 90, 2)
	near(t, "radius", n.Radius, 20, 3)
	if n.Rotation != 0 {
		t.Errorf("rotation %v", n.Rotation)
	}
}

func TestPlainRectAndRotatedRect(t *testing.T) {
	c := newCanvas(400, 300, white)
	c.roundRect(red, 100, 150, 60, 30, 0, 0)
	c.roundRect(navy, 300, 150, 60, 30, 0, 30)
	r := analyze(t, c.img, Options{})
	a := hasBlob(t, r, "rect", "#dc1e28")
	near(t, "rect width", *a.Fit.Node.Width, 120, 2)
	b := hasBlob(t, r, "rect", "#14286e")
	near(t, "rotated width", *b.Fit.Node.Width, 120, 4)
	near(t, "rotated height", *b.Fit.Node.Height, 60, 4)
	near(t, "rotation", b.Fit.Node.Rotation, 30, 2.5)
}

func TestRingWithHole(t *testing.T) {
	c := newCanvas(300, 300, white)
	c.ellipse(black, 150, 150, 100, 100, 0)
	c.ellipse(white, 150, 150, 50, 50, 0)
	r := analyze(t, c.img, Options{})
	ring := hasBlob(t, r, "circle", "#0a0a0a")
	if ring.Holes != 1 || len(ring.HoleBoxes) != 1 {
		t.Fatalf("holes %d %+v", ring.Holes, ring.HoleBoxes)
	}
	near(t, "hole width", ring.HoleBoxes[0].Width, 100, 3)
	near(t, "outer width", *ring.Fit.Node.Width, 200, 2)
	if !ring.Fit.HolesFilled {
		t.Error("holesFilled should be set")
	}
	// the hole is listed as its own white blob (it does not touch the border)
	inner := hasBlob(t, r, "circle", "#ffffff")
	near(t, "inner width", *inner.Fit.Node.Width, 100, 3)
	if r.Blobs[0].ID != "b1" || r.Blobs[0].Color != "#0a0a0a" {
		t.Errorf("order: %s", r.Summary())
	}
}

func TestGridOfSquares(t *testing.T) {
	c := newCanvas(400, 320, white)
	for row := range 3 {
		for col := range 4 {
			cx, cy := 60+float64(col)*95, 60+float64(row)*100
			c.roundRect(navy, cx, cy, 30, 30, 0, 0)
		}
	}
	r := analyze(t, c.img, Options{})
	if len(r.Blobs) != 12 {
		t.Fatalf("blobs %d: %s", len(r.Blobs), r.Summary())
	}
	if len(r.Layout.Repeats) != 1 || r.Layout.Repeats[0].Count != 12 || r.Layout.Repeats[0].Kind != "rect" {
		t.Fatalf("repeats %+v", r.Layout.Repeats)
	}
	if len(r.Layout.Grids) != 1 {
		t.Fatalf("grids %+v", r.Layout.Grids)
	}
	g := r.Layout.Grids[0]
	if g.Rows != 3 || g.Cols != 4 || g.Filled != 12 {
		t.Errorf("grid %+v", g)
	}
	near(t, "pitchX", g.PitchX, 95, 1)
	near(t, "pitchY", g.PitchY, 100, 1)
	near(t, "origin x", g.Origin.X, 60, 1)
	near(t, "gapX", g.GapX, 35, 2)
	if len(r.Layout.Radials) != 0 {
		t.Errorf("radials %+v", r.Layout.Radials)
	}
}

func TestPetalsAroundCenter(t *testing.T) {
	c := newCanvas(400, 400, white)
	for i := range 8 {
		a := float64(i) * 45
		s, co := math.Sincos(a * math.Pi / 180)
		c.ellipse(orange, 200+110*co, 200+110*s, 50, 22, a)
	}
	c.ellipse(navy, 200, 200, 30, 30, 0)
	r := analyze(t, c.img, Options{})
	if len(r.Layout.Radials) != 1 {
		t.Fatalf("radials: %s", r.Summary())
	}
	rd := r.Layout.Radials[0]
	if rd.Count != 8 {
		t.Errorf("count %d", rd.Count)
	}
	near(t, "center x", rd.Center.X, 200, 1.5)
	near(t, "center y", rd.Center.Y, 200, 1.5)
	near(t, "radius", rd.Radius, 110, 2)
	near(t, "step", rd.StepAngle, 45, 0.5)
	if rd.Alignment != "radial" {
		t.Errorf("alignment %q %v", rd.Alignment, rd.MemberOffset)
	}
	if rd.CenterBlob == "" {
		t.Error("center blob missing")
	}
	if len(r.Layout.Grids) != 0 {
		t.Errorf("grids %+v", r.Layout.Grids)
	}
}

func TestTwoColorLogo(t *testing.T) {
	c := newCanvas(400, 400, white)
	c.roundRect(navy, 200, 200, 150, 150, 40, 0)
	// five-pointed star in orange
	var star []pt
	for i := range 10 {
		rad := 100.0
		if i%2 == 1 {
			rad = 42
		}
		a := (float64(i)*36 - 90) * math.Pi / 180
		star = append(star, pt{200 + rad*math.Cos(a), 205 + rad*math.Sin(a)})
	}
	c.polygon(orange, star)
	r := analyze(t, c.img, Options{MaxPoints: 16})
	if len(r.Palette) != 3 {
		t.Fatalf("palette %+v", r.Palette)
	}
	if r.Background.Color != "#ffffff" {
		t.Errorf("bg %+v", r.Background)
	}
	hasBlob(t, r, "roundRect", "#14286e")
	s := hasBlob(t, r, "freeform", "#fa8c14")
	if n := len(s.Fit.Outline); n < 8 || n > 16 {
		t.Errorf("outline points %d", n)
	}
	if s.Fit.IoU < 0.9 {
		t.Errorf("outline iou %v", s.Fit.IoU)
	}
	if s.Fit.Node.Type != "path" || s.Fit.Node.D == "" {
		t.Errorf("node %+v", s.Fit.Node)
	}
	if s.Symmetry.MirrorX < 0.95 {
		t.Errorf("star mirrorX %v", s.Symmetry.MirrorX)
	}
	if s.Fit.Nearest == "" {
		t.Error("nearest missing")
	}
}

func TestRegularPolygons(t *testing.T) {
	c := newCanvas(500, 200, white)
	c.polygon(red, regular(80, 100, 60, 6, 0))
	c.polygon(navy, regular(250, 105, 70, 3, -90))
	c.polygon(green, regular(410, 100, 60, 5, -90))
	r := analyze(t, c.img, Options{})
	for _, tc := range []struct {
		color string
		sides int
	}{{"#dc1e28", 6}, {"#14286e", 3}, {"#1e9650", 5}} {
		b := hasBlob(t, r, "polygon", tc.color)
		if b.Fit.Sides != tc.sides {
			t.Errorf("%s sides %d, want %d", tc.color, b.Fit.Sides, tc.sides)
		}
		near(t, tc.color+" radius", b.Fit.Radius, map[string]float64{"#dc1e28": 60, "#14286e": 70, "#1e9650": 60}[tc.color], 3)
	}
	hex := hasBlob(t, r, "polygon", "#dc1e28")
	near(t, "hexagon rotation", math.Mod(hex.Fit.Rotation, 60), 0, 4)
}

func TestNoiseDoesNotAddColors(t *testing.T) {
	c := newCanvas(300, 200, color.NRGBA{250, 248, 240, 255})
	c.ellipse(red, 150, 100, 70, 50, 0)
	seed := uint32(12345)
	for i := 0; i < len(c.img.Pix); i += 4 {
		for k := range 3 {
			seed = seed*1664525 + 1013904223
			d := int(seed>>24)%9 - 4
			v := int(c.img.Pix[i+k]) + d
			c.img.Pix[i+k] = uint8(max(0, min(255, v)))
		}
	}
	r := analyze(t, c.img, Options{})
	if len(r.Palette) != 2 {
		t.Fatalf("palette %+v", r.Palette)
	}
	if len(r.Blobs) != 1 || r.Blobs[0].Fit.Kind != "ellipse" {
		t.Fatalf("blobs: %s", r.Summary())
	}
}

func TestTransformRegionAndTransparency(t *testing.T) {
	c := newCanvas(400, 300, white)
	c.ellipse(red, 200, 150, 80, 80, 0)
	// frame 800x600 scaled 2x: the circle doubles
	r := analyze(t, c.img, Options{Scale: 2})
	n := r.Blobs[0].Fit.Node
	near(t, "scaled width", *n.Width, 320, 4)
	near(t, "scaled x", n.X, 240, 3)
	// offset like place_reference centering
	r = analyze(t, c.img, Options{Scale: 1, OffsetX: 50, OffsetY: 10})
	near(t, "offset x", r.Blobs[0].Fit.Node.X, 170, 2)
	// region: only the right half of the circle plus white
	r = analyze(t, c.img, Options{Region: &Rect{X: 200, Y: 0, Width: 200, Height: 300}})
	if r.Region.X != 200 || r.Region.Width != 200 {
		t.Errorf("region %+v", r.Region)
	}
	near(t, "region bbox x", r.Blobs[0].BBox.X, 200, 1)
	// transparent background
	tr := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	cc := &canvas{tr}
	cc.ellipse(navy, 50, 50, 30, 30, 0)
	// paint() blends with the transparent bg: reset alpha to the coverage-free value
	for i := 0; i < len(tr.Pix); i += 4 {
		if tr.Pix[i+3] != 0 {
			tr.Pix[i+3] = 255
		}
	}
	r = analyze(t, tr, Options{})
	if !r.Background.Transparent || r.TransparentShare < 0.5 {
		t.Errorf("transparent bg %+v share %v", r.Background, r.TransparentShare)
	}
	if len(r.Blobs) != 1 || r.Blobs[0].Fit.Kind != "circle" {
		t.Fatalf("blobs %s", r.Summary())
	}
}

func TestTruncation(t *testing.T) {
	c := newCanvas(400, 400, white)
	for i := range 25 {
		c.roundRect(navy, 40+float64(i%5)*80, 40+float64(i/5)*80, 12, 12, 0, 0)
	}
	r := analyze(t, c.img, Options{MaxBlobs: 10})
	if !r.Truncated || len(r.Blobs) != 10 || r.BlobCount != 25 {
		t.Errorf("truncated=%v blobs=%d count=%d", r.Truncated, len(r.Blobs), r.BlobCount)
	}
}

func TestDeterministic(t *testing.T) {
	c := newCanvas(300, 300, white)
	c.ellipse(red, 100, 100, 50, 30, 20)
	c.polygon(orange, regular(200, 200, 60, 7, 10))
	c.roundRect(navy, 220, 80, 30, 20, 8, 15)
	a, _ := json.Marshal(analyze(t, c.img, Options{}))
	b, _ := json.Marshal(analyze(t, c.img, Options{}))
	if string(a) != string(b) {
		t.Fatal("two runs differ")
	}
}

func TestErrors(t *testing.T) {
	c := newCanvas(50, 50, white)
	if _, err := Analyze(c.img, Options{Region: &Rect{X: 500, Y: 500, Width: 10, Height: 10}}); err == nil {
		t.Error("region outside the image should fail")
	}
	if _, err := Analyze(c.img, Options{MinArea: 2}); err == nil {
		t.Error("minArea >= 1 should fail")
	}
	r := analyze(t, c.img, Options{})
	if len(r.Blobs) != 0 || len(r.Palette) != 1 {
		t.Errorf("blank image: %s", r.Summary())
	}
	empty := image.NewNRGBA(image.Rect(0, 0, 20, 20))
	r = analyze(t, empty, Options{})
	if !r.Background.Transparent || r.TransparentShare != 1 {
		t.Errorf("empty: %+v", r)
	}
}

func TestPerformance1200x900(t *testing.T) {
	c := newCanvas(1200, 900, color.NRGBA{245, 243, 238, 255})
	for i := range 8 {
		a := float64(i) * 45
		s, co := math.Sincos(a * math.Pi / 180)
		c.ellipse(orange, 600+250*co, 450+250*s, 110, 45, a)
	}
	c.ellipse(navy, 600, 450, 90, 90, 0)
	c.roundRect(green, 150, 150, 90, 60, 18, 0)
	c.polygon(red, regular(1050, 700, 80, 6, 0))
	for i := range 20 {
		c.roundRect(black, 60+float64(i)*55, 840, 16, 16, 3, 0)
	}
	start := time.Now()
	r := analyze(t, c.img, Options{})
	el := time.Since(start)
	t.Logf("1200x900: %v, %d blobs, %d palette colors", el, len(r.Blobs), len(r.Palette))
	if el > 2*time.Second {
		t.Errorf("analysis took %v, budget is about 1s", el)
	}
	if len(r.Layout.Radials) == 0 {
		t.Errorf("expected a radial layout: %s", r.Summary())
	}
}

func BenchmarkAnalyze1200x900(b *testing.B) {
	c := newCanvas(1200, 900, white)
	for i := range 8 {
		a := float64(i) * 45
		s, co := math.Sincos(a * math.Pi / 180)
		c.ellipse(orange, 600+250*co, 450+250*s, 110, 45, a)
	}
	c.ellipse(navy, 600, 450, 90, 90, 0)
	b.ResetTimer()
	for range b.N {
		if _, err := Analyze(c.img, Options{}); err != nil {
			b.Fatal(err)
		}
	}
}
