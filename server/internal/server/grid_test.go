package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func TestAutoGridStep(t *testing.T) {
	cases := []struct{ extent, want float64 }{
		{400, 50}, {800, 50}, {900, 100}, {1600, 100}, {1700, 200}, {3200, 200},
		{100, 10}, {40, 5}, {10000, 1000},
	}
	for _, c := range cases {
		if got := autoGridStep(c.extent); got != c.want {
			t.Errorf("autoGridStep(%v) = %v, want %v", c.extent, got, c.want)
		}
		if n := c.extent / autoGridStep(c.extent); n > 16.0001 {
			t.Errorf("extent %v: %v lines (> 16)", c.extent, n)
		}
	}
}

func TestGridValuesAndPixels(t *testing.T) {
	if got := gridValues(0, 200, 50); len(got) != 4 || got[0] != 0 || got[3] != 150 {
		t.Fatalf("0..200 step 50 = %v", got)
	}
	got := gridValues(120, 100, 50)
	if len(got) != 2 || got[0] != 150 || got[1] != 200 {
		t.Fatalf("120..220 step 50 = %v", got)
	}
	if px := gridPixel(150, 120, 2); px != 60 {
		t.Fatalf("pixel of 150 in region at 120, scale 2 = %d", px)
	}
	if got := gridValues(0, 1, 0.25); got[3] != 0.75 {
		t.Fatalf("fractional step = %v", got)
	}
	if formatGridValue(0.75) != "0.75" || formatGridValue(150) != "150" {
		t.Fatal("label format")
	}
}

func TestCropRect(t *testing.T) {
	rect, used, err := cropRect(Region{X: 100, Y: 50, W: 80, H: 40}, 400, 200, 2)
	if err != nil {
		t.Fatal(err)
	}
	if rect != image.Rect(200, 100, 360, 180) {
		t.Fatalf("rect = %v", rect)
	}
	if used != (Region{100, 50, 80, 40}) {
		t.Fatalf("used = %v", used)
	}
	rect, used, err = cropRect(Region{X: -20, Y: 150, W: 100, H: 100}, 400, 200, 1)
	if err != nil || rect != image.Rect(0, 150, 80, 200) || used != (Region{0, 150, 80, 50}) {
		t.Fatalf("clamped: %v %v %v", rect, used, err)
	}
	if _, _, err := cropRect(Region{X: 500, Y: 0, W: 10, H: 10}, 400, 200, 1); err == nil {
		t.Fatal("expected an error for a region outside the frame")
	}
}

func TestParseGridArg(t *testing.T) {
	g, err := parseGridArg(obj())
	if err != nil || g != nil {
		t.Fatalf("absent: %v %v", g, err)
	}
	g, err = parseGridArg(obj("grid", false))
	if err != nil || g != nil {
		t.Fatalf("false: %v %v", g, err)
	}
	g, err = parseGridArg(obj("grid", true))
	if err != nil || g == nil || g.Step != 0 || !g.Labels {
		t.Fatalf("true: %+v %v", g, err)
	}
	g, err = parseGridArg(obj("grid", obj("step", 25.0, "labels", false, "color", "#0f0")))
	if err != nil || g.Step != 25 || g.Labels || g.Color != (color.NRGBA{G: 0xff, A: 0xff}) {
		t.Fatalf("object: %+v %v", g, err)
	}
	if _, err := parseGridArg(obj("grid", obj("color", "green"))); err == nil {
		t.Fatal("expected a color error")
	}
}

