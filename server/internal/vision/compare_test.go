package vision

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"reflect"
	"testing"
	"time"
)

type shape struct {
	x, y, w, h float64
	ellipse    bool
	c          color.NRGBA
}

var grn = color.NRGBA{30, 160, 70, 255}

func paint(w, h int, bg color.NRGBA, shapes ...shape) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	fillNRGBA(img, bg)
	for _, s := range shapes {
		for y := range h {
			for x := range w {
				px, py := float64(x)+0.5, float64(y)+0.5
				in := px >= s.x && px < s.x+s.w && py >= s.y && py < s.y+s.h
				if s.ellipse {
					cx, cy := s.x+s.w/2, s.y+s.h/2
					in = ((px-cx)/(s.w/2))*((px-cx)/(s.w/2))+((py-cy)/(s.h/2))*((py-cy)/(s.h/2)) <= 1
				}
				if in {
					img.SetNRGBA(x, y, s.c)
				}
			}
		}
	}
	return img
}

func cmp(t *testing.T, drawn, ref image.Image, nodes []NodeBox) *Comparison {
	t.Helper()
	b := drawn.Bounds()
	res, err := Compare(CompareInput{
		Drawn: drawn, Ref: ref, FrameW: float64(b.Dx()), FrameH: float64(b.Dy()),
		Placed: Rect{Width: float64(b.Dx()), Height: float64(b.Dy())}, Nodes: nodes,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func logo(dx, dy float64) []shape {
	return []shape{
		{x: 40 + dx, y: 40 + dy, w: 60, h: 60, ellipse: true, c: red},
		{x: 130 + dx, y: 50 + dy, w: 80, h: 50, c: navy},
	}
}

func TestCompareIdentical(t *testing.T) {
	a := paint(300, 200, white, logo(0, 0)...)
	r := cmp(t, a, paint(300, 200, white, logo(0, 0)...), nil)
	if r.IoU != 1 || r.Missing != 0 || r.Extra != 0 || !r.Pass {
		t.Fatalf("identical: %+v", r)
	}
	if len(r.Regions) != 0 || len(r.Nodes) != 0 {
		t.Fatalf("identical regions/nodes: %+v %+v", r.Regions, r.Nodes)
	}
	if r.Color.DeltaE > 1 || r.Color.PixelDeltaE > 1 || r.Color.Score < 0.95 {
		t.Fatalf("identical colors: %+v", r.Color)
	}
	if r.RawMatch.Value < 0.99 {
		t.Fatalf("raw: %v", r.RawMatch)
	}
	if al := r.Alignment; al.DX != 0 || al.DY != 0 || al.Scale != 1 || al.Significant {
		t.Fatalf("alignment: %+v", al)
	}
	if _, err := png.Decode(bytes.NewReader(r.DiffPNG())); err != nil {
		t.Fatal(err)
	}
}

func TestCompareShiftedFindsOffset(t *testing.T) {
	ref := paint(300, 200, white, logo(14, -8)...)
	r := cmp(t, paint(300, 200, white, logo(0, 0)...), ref, nil)
	if r.IoU > 0.6 {
		t.Fatalf("a shifted drawing must score low: %v", r.IoU)
	}
	al := r.Alignment
	if math.Abs(al.DX-14) > 1.5 || math.Abs(al.DY+8) > 1.5 || math.Abs(al.Scale-1) > 0.02 {
		t.Fatalf("alignment %+v, want dx 14 dy -8", al)
	}
	if !al.Significant || al.IoUAfter < 0.95 || al.IoUAfter <= al.IoUBefore {
		t.Fatalf("alignment gain: %+v", al)
	}
	// raw pixel equality still looks fine: that is the trap the tool warns about
	if r.RawMatch.Value < 0.8 {
		t.Fatalf("raw match should be flattering: %v", r.RawMatch.Value)
	}
}

func TestCompareScaled(t *testing.T) {
	ref := paint(300, 200, white,
		shape{x: 150 - 66, y: 100 - 48, w: 132, h: 96, ellipse: true, c: red},
		shape{x: 150 - 30, y: 100 - 20, w: 60, h: 40, c: navy},
	)
	drawn := paint(300, 200, white,
		shape{x: 150 - 55, y: 100 - 40, w: 110, h: 80, ellipse: true, c: red},
		shape{x: 150 - 25, y: 100 - 16.7, w: 50, h: 33.4, c: navy},
	)
	r := cmp(t, drawn, ref, nil)
	al := r.Alignment
	if math.Abs(al.Scale-1.2) > 0.03 || math.Abs(al.DX) > 2 || math.Abs(al.DY) > 2 || al.IoUAfter < 0.93 {
		t.Fatalf("alignment %+v, want scale 1.2", al)
	}
}

func TestCompareRotation(t *testing.T) {
	rot := func(deg float64) *image.NRGBA {
		src := paint(300, 200, white, shape{x: 90, y: 80, w: 120, h: 30, c: navy}, shape{x: 90, y: 110, w: 30, h: 50, c: red})
		out := image.NewNRGBA(src.Bounds())
		fillNRGBA(out, white)
		th := deg * math.Pi / 180
		cs, sn := math.Cos(th), math.Sin(th)
		for y := range 200 {
			for x := range 300 {
				qx, qy := float64(x)+0.5-150, float64(y)+0.5-100
				px, py := qx*cs+qy*sn+150, -qx*sn+qy*cs+100
				if px >= 0 && py >= 0 && px < 300 && py < 200 {
					out.SetNRGBA(x, y, src.NRGBAAt(int(px), int(py)))
				}
			}
		}
		return out
	}
	b := rot(0).Bounds()
	res, err := Compare(CompareInput{Drawn: rot(0), Ref: rot(8), FrameW: 300, FrameH: 200, Placed: Rect{Width: float64(b.Dx()), Height: float64(b.Dy())}, Rotate: true})
	if err != nil {
		t.Fatal(err)
	}
	if al := res.Alignment; math.Abs(al.Rotation-8) > 1.5 || al.IoUAfter < 0.9 {
		t.Fatalf("rotation alignment %+v", al)
	}
}

func TestCompareMissingShape(t *testing.T) {
	ref := paint(300, 200, white, append(logo(0, 0), shape{x: 230, y: 130, w: 40, h: 40, ellipse: true, c: grn})...)
	r := cmp(t, paint(300, 200, white, logo(0, 0)...), ref, nil)
	if r.Missing < 0.1 || r.Extra != 0 || r.IoU >= 1 {
		t.Fatalf("missing: %+v", r)
	}
	if len(r.Regions) != 1 || r.Regions[0].Kind != "missing" {
		t.Fatalf("regions: %+v", r.Regions)
	}
	g := r.Regions[0]
	if math.Abs(g.Box.X-230) > 3 || math.Abs(g.Box.Y-130) > 3 || math.Abs(g.Box.Width-40) > 4 || g.Color != "#1ea046" {
		t.Fatalf("region: %+v", g)
	}
	if r.Alignment.Significant {
		t.Fatalf("a missing shape is not an offset: %+v", r.Alignment)
	}
}

func TestCompareExtraShapeAndNodes(t *testing.T) {
	drawn := paint(300, 200, white, append(logo(0, 0), shape{x: 30, y: 140, w: 70, h: 40, c: grn})...)
	nodes := []NodeBox{
		{ID: "disc", Type: "ellipse", Ellipse: true, Corners: box(40, 40, 60, 60)},
		{ID: "bar", Type: "rect", Corners: box(130, 50, 80, 50)},
		{ID: "stray", Name: "Stray", Type: "rect", Corners: box(30, 140, 70, 40)},
	}
	r := cmp(t, drawn, paint(300, 200, white, logo(0, 0)...), nodes)
	if r.Extra < 0.1 || r.Missing != 0 {
		t.Fatalf("extra: %+v", r)
	}
	if len(r.Regions) != 1 || r.Regions[0].Kind != "extra" {
		t.Fatalf("regions: %+v", r.Regions)
	}
	if len(r.Nodes) != 1 || r.Nodes[0].ID != "stray" || r.Nodes[0].OnReference > 0.05 {
		t.Fatalf("nodes: %+v", r.Nodes)
	}
}

func box(x, y, w, h float64) [4]Point {
	return [4]Point{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}
}

func TestCompareNodeSuggestedMove(t *testing.T) {
	drawn := paint(300, 200, white, shape{x: 40, y: 40, w: 60, h: 60, ellipse: true, c: red}, shape{x: 150, y: 70, w: 80, h: 50, c: navy})
	ref := paint(300, 200, white, shape{x: 40, y: 40, w: 60, h: 60, ellipse: true, c: red}, shape{x: 175, y: 60, w: 80, h: 50, c: navy})
	r := cmp(t, drawn, ref, []NodeBox{
		{ID: "disc", Type: "ellipse", Ellipse: true, Corners: box(40, 40, 60, 60)},
		{ID: "bar", Type: "rect", Corners: box(150, 70, 80, 50)},
	})
	if len(r.Nodes) != 1 || r.Nodes[0].ID != "bar" {
		t.Fatalf("nodes: %+v", r.Nodes)
	}
	mv := r.Nodes[0].SuggestedMove
	if mv == nil || math.Abs(mv.DX-25) > 2 || math.Abs(mv.DY+10) > 2 {
		t.Fatalf("move: %+v", mv)
	}
}

func TestCompareColorSwapped(t *testing.T) {
	ref := paint(300, 200, white, logo(0, 0)...)
	// same geometry, the disc is green instead of red
	drawn := paint(300, 200, white,
		shape{x: 40, y: 40, w: 60, h: 60, ellipse: true, c: grn},
		shape{x: 130, y: 50, w: 80, h: 50, c: navy},
	)
	r := cmp(t, drawn, ref, nil)
	if r.IoU < 0.99 {
		t.Fatalf("same shapes: iou %v", r.IoU)
	}
	if r.Color.DeltaE < 10 || r.Color.PixelDeltaE < 10 || r.Color.Score > 0.7 {
		t.Fatalf("colors: %+v", r.Color)
	}
	if len(r.Color.Unmatched) == 0 || r.Color.Unmatched[0].Color != "#1ea046" {
		t.Fatalf("unmatched: %+v", r.Color.Unmatched)
	}
	// both colors exist in both images, in swapped places: only the positional score sees it
	swapped := paint(300, 200, white,
		shape{x: 40, y: 40, w: 60, h: 60, ellipse: true, c: navy},
		shape{x: 130, y: 50, w: 80, h: 50, c: red},
	)
	s := cmp(t, swapped, ref, nil)
	if s.Color.DeltaE > 1 || s.Color.PixelDeltaE < 20 || s.Color.Score > 0.4 {
		t.Fatalf("swapped: %+v", s.Color)
	}
}

func TestCompareTransparentReference(t *testing.T) {
	ref := paint(300, 200, color.NRGBA{}, logo(0, 0)...)
	// a PNG with a transparent background and the same two shapes
	for i := 3; i < len(ref.Pix); i += 4 {
		if ref.Pix[i] == 0 {
			ref.Pix[i-3], ref.Pix[i-2], ref.Pix[i-1] = 0, 0, 0
		}
	}
	r := cmp(t, paint(300, 200, white, logo(0, 0)...), ref, nil)
	if r.IoU < 0.97 || r.Background.Reference != "transparent" || r.Background.Drawn != "#ffffff" {
		t.Fatalf("transparent ref: %+v bg %+v", r.IoU, r.Background)
	}
	// and the reverse: a transparent frame render against an opaque reference
	r = cmp(t, paint(300, 200, color.NRGBA{}, logo(0, 0)...), paint(300, 200, white, logo(0, 0)...), nil)
	if r.IoU < 0.97 {
		t.Fatalf("transparent drawing: %v", r.IoU)
	}
}

func TestCompareFitsReferenceIntoFrame(t *testing.T) {
	// a 100x50 reference fitted into a 300x300 frame (scale 3, centered): the frame render has the
	// same picture at 300 wide, 150 tall, from y=75
	small := paint(100, 50, white, shape{x: 10, y: 10, w: 30, h: 30, ellipse: true, c: red})
	big := paint(300, 300, white, shape{x: 30, y: 75 + 30, w: 90, h: 90, ellipse: true, c: red})
	res, err := Compare(CompareInput{Drawn: big, Ref: small, FrameW: 300, FrameH: 300, Placed: Rect{X: 0, Y: 75, Width: 300, Height: 150}})
	if err != nil {
		t.Fatal(err)
	}
	if res.IoU < 0.9 {
		t.Fatalf("fitted: iou %v", res.IoU)
	}
}

func TestCompareDeterministicAndFast(t *testing.T) {
	shapes := []shape{}
	for i := range 12 {
		shapes = append(shapes, shape{x: 60 + float64(i%4)*270, y: 80 + float64(i/4)*250, w: 200, h: 160, ellipse: i%2 == 0, c: []color.NRGBA{red, navy, grn}[i%3]})
	}
	ref := paint(1200, 900, white, shapes...)
	for i := range shapes {
		shapes[i].x += 9
		shapes[i].y -= 5
	}
	drawn := paint(1200, 900, white, shapes...)
	var nodes []NodeBox
	for i, s := range shapes {
		nodes = append(nodes, NodeBox{ID: string(rune('a' + i)), Type: "rect", Ellipse: s.ellipse, Corners: box(s.x, s.y, s.w, s.h)})
	}
	start := time.Now()
	a := cmp(t, drawn, ref, nodes)
	took := time.Since(start)
	b := cmp(t, drawn, ref, nodes)
	if !reflect.DeepEqual(a, b) {
		t.Fatal("two runs differ")
	}
	if math.Abs(a.Alignment.DX+9) > 1.5 || math.Abs(a.Alignment.DY-5) > 1.5 {
		t.Fatalf("alignment: %+v", a.Alignment)
	}
	t.Logf("1200x900 compare: %v", took)
	if took > 2*time.Second {
		t.Fatalf("too slow: %v", took)
	}
}

func TestCompareErrors(t *testing.T) {
	if _, err := Compare(CompareInput{}); err == nil {
		t.Fatal("expected an error")
	}
	flat := paint(50, 50, white)
	r := cmp(t, flat, flat, nil)
	if len(r.Warnings) != 2 || r.Alignment != nil {
		t.Fatalf("flat: %+v", r.Warnings)
	}
}
