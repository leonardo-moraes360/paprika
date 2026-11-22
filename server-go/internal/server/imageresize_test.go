package server

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func resizeSetup(t *testing.T) (*MCP, *Store, string) {
	t.Helper()
	t.Setenv("PAPRIKA_CHROMIUM", "")
	dir, err := filepath.Abs(filepath.Join("testdata", "images"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(ImportDirsEnv, dir)
	s, _ := openTemp(t)
	return NewMCP(s, "agent:test", nil), s, dir
}

func parseToolJSON(t *testing.T, out string) *jsonv.Object {
	t.Helper()
	v, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatalf("json: %v (%s)", err, out)
	}
	o, ok := v.(*jsonv.Object)
	if !ok {
		t.Fatalf("not object: %s", out)
	}
	return o
}

func decodeNodePNG(t *testing.T, n *jsonv.Object) image.Image {
	t.Helper()
	src := n.Str("src")
	if !strings.HasPrefix(src, "data:image/") {
		t.Fatalf("src = %q", src[:min(40, len(src))])
	}
	data, err := decodeDataURL(src)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestResizeImagePresets(t *testing.T) {
	presets := []struct {
		name string
		w, h int
	}{
		{"qhd", 960, 540},
		{"hd", 1280, 720},
		{"2k", 2560, 1440},
		{"4k", 3840, 2160},
	}
	for _, p := range presets {
		t.Run(p.name, func(t *testing.T) {
			m, s, _ := resizeSetup(t)
			out, isErr := callText(t, m, "resize_image", obj("src", "pixel.png", "preset", p.name, "fit", "fill"))
			if isErr {
				t.Fatalf("%s", out)
			}
			sc := parseToolJSON(t, out)
			if int(sc.Num("width")) != p.w || int(sc.Num("height")) != p.h || int(sc.Num("targetWidth")) != p.w || int(sc.Num("targetHeight")) != p.h {
				t.Fatalf("result = %s", out)
			}
			n := lastNode(t, s)
			img := decodeNodePNG(t, n)
			b := img.Bounds()
			if b.Dx() != p.w || b.Dy() != p.h {
				t.Fatalf("pixels %dx%d", b.Dx(), b.Dy())
			}
		})
	}
}

func TestResizeImageFits(t *testing.T) {
	cases := []struct {
		fit   string
		wantW int
		wantH int
	}{
		{"contain", 8, 6},
		{"cover", 8, 6},
		{"fill", 8, 6},
	}
	for _, c := range cases {
		t.Run(c.fit, func(t *testing.T) {
			m, s, _ := resizeSetup(t)
			preset := obj("width", 8.0, "height", 6.0)
			if c.fit == "contain" {
				preset = obj("width", 8.0, "height", 8.0)
			}
			out, isErr := callText(t, m, "resize_image", obj("src", "pixel.png", "preset", preset, "fit", c.fit))
			if isErr {
				t.Fatalf("%s", out)
			}
			sc := parseToolJSON(t, out)
			if sc.Str("fit") != c.fit {
				t.Fatalf("fit = %s", out)
			}
			n := lastNode(t, s)
			img := decodeNodePNG(t, n)
			b := img.Bounds()
			if b.Dx() != c.wantW || b.Dy() != c.wantH {
				t.Fatalf("%s pixels %dx%d want %dx%d", c.fit, b.Dx(), b.Dy(), c.wantW, c.wantH)
			}
		})
	}
}

func TestResizeImageUpAndDown(t *testing.T) {
	m, s, _ := resizeSetup(t)
	down, isErr := callText(t, m, "resize_image", obj("src", "pixel.png", "preset", obj("width", 2.0, "height", 2.0), "fit", "contain"))
	if isErr {
		t.Fatalf("down: %s", down)
	}
	n := lastNode(t, s)
	img := decodeNodePNG(t, n)
	if img.Bounds().Dx() != 2 || img.Bounds().Dy() != 2 {
		t.Fatalf("downscale %v", img.Bounds())
	}
	up, isErr := callText(t, m, "resize_image", obj("src", "pixel.png", "preset", obj("width", 40.0, "height", 30.0), "fit", "fill"))
	if isErr {
		t.Fatalf("up: %s", up)
	}
	n = lastNode(t, s)
	img = decodeNodePNG(t, n)
	if img.Bounds().Dx() != 40 || img.Bounds().Dy() != 30 {
		t.Fatalf("upscale %v", img.Bounds())
	}
}

func TestResizeImageNodeIdUndo(t *testing.T) {
	m, s, _ := resizeSetup(t)
	imp, isErr := callText(t, m, "import_image", obj("src", "pixel.png"))
	if isErr {
		t.Fatalf("import: %s", imp)
	}
	id := parseToolJSON(t, imp).Arr("created")[0].(string)
	before := core.GetNode(s.Doc(), id).Str("src")
	vBefore := s.Version()
	out, isErr := callText(t, m, "resize_image", obj("nodeId", id, "preset", "qhd", "fit", "fill"))
	if isErr {
		t.Fatalf("%s", out)
	}
	sc := parseToolJSON(t, out)
	if sc.Str("id") != id || int(sc.Num("width")) != 960 || int(sc.Num("height")) != 540 {
		t.Fatalf("%s", out)
	}
	n := core.GetNode(s.Doc(), id)
	if n.Str("src") == before || n.Num("width") != 960 || n.Num("height") != 540 {
		t.Fatalf("node not updated")
	}
	if s.Version() != vBefore+1 || !s.CanUndo() {
		t.Fatalf("version=%d undo=%v", s.Version(), s.CanUndo())
	}
	if ok, err := s.Undo("agent:test"); !ok || err != nil {
		t.Fatalf("undo: %v %v", ok, err)
	}
	n = core.GetNode(s.Doc(), id)
	if n.Str("src") != before || n.Num("width") != 4 || n.Num("height") != 3 {
		t.Fatalf("undo did not restore: %s", jsonv.Stringify(n, ""))
	}
}

func TestResizeImageAnimatedGIFFirstFrame(t *testing.T) {
	m, s, _ := resizeSetup(t)
	out, isErr := callText(t, m, "resize_image", obj("src", "animated.gif", "preset", obj("width", 8.0, "height", 6.0), "fit", "fill"))
	if isErr {
		t.Fatalf("%s", out)
	}
	sc := parseToolJSON(t, out)
	warns := sc.Arr("warnings")
	if len(warns) != 1 || !strings.Contains(warns[0].(string), "first frame") {
		t.Fatalf("warnings = %s", out)
	}
	if sc.Str("format") != "gif" {
		t.Fatalf("format = %s", out)
	}
	n := lastNode(t, s)
	if !strings.HasPrefix(n.Str("src"), "data:image/gif;base64,") {
		t.Fatalf("src = %s", n.Str("src")[:40])
	}
}

func TestResizeImageAnimatedWebPAndAVIFRefuse(t *testing.T) {
	m, _, _ := resizeSetup(t)
	out, isErr := callText(t, m, "resize_image", obj("src", "animated.webp", "preset", "hd"))
	if !isErr || !strings.Contains(out, "animated WebP") {
		t.Fatalf("webp: %v %s", isErr, out)
	}
	out, isErr = callText(t, m, "resize_image", obj("src", "pixel.avif", "preset", "hd"))
	if !isErr || !strings.Contains(out, "AVIF") {
		t.Fatalf("avif: %v %s", isErr, out)
	}
}

func TestResizeImageWebPToPNG(t *testing.T) {
	m, s, _ := resizeSetup(t)
	out, isErr := callText(t, m, "resize_image", obj("src", "pixel.webp", "preset", obj("width", 4.0, "height", 3.0), "fit", "fill"))
	if isErr {
		t.Fatalf("%s", out)
	}
	sc := parseToolJSON(t, out)
	if sc.Str("format") != "png" || sc.Str("sourceFormat") != "webp" {
		t.Fatalf("%s", out)
	}
	warns := sc.Arr("warnings")
	if len(warns) != 1 || !strings.Contains(warns[0].(string), "PNG") {
		t.Fatalf("warnings = %s", out)
	}
	n := lastNode(t, s)
	_ = decodeNodePNG(t, n)
}

func TestResizeImageNoChromiumEnv(t *testing.T) {
	t.Setenv("PAPRIKA_CHROMIUM", "")
	if v := os.Getenv("PAPRIKA_CHROMIUM"); v != "" {
		t.Fatalf("PAPRIKA_CHROMIUM=%q", v)
	}
	m, _, _ := resizeSetup(t)
	out, isErr := callText(t, m, "resize_image", obj("src", "pixel.jpg", "preset", obj("width", 2.0, "height", 2.0), "fit", "cover"))
	if isErr {
		t.Fatalf("%s", out)
	}
	sc := parseToolJSON(t, out)
	if sc.Str("format") != "jpeg" {
		t.Fatalf("%s", out)
	}
}
