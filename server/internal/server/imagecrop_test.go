package server

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func logoJPEG(t *testing.T) []byte {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(logoPNG(t)))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func rasterOf(t *testing.T, data []byte) rasterInfo {
	t.Helper()
	info, err := sniffRaster(data)
	if err != nil {
		t.Fatal(err)
	}
	return info
}

func near(c color.Color, r, g, b, tol int) bool {
	cr, cg, cb, _ := c.RGBA()
	d := func(a uint32, want int) bool { v := int(a >> 8); return v >= want-tol && v <= want+tol }
	return d(cr, r) && d(cg, g) && d(cb, b)
}

func TestCropRasterPNG(t *testing.T) {
	out, warn, err := cropRaster(rasterOf(t, logoPNG(t)), image.Rect(100, 20, 200, 80))
	if err != nil || len(warn) != 0 {
		t.Fatalf("crop: %v %v", err, warn)
	}
	if out.mime != "image/png" || out.width != 100 || out.height != 60 {
		t.Fatalf("got %s %dx%d", out.mime, out.width, out.height)
	}
	img, err := png.Decode(bytes.NewReader(out.data))
	if err != nil {
		t.Fatal(err)
	}
	if !near(img.At(10, 10), 20, 40, 110, 0) || !near(img.At(5, 5), 255, 255, 255, 0) {
		t.Fatalf("pixels: %v %v", img.At(10, 10), img.At(5, 5))
	}
}

func TestCropRasterJPEGStaysJPEG(t *testing.T) {
	out, _, err := cropRaster(rasterOf(t, logoJPEG(t)), image.Rect(100, 20, 200, 80))
	if err != nil {
		t.Fatal(err)
	}
	if out.mime != "image/jpeg" || out.width != 100 || out.height != 60 {
		t.Fatalf("got %s %dx%d", out.mime, out.width, out.height)
	}
	img, err := jpeg.Decode(bytes.NewReader(out.data))
	if err != nil {
		t.Fatal(err)
	}
	if !near(img.At(30, 30), 20, 40, 110, 12) {
		t.Fatalf("pixel: %v", img.At(30, 30))
	}
}

func TestCropRasterClampsAndRefusesEmpty(t *testing.T) {
	info := rasterOf(t, logoPNG(t))
	out, warn, err := cropRaster(info, image.Rect(150, 50, 350, 250))
	if err != nil || out.width != 50 || out.height != 50 {
		t.Fatalf("clamp: %v %dx%d", err, out.width, out.height)
	}
	if len(warn) != 1 || !strings.Contains(warn[0], "clamped") {
		t.Fatalf("warnings: %v", warn)
	}
	for _, box := range []image.Rectangle{image.Rect(300, 0, 310, 10), image.Rect(0, 100, 10, 110), image.Rect(-20, -20, 0, 0)} {
		if _, _, err := cropRaster(info, box); err == nil || !strings.Contains(err.Error(), "outside the image") {
			t.Fatalf("%v: %v", box, err)
		}
	}
}

func TestCropRasterRefusesWhatCannotBeDecoded(t *testing.T) {
	if _, _, err := cropRaster(rasterInfo{mime: "image/avif", width: 10, height: 10}, image.Rect(0, 0, 5, 5)); err == nil {
		t.Fatal("AVIF must be refused")
	}
}

func TestImportImageCrop(t *testing.T) {
	m, s, _ := importImageSetup(t)
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG(t))
	r := m.CallTool(t.Context(), "import_image", obj("src", src, "crop", obj("x", 100.0, "y", 20.0, "width", 150.0, "height", 60.0), "x", 7.0, "y", 9.0, "place", "none"), true)
	if r.Bool("isError") {
		t.Fatal(callTextJoin(r))
	}
	sc := r.Obj("structuredContent")
	if sc.Num("naturalWidth") != 100 || sc.Num("naturalHeight") != 60 || sc.Num("width") != 100 || sc.Str("format") != "png" {
		t.Fatalf("result: %s", jsonv.Stringify(sc, ""))
	}
	if w := sc.Strings("warnings"); len(w) != 1 || !strings.Contains(w[0], "clamped") {
		t.Fatalf("warnings: %v", w)
	}
	n := lastNode(t, s)
	if n.Num("x") != 7 || n.Num("y") != 9 || n.Num("width") != 100 || n.Num("height") != 60 || n.Str("src") == src {
		t.Fatalf("node: %s", jsonv.Stringify(n, ""))
	}
	r = m.CallTool(t.Context(), "import_image", obj("src", src, "crop", obj("x", 100.0, "y", 20.0, "width", 100.0, "height", 60.0), "width", 50.0), true)
	if r.Bool("isError") {
		t.Fatal(callTextJoin(r))
	}
	if n := lastNode(t, s); n.Num("width") != 50 || n.Num("height") != 30 {
		t.Fatalf("scaled crop: %s", jsonv.Stringify(n, ""))
	}
	if out, isErr := callText(t, m, "import_image", obj("src", src, "crop", obj("x", 500.0, "y", 0.0, "width", 10.0, "height", 10.0))); !isErr || !strings.Contains(out, "outside the image") {
		t.Fatalf("empty crop: %v %s", isErr, out)
	}
	if _, isErr := callText(t, m, "import_image", obj("src", src, "crop", obj("x", 0.0, "y", 0.0, "width", 0.0, "height", 10.0))); !isErr {
		t.Fatal("a zero-width crop must be refused")
	}
}

func TestPlaceReferenceCrop(t *testing.T) {
	m, s, _ := resizeSetup(t)
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "frame", "id", "screen", "name", "Screen", "width", 400.0, "height", 400.0))}, "test", "frame"); err != nil {
		t.Fatal(err)
	}
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG(t))
	r := m.CallTool(t.Context(), "place_reference", obj("src", src, "frameId", "screen", "crop", obj("x", 100.0, "y", 20.0, "width", 100.0, "height", 60.0)), true)
	if r.Bool("isError") {
		t.Fatal(callTextJoin(r))
	}
	sc := r.Obj("structuredContent")
	if sc.Num("width") != 400 || sc.Num("height") != 240 || sc.Num("y") != 80 {
		t.Fatalf("placement: %s", jsonv.Stringify(sc, ""))
	}
	if n := core.GetNode(s.Doc(), sc.Str("id")); n == nil || n.Str("src") == src {
		t.Fatal("the node must hold the cropped pixels")
	}
}

func TestCropTooLargeAfterEncoding(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 1200, 1200))
	seed := uint32(1)
	for i := range img.Pix {
		seed = seed*1664525 + 1013904223
		img.Pix[i] = byte(seed >> 24)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	info := rasterInfo{mime: "image/png", width: 1200, height: 1200, data: buf.Bytes()}
	if _, _, err := cropRaster(info, image.Rect(0, 0, 1200, 1200)); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("expected a size error, got %v", err)
	}
}