func TestAnnotateShotGridAndRegion(t *testing.T) {
	src := solidPNG(t, 800, 400, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	out, w, h, step, region, err := annotateShot(src, 400, 200, 2, nil, &GridSpec{Labels: true, Color: defaultGridColor})
	if err != nil {
		t.Fatal(err)
	}
	if w != 800 || h != 400 || step != 50 || region != nil {
		t.Fatalf("size %d×%d step %v region %v", w, h, step, region)
	}
	img, _ := png.Decode(bytes.NewReader(out))
	if c := color.NRGBAModel.Convert(img.At(100, 300)).(color.NRGBA); c == (color.NRGBA{255, 255, 255, 255}) {
		t.Fatal("no vertical line at frame x=50")
	}
	if c := color.NRGBAModel.Convert(img.At(300, 100)).(color.NRGBA); c == (color.NRGBA{255, 255, 255, 255}) {
		t.Fatal("no horizontal line at frame y=50")
	}
	if c := color.NRGBAModel.Convert(img.At(130, 330)).(color.NRGBA); c != (color.NRGBA{255, 255, 255, 255}) {
		t.Fatalf("pixel between lines changed: %v", c)
	}
	if c := color.NRGBAModel.Convert(img.At(40, 4)).(color.NRGBA); c.R > 100 {
		t.Fatalf("ruler band not dark: %v", c)
	}

	out, w, h, step, region, err = annotateShot(src, 400, 200, 2, &Region{100, 50, 80, 40}, &GridSpec{Labels: true, Color: defaultGridColor})
	if err != nil {
		t.Fatal(err)
	}
	if w != 160 || h != 80 || step != 5 || region == nil || *region != (Region{100, 50, 80, 40}) {
		t.Fatalf("size %d×%d step %v region %v", w, h, step, region)
	}
	img, _ = png.Decode(bytes.NewReader(out))
	if img.Bounds().Dx() != 160 || img.Bounds().Dy() != 80 {
		t.Fatalf("decoded %v", img.Bounds())
	}
	if c := color.NRGBAModel.Convert(img.At(10, 70)).(color.NRGBA); c == (color.NRGBA{255, 255, 255, 255}) {
		t.Fatal("no line at frame x=105 inside the crop")
	}

	out, w, h, step, _, err = annotateShot(src, 400, 200, 2, &Region{0, 0, 10, 10}, nil)
	if err != nil || w != 20 || h != 20 || step != 0 {
		t.Fatalf("crop only: %d×%d step %v %v", w, h, step, err)
	}
	img, _ = png.Decode(bytes.NewReader(out))
	if c := color.NRGBAModel.Convert(img.At(5, 5)).(color.NRGBA); c != (color.NRGBA{255, 255, 255, 255}) {
		t.Fatalf("crop-only pixel changed: %v", c)
	}
}

type scaledShot struct{ fw, fh float64 }

func (s scaledShot) ScreenshotMode(_ context.Context, _ *core.Document, _ string, scale float64, _ string) ([]byte, int, int, error) {
	w, h := int(math.Round(s.fw*scale)), int(math.Round(s.fh*scale))
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), w, h, nil
}

func TestRenderScreenshotGridRegion(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", scaledShot{400, 200})
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "f", "width", 400.0, "height", 200.0, "fill", "#ffffff"),
	})); isErr {
		t.Fatal(out)
	}
	size := func(res ToolResult) (int, int) {
		for _, c := range res.Arr("content") {
			if o, ok := c.(*jsonv.Object); ok && o.Str("type") == "image" {
				raw, err := base64.StdEncoding.DecodeString(o.Str("data"))
				if err != nil {
					t.Fatal(err)
				}
				cfg, err := png.DecodeConfig(bytes.NewReader(raw))
				if err != nil {
					t.Fatal(err)
				}
				return cfg.Width, cfg.Height
			}
		}
		t.Fatal("no image")
		return 0, 0
	}
	args := obj("rootId", "f", "scale", 2.0, "grid", true, "region", obj("x", 100.0, "y", 50.0, "width", 80.0, "height", 40.0))
	res := m.CallTool(context.Background(), "render_screenshot", args, true)
	if res.Bool("isError") {
		t.Fatal(jsonv.Stringify(res, ""))
	}
	if w, h := size(res); w != 160 || h != 80 {
		t.Fatalf("size %d×%d", w, h)
	}
	sc := res.Obj("structuredContent")
	if sc.Obj("grid").Num("step") != 5 || sc.Obj("region").Num("width") != 80 || sc.Obj("region").Num("x") != 100 {
		t.Fatalf("structured: %s", jsonv.Stringify(sc, ""))
	}
	if txt := res.Arr("content")[1].(*jsonv.Object).Str("text"); !strings.Contains(txt, "grid step 5") || !strings.Contains(txt, "region x=100 y=50 80×40") {
		t.Fatalf("text: %q", txt)
	}
	res = m.CallTool(context.Background(), "render_screenshot", obj("rootId", "f"), true)
	if w, h := size(res); w != 400 || h != 200 {
		t.Fatalf("default size %d×%d", w, h)
	}
	if sc := res.Obj("structuredContent"); sc.Obj("grid") != nil || sc.Obj("region") != nil {
		t.Fatalf("default structured has extras: %s", jsonv.Stringify(sc, ""))
	}
}
