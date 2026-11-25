package vision

import (
	"image"
	"image/color"
	"math"
	"testing"
	"time"
)

var (
	fitNavy  = color.NRGBA{20, 40, 110, 255}
	fitWhite = color.NRGBA{255, 255, 255, 255}
)

func paintFn(w, h int, in func(x, y float64) bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	fillNRGBA(img, fitWhite)
	for y := range h {
		for x := range w {
			if in(float64(x)+0.5, float64(y)+0.5) {
				img.SetNRGBA(x, y, fitNavy)
			}
		}
	}
	return img
}

func rotEllipse(cx, cy, rx, ry, deg float64) func(x, y float64) bool {
	s, c := math.Sin(deg*math.Pi/180), math.Cos(deg*math.Pi/180)
	return func(x, y float64) bool {
		dx, dy := x-cx, y-cy
		u, v := dx*c+dy*s, -dx*s+dy*c
		return (u/rx)*(u/rx)+(v/ry)*(v/ry) <= 1
	}
}

func polyTest(pts [][2]float64) func(x, y float64) bool {
	return func(x, y float64) bool {
		in := false
		for i, j := 0, len(pts)-1; i < len(pts); j, i = i, i+1 {
			if (pts[i][1] > y) != (pts[j][1] > y) && x < (pts[j][0]-pts[i][0])*(y-pts[i][1])/(pts[j][1]-pts[i][1])+pts[i][0] {
				in = !in
			}
		}
		return in
	}
}

func navyRGB() *[3]uint8 { return &[3]uint8{20, 40, 110} }

func fitIn(w, h int, ref image.Image, nodes ...FitNode) FitInput {
	return FitInput{
		Ref: ref, Fixed: paintFn(w, h, func(x, y float64) bool { return false }),
		FrameW: float64(w), FrameH: float64(h), Placed: Rect{Width: float64(w), Height: float64(h)},
		Nodes: nodes,
	}
}

