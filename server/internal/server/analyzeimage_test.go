package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

// logoPNG is a 200x100 image: white background, a red disc (center 50,50, r 30) and a blue
// rectangle (x 110..180, y 30..70).
func logoPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 200, 100))
	for y := range 100 {
		for x := range 200 {
			c := color.NRGBA{255, 255, 255, 255}
			if dx, dy := x-50, y-50; dx*dx+dy*dy <= 900 {
				c = color.NRGBA{220, 30, 40, 255}
			}
			if x >= 110 && x < 180 && y >= 30 && y < 70 {
				c = color.NRGBA{20, 40, 110, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func analyzeCall(t *testing.T, m *MCP, args *jsonv.Object) (*jsonv.Object, string, bool) {
	t.Helper()
	r := m.CallTool(context.Background(), "analyze_image", args, true)
	var text strings.Builder
	for _, c := range r.Arr("content") {
		text.WriteString(c.(*jsonv.Object).Str("text"))
	}
	return r.Obj("structuredContent"), text.String(), r.Bool("isError")
}

func blobOfKind(t *testing.T, sc *jsonv.Object, kind string) *jsonv.Object {
	t.Helper()
	for _, b := range sc.Arr("blobs") {
		bo := b.(*jsonv.Object)
		if bo.Obj("fit").Str("kind") == kind {
			return bo
		}
	}
	t.Fatalf("no %s blob", kind)
	return nil
}

func TestAnalyzeImageSources(t *testing.T) {
	m, s, dir := resizeSetup(t)
	data := logoPNG(t)
	if err := os.WriteFile(filepath.Join(dir, "logo-analyze.png"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(filepath.Join(dir, "logo-analyze.png")) })
	b64 := base64.StdEncoding.EncodeToString(data)
	for name, src := range map[string]string{
		"data url":   "data:image/png;base64," + b64,
		"raw base64": b64,
		"path":       "logo-analyze.png",
	} {
		t.Run(name, func(t *testing.T) {
			sc, text, isErr := analyzeCall(t, m, obj("src", src))
			if isErr {
				t.Fatal(text)
			}
			if int(sc.Obj("size").Num("width")) != 200 || sc.Obj("background").Str("color") != "#ffffff" {
				t.Fatalf("size/background: %s", text)
			}
			disc := blobOfKind(t, sc, "circle")
			node := disc.Obj("fit").Obj("node")
			if math.Abs(node.Num("width")-60) > 2 || math.Abs(node.Num("x")-20) > 1.5 || node.Str("fill") != "#dc1e28" {
				t.Fatalf("disc node: %s", jsonv.Stringify(node, ""))
			}
			rect := blobOfKind(t, sc, "rect")
			if rn := rect.Obj("fit").Obj("node"); math.Abs(rn.Num("width")-70) > 1.5 || math.Abs(rn.Num("height")-40) > 1.5 {
				t.Fatalf("rect node: %s", jsonv.Stringify(rn, ""))
			}
			if !strings.Contains(text, "palette:") || !strings.Contains(text, "#dc1e28") || !strings.Contains(text, "circle") {
				t.Fatalf("summary: %s", text)
			}
		})
	}

	t.Run("frame", func(t *testing.T) {
		sc, text, isErr := analyzeCall(t, m, obj("src", b64, "frame", obj("width", 800.0, "height", 800.0)))
		if isErr {
			t.Fatal(text)
		}
		// 200x100 fitted into 800x800: scale 4, centered vertically (offset y 200)
		placed := sc.Obj("placed")
		if placed.Num("width") != 800 || placed.Num("height") != 400 || placed.Num("y") != 200 {
			t.Fatalf("placed: %s", jsonv.Stringify(placed, ""))
		}
		node := blobOfKind(t, sc, "circle").Obj("fit").Obj("node")
		if math.Abs(node.Num("width")-240) > 6 || math.Abs(node.Num("y")-(200+80)) > 6 {
			t.Fatalf("framed node: %s", jsonv.Stringify(node, ""))
		}
	})

	t.Run("region", func(t *testing.T) {
		sc, text, isErr := analyzeCall(t, m, obj("src", b64, "region", obj("x", 100.0, "y", 0.0, "width", 100.0, "height", 100.0)))
		if isErr {
			t.Fatal(text)
		}
		if len(sc.Arr("blobs")) != 1 || blobOfKind(t, sc, "rect") == nil {
			t.Fatalf("region blobs: %s", text)
		}
		if math.Abs(blobOfKind(t, sc, "rect").Obj("bbox").Num("x")-110) > 1.5 {
			t.Fatalf("bbox stays in full-image coordinates: %s", text)
		}
	})

	t.Run("nodeId", func(t *testing.T) {
		out, isErr := callText(t, m, "import_image", obj("src", "data:image/png;base64,"+b64))
		if isErr {
			t.Fatal(out)
		}
		id := lastNode(t, s).Str("id")
		sc, text, isErr := analyzeCall(t, m, obj("nodeId", id))
		if isErr {
			t.Fatal(text)
		}
		if len(sc.Arr("blobs")) != 2 {
			t.Fatalf("blobs: %s", text)
		}
	})

	t.Run("limits", func(t *testing.T) {
		sc, _, isErr := analyzeCall(t, m, obj("src", b64, "maxBlobs", 1.0))
		if isErr || !sc.Bool("truncated") || len(sc.Arr("blobs")) != 1 || int(sc.Num("blobCount")) != 2 {
			t.Fatalf("truncation: %s", jsonv.Stringify(sc, ""))
		}
	})
}

func TestAnalyzeImageErrors(t *testing.T) {
	m, _, _ := resizeSetup(t)
	cases := []struct {
		name string
		args *jsonv.Object
		want string
	}{
		{"neither", obj(), "requires src"},
		{"both", obj("src", "pixel.png", "nodeId", "x"), "not both"},
		{"missing node", obj("nodeId", "nope"), "not found"},
		{"avif", obj("src", "pixel.avif"), "AVIF"},
		{"outside", obj("src", "/etc/passwd"), "outside the allowed"},
		{"http", obj("src", "https://example.com/a.png"), "not fetched"},
		{"region outside", obj("src", "pixel.png", "region", obj("x", 900.0, "y", 900.0, "width", 10.0, "height", 10.0)), "outside the image"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, text, isErr := analyzeCall(t, m, c.args)
			if !isErr || !strings.Contains(text, c.want) {
				t.Fatalf("isErr=%v text=%q want %q", isErr, text, c.want)
			}
		})
	}
	// a real photo-ish fixture decodes and analyzes without error
	sc, text, isErr := analyzeCall(t, m, obj("src", "pixel.jpg"))
	if isErr || len(sc.Arr("palette")) == 0 {
		t.Fatalf("jpeg: %s", text)
	}
	for _, f := range []string{"pixel.webp", "pixel.gif", "rotated.jpg"} {
		if _, text, isErr := analyzeCall(t, m, obj("src", f)); isErr {
			t.Fatalf("%s: %s", f, text)
		}
	}
}

func TestLooksLikeBase64(t *testing.T) {
	if looksLikeBase64("logo.png") || looksLikeBase64("/tmp/some/dir/"+strings.Repeat("a", 80)+".png") {
		t.Fatal("paths are not base64")
	}
	if !looksLikeBase64(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1, 2, 3}, 40))) {
		t.Fatal("base64 not recognized")
	}
}
