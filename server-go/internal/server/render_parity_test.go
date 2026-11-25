package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/visualdiff"
)

const parityOps = `[
  {"op":"create","node":{"type":"frame","id":"card","x":10,"y":10,"width":220,"height":120,"fill":"#ffffff","radius":12,"stroke":{"color":"#c43d27","width":2}}},
  {"op":"create","parentId":"card","node":{"type":"text","id":"t","x":16,"y":16,"width":180,"text":"Inter parity","fontFamily":"Inter","fontSize":18,"fontWeight":600,"color":"#141827"}},
  {"op":"create","parentId":"card","node":{"type":"ellipse","id":"e","x":16,"y":64,"width":40,"height":40,"fill":"#00000080"}}
]`

func parityStore(t *testing.T) *Store {
	t.Helper()
	s, _ := openTemp(t)
	ops, err := jsonv.Parse([]byte(parityOps))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(ops.([]any), "test", "parity"); err != nil {
		t.Fatal(err)
	}
	return s
}

func imageOf(t *testing.T, r *jsonv.Object) []byte {
	t.Helper()
	for _, c := range r.Arr("content") {
		if o := c.(*jsonv.Object); o.Str("type") == "image" {
			raw, err := base64.StdEncoding.DecodeString(o.Str("data"))
			if err != nil {
				t.Fatal(err)
			}
			return raw
		}
	}
	t.Fatal("no image in result")
	return nil
}

// export_image goes through the same Chromium path as render_screenshot, so the two agree.
func TestExportImageMatchesScreenshot(t *testing.T) {
	if FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	chrome := &Chrome{}
	defer chrome.Close()
	m := NewMCP(parityStore(t), "agent:test", chrome)
	shot := m.CallTool(context.Background(), "render_screenshot", obj("rootId", "card"), true)
	exp := m.CallTool(context.Background(), "export_image", obj("rootId", "card", "format", "png"), true)
	if exp.Bool("isError") || shot.Bool("isError") {
		t.Fatalf("errors: %v %v", shot, exp)
	}
	if w := exp.Obj("structuredContent").Arr("warnings"); len(w) != 0 {
		t.Fatalf("unexpected warnings: %v", w)
	}
	a, err := png.Decode(bytes.NewReader(imageOf(t, shot)))
	if err != nil {
		t.Fatal(err)
	}
	b, err := png.Decode(bytes.NewReader(imageOf(t, exp)))
	if err != nil {
		t.Fatal(err)
	}
	res, err := visualdiff.Compare(a, b, &visualdiff.Options{Threshold: 0.2})
	if err != nil {
		t.Fatal(err)
	}
	if res.Similarity < 0.999 {
		t.Fatalf("export vs screenshot similarity %.4f", res.Similarity)
	}
}

type failShot struct{}

func (failShot) ScreenshotMode(context.Context, *core.Document, string, float64, string) ([]byte, int, int, error) {
	return nil, 0, 0, errors.New("no chromium")
}

// Without a usable Chromium, export_image falls back to the built-in rasterizer and says so.
func TestExportImageFallbackWarns(t *testing.T) {
	m := NewMCP(parityStore(t), "agent:test", failShot{})
	exp := m.CallTool(context.Background(), "export_image", obj("rootId", "card", "format", "png"), true)
	if exp.Bool("isError") {
		t.Fatalf("export failed: %v", exp)
	}
	w := exp.Obj("structuredContent").Arr("warnings")
	if len(w) == 0 || !strings.Contains(w[0].(string), "built-in rasterizer") {
		t.Fatalf("warnings = %v", w)
	}
	if _, err := png.Decode(bytes.NewReader(imageOf(t, exp))); err != nil {
		t.Fatal(err)
	}
}

// The embedded Inter is served to the canvas, with weight ranges matching the exporter's faces.
func TestInterFontRoutes(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	get := func(p string) (int, []byte) {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, b
	}
	code, css := get("/fonts/inter.css")
	if code != 200 || !strings.Contains(string(css), "font-family:Inter") || !strings.Contains(string(css), "url(/fonts/Inter-SemiBold.ttf)") {
		t.Fatalf("inter.css: %d %s", code, css)
	}
	code, ttf := get("/fonts/Inter-Regular.ttf")
	if code != 200 || len(ttf) < 1000 || !bytes.Equal(ttf[:4], []byte{0, 1, 0, 0}) {
		t.Fatalf("Inter-Regular.ttf: %d, %d bytes", code, len(ttf))
	}
	if code, _ := get("/fonts/other.ttf"); code != 404 {
		t.Fatalf("unknown font: %d", code)
	}
}