func TestFitRectOffsetAndSmall(t *testing.T) {
	ref := paintFn(300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	n := FitNode{ID: "r", Kind: "rect", X: 115, Y: 75, W: 108, H: 72, Fill: true, FillRGB: navyRGB(), Free: FitFree{Position: true, Size: true}}
	res, err := FitReference(fitIn(300, 200, ref, n))
	if err != nil {
		t.Fatal(err)
	}
	if res.IoUBefore > 0.7 || res.IoUAfter < 0.97 {
		t.Fatalf("iou %.3f -> %.3f", res.IoUBefore, res.IoUAfter)
	}
	r := res.Nodes[0]
	if math.Abs(r.X-100) > 1.5 || math.Abs(r.Y-60) > 1.5 || math.Abs(r.W-120) > 2 || math.Abs(r.H-80) > 2 {
		t.Fatalf("result %+v", r)
	}
	if !r.Changed["position"] || !r.Changed["size"] || r.Changed["rotation"] {
		t.Fatalf("changed %v", r.Changed)
	}
}

func TestFitEllipseRotation(t *testing.T) {
	ref := paintFn(300, 200, rotEllipse(150, 100, 80, 28, 35))
	n := FitNode{ID: "e", Kind: "ellipse", X: 70, Y: 72, W: 160, H: 56, Rot: -20, Fill: true, FillRGB: navyRGB(), Free: FitFree{Rotation: true}}
	res, err := FitReference(fitIn(300, 200, ref, n))
	if err != nil {
		t.Fatal(err)
	}
	r := res.Nodes[0]
	if res.IoUAfter < 0.97 || math.Abs(r.Rot-35) > 3 {
		t.Fatalf("iou %.3f -> %.3f, rotation %.1f", res.IoUBefore, res.IoUAfter, r.Rot)
	}
	if r.X != 70 || r.W != 160 {
		t.Fatalf("moved something that was not free: %+v", r)
	}
}

func TestFitRotationStaysInRange(t *testing.T) {
	ref := paintFn(300, 200, rotEllipse(150, 100, 80, 28, 170))
	n := FitNode{ID: "e", Kind: "ellipse", X: 70, Y: 72, W: 160, H: 56, Rot: -170, Fill: true, FillRGB: navyRGB(), Free: FitFree{Rotation: true}}
	res, _ := FitReference(fitIn(300, 200, ref, n))
	if r := res.Nodes[0].Rot; r < -180 || r > 180 {
		t.Fatalf("rotation %v out of range", r)
	}
	if res.IoUAfter < 0.97 {
		t.Fatalf("iou %.3f", res.IoUAfter)
	}
}

func TestFitPathAnchorFixesNotch(t *testing.T) {
	sq := [][2]float64{{100, 50}, {200, 50}, {200, 150}, {100, 150}}
	ref := paintFn(300, 200, polyTest(sq))
	n := FitNode{ID: "p", Kind: "path", X: 100, Y: 50, W: 100, H: 100, Fill: true, FillRGB: navyRGB(),
		Path: []FitSub{{Closed: true, Anchors: []FitAnchor{{X: 0, Y: 0}, {X: 100, Y: 0}, {X: 55, Y: 55}, {X: 0, Y: 100}}}},
		Free: FitFree{PathPoints: true}}
	res, err := FitReference(fitIn(300, 200, ref, n))
	if err != nil {
		t.Fatal(err)
	}
	r := res.Nodes[0]
	if res.IoUBefore > 0.9 || res.IoUAfter < 0.97 {
		t.Fatalf("iou %.3f -> %.3f", res.IoUBefore, res.IoUAfter)
	}
	if len(r.Moves) != 1 || r.Moves[0].Index != 2 {
		t.Fatalf("moves %+v (only the notch anchor should move)", r.Moves)
	}
	m := r.Moves[0]
	if math.Abs(m.DX-45) > 3 || math.Abs(m.DY-45) > 3 {
		t.Fatalf("anchor moved by (%.1f,%.1f)", m.DX, m.DY)
	}
	if len(r.Path) != 1 || len(r.Path[0].Anchors) != 4 || math.Abs(r.Path[0].Anchors[2].X-100) > 3 {
		t.Fatalf("path %+v", r.Path)
	}
}

func TestFitRadius(t *testing.T) {
	const r = 30.0
	round := func(x, y float64) bool {
		if x < 60 || x >= 240 || y < 40 || y >= 160 {
			return false
		}
		cx, cy := x, y
		switch {
		case x < 60+r:
			cx = 60 + r
		case x > 240-r:
			cx = 240 - r
		}
		switch {
		case y < 40+r:
			cy = 40 + r
		case y > 160-r:
			cy = 160 - r
		}
		return math.Hypot(x-cx, y-cy) <= r
	}
	ref := paintFn(300, 200, round)
	n := FitNode{ID: "r", Kind: "rect", X: 60, Y: 40, W: 180, H: 120, Fill: true, FillRGB: navyRGB(), Radius: [4]float64{4, 4, 4, 4}, Free: FitFree{Radius: true}}
	res, _ := FitReference(fitIn(300, 200, ref, n))
	if got := res.Nodes[0].Radius[0]; math.Abs(got-r) > 4 || !res.Nodes[0].Changed["radius"] {
		t.Fatalf("radius %v (iou %.3f -> %.3f)", got, res.IoUBefore, res.IoUAfter)
	}
}

func TestFitSkipsInvisibleAndKeepsOthers(t *testing.T) {
	ref := paintFn(300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	bgPaint := &[3]uint8{255, 255, 255}
	nodes := []FitNode{
		{ID: "ghost", Kind: "rect", X: 10, Y: 10, W: 20, H: 20, Fill: true, FillRGB: bgPaint, Free: FitFree{Position: true}},
		{ID: "r", Kind: "rect", X: 110, Y: 70, W: 120, H: 80, Fill: true, FillRGB: navyRGB(), Free: FitFree{Position: true}},
	}
	res, err := FitReference(fitIn(300, 200, ref, nodes...))
	if err != nil {
		t.Fatal(err)
	}
	if res.Nodes[0].Skipped == "" || res.Nodes[0].X != 10 {
		t.Fatalf("ghost: %+v", res.Nodes[0])
	}
	if res.Nodes[1].Skipped != "" || res.IoUAfter < 0.97 {
		t.Fatalf("rect: %+v iou %.3f", res.Nodes[1], res.IoUAfter)
	}
}

func TestFitTwentyNodesWithinBudget(t *testing.T) {
	const w, h = 1000, 700
	type box struct{ x, y, w, h float64 }
	var boxes []box
	for i := range 20 {
		boxes = append(boxes, box{float64(30 + (i%5)*190), float64(30 + (i/5)*165), 150, 120})
	}
	ref := paintFn(w, h, func(x, y float64) bool {
		for _, b := range boxes {
			if x >= b.x && x < b.x+b.w && y >= b.y && y < b.y+b.h {
				return true
			}
		}
		return false
	})
	var nodes []FitNode
	for i, b := range boxes {
		d := float64(i%5)*3 - 6
		nodes = append(nodes, FitNode{ID: "n" + string(rune('a'+i)), Kind: "rect", X: b.x + d + 8, Y: b.y - d - 6, W: b.w * 0.93, H: b.h * 1.06, Fill: true, FillRGB: navyRGB(), Free: FitFree{Position: true, Size: true}})
	}
	start := time.Now()
	res, err := FitReference(fitIn(w, h, ref, nodes...))
	if err != nil {
		t.Fatal(err)
	}
	if el := time.Since(start); el > 5*time.Second {
		t.Fatalf("took %v", el)
	}
	if res.IoUAfter < 0.95 || res.IoUAfter <= res.IoUBefore {
		t.Fatalf("iou %.3f -> %.3f", res.IoUBefore, res.IoUAfter)
	}
	t.Logf("20 nodes: iou %.3f -> %.3f in %d rounds, %v", res.IoUBefore, res.IoUAfter, res.Rounds, time.Since(start))
}

func TestFitDeterministicAndErrors(t *testing.T) {
	ref := paintFn(300, 200, rotEllipse(150, 100, 80, 28, 35))
	n := FitNode{ID: "e", Kind: "ellipse", X: 80, Y: 80, W: 150, H: 50, Rot: 10, Fill: true, FillRGB: navyRGB(), Free: FitFree{Position: true, Size: true, Rotation: true}}
	a, _ := FitReference(fitIn(300, 200, ref, n))
	b, _ := FitReference(fitIn(300, 200, ref, n))
	if a.IoUAfter != b.IoUAfter || a.Nodes[0].X != b.Nodes[0].X || a.Nodes[0].Rot != b.Nodes[0].Rot {
		t.Fatalf("not deterministic: %+v vs %+v", a.Nodes[0], b.Nodes[0])
	}
	if a.IoUAfter <= a.IoUBefore {
		t.Fatalf("iou %.3f -> %.3f", a.IoUBefore, a.IoUAfter)
	}
	if _, err := FitReference(FitInput{}); err == nil {
		t.Fatal("expected an error")
	}
	flat := paintFn(300, 200, func(x, y float64) bool { return false })
	if _, err := FitReference(fitIn(300, 200, flat, n)); err == nil {
		t.Fatal("a flat reference must be an error")
	}
	res, _ := FitReference(FitInput{Ref: ref, Fixed: flat, FrameW: 300, FrameH: 200, Placed: Rect{Width: 300, Height: 200}, Nodes: []FitNode{{ID: "t", Kind: "text"}}})
	if res.Nodes[0].Skipped == "" {
		t.Fatal("a text node cannot be fitted")
	}
}

func TestFitRotatedRectEdges(t *testing.T) {
	cx, cy, hw, hh := 150.0, 100.0, 60.0, 30.0
	s, c := math.Sin(30*math.Pi/180), math.Cos(30*math.Pi/180)
	var pts [][2]float64
	for _, p := range [][2]float64{{-hw, -hh}, {hw, -hh}, {hw, hh}, {-hw, hh}} {
		pts = append(pts, [2]float64{cx + p[0]*c - p[1]*s, cy + p[0]*s + p[1]*c})
	}
	ref := paintFn(300, 200, polyTest(pts))
	n := FitNode{ID: "r", Kind: "rect", X: 100, Y: 80, W: 100, H: 50, Rot: 30, Fill: true, FillRGB: navyRGB(), Free: FitFree{Position: true, Size: true}}
	res, err := FitReference(fitIn(300, 200, ref, n))
	if err != nil {
		t.Fatal(err)
	}
	if res.IoUAfter < 0.96 || res.Nodes[0].Rot != 30 {
		t.Fatalf("iou %.3f -> %.3f, node %+v", res.IoUBefore, res.IoUAfter, res.Nodes[0])
	}
}

func TestParseCSSColor(t *testing.T) {
	for in, want := range map[string][3]uint8{"#fff": {255, 255, 255}, "#14286e": {20, 40, 110}, "#14286e80": {20, 40, 110}, "rgb(1, 2, 3)": {1, 2, 3}, "rgba(1,2,3,0.5)": {1, 2, 3}} {
		got, _, ok := ParseCSSColor(in)
		if !ok || got != want {
			t.Fatalf("%s: %v %v", in, got, ok)
		}
	}
	if _, a, _ := ParseCSSColor("#00000080"); math.Abs(a-0.5) > 0.01 {
		t.Fatalf("alpha %v", a)
	}
	for _, bad := range []string{"", "$primary", "linear-gradient(red, blue)", "#12", "#gggggg"} {
		if _, _, ok := ParseCSSColor(bad); ok {
			t.Fatalf("%q should not parse", bad)
		}
	}
}
