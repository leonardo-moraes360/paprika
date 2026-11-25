package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

// Exercises the CDP calls end to end; skipped where no Chromium is installed.
func TestChromeScreenshot(t *testing.T) {
	if FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"rect","id":"r","x":0,"y":0,"width":40,"height":20,"fill":"#ff0000"}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	data, w, h, err := c.Screenshot(context.Background(), res.Doc, "r", 2)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); w != 80 || h != 40 || b.Dx() != 80 || b.Dy() != 40 {
		t.Fatalf("got %dx%d, image %v", w, h, b)
	}
	if r, _, _, a := img.At(40, 20).RGBA(); r>>8 != 255 || a>>8 != 255 {
		t.Fatalf("center pixel is not opaque red: %v", img.At(40, 20))
	}
}

// A root whose height (or width) is "hug" is measured in the browser instead of coming out 1px tall.
func TestChromeScreenshotHugRoot(t *testing.T) {
	if FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"frame","id":"f","width":200,"height":"hug","fill":"#00ff00",
		"layout":{"mode":"column","gap":10,"padding":10},"children":[
		{"type":"rect","id":"a","width":50,"height":40,"fill":"#ff0000"},{"type":"rect","id":"b","width":50,"height":40}]}},
		{"op":"create","node":{"type":"text","id":"t","text":"hello","fontSize":20}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	data, w, h, err := c.Screenshot(context.Background(), res.Doc, "f", 1)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	// 10 + 40 + 10 + 40 + 10 = 110
	if b := img.Bounds(); w != 200 || h != 110 || b.Dx() != 200 || b.Dy() != 110 {
		t.Fatalf("hug frame: got %dx%d, image %v", w, h, b)
	}
	// A text created without width/height hugs on both axes (fb#65): its box is its line.
	_, w, h, err = c.Screenshot(context.Background(), res.Doc, "t", 1)
	if err != nil {
		t.Fatal(err)
	}
	if w < 20 || w > 200 || h < 20 || h > 40 {
		t.Fatalf("hug text: got %dx%d", w, h)
	}
}

func TestScreenshotMissingBrowser(t *testing.T) {
	t.Setenv("PAPRIKA_CHROMIUM", filepath.Join(t.TempDir(), "no-browser"))
	msg := chromiumProblem()
	if !strings.Contains(msg, chromiumInstallCommand) {
		t.Fatalf("startup message: %q", msg)
	}
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"rect","id":"r","width":10,"height":10,"fill":"#ff0000"}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	if _, _, _, err := c.Screenshot(context.Background(), res.Doc, "r", 1); err == nil || !strings.Contains(err.Error(), chromiumInstallCommand) {
		t.Fatalf("failure message: %v", err)
	}
	s, _ := openTemp(t)
	var logs []string
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0, Log: func(m string) { logs = append(logs, m) }, Shot: c})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	if !strings.Contains(strings.Join(logs, "\n"), chromiumInstallCommand) {
		t.Fatalf("startup log: %v", logs)
	}
}

func TestChromeScreenshotMode(t *testing.T) {
	if FindChromium() == "" || chromiumProblem() != "" {
		t.Skip("Chromium not found")
	}
	ops, err := jsonv.Parse([]byte(`[
		{"op":"set_tokens","tokens":{"bg":"#111111"}},
		{"op":"set_tokens","mode":"light","tokens":{"bg":"#ffffff"}},
		{"op":"set_tokens","mode":"dark","tokens":{"bg":"#111111"}},
		{"op":"create","node":{"type":"page","id":"pg","mode":"dark","fill":"$bg"}},
		{"op":"create","parentId":"pg","node":{"type":"frame","id":"light","mode":"light","width":80,"height":40,"fill":"$bg","children":[
			{"type":"rect","id":"sub","width":40,"height":20,"fill":"$bg"}]}},
		{"op":"create","parentId":"pg","node":{"type":"frame","id":"darkf","width":40,"height":20,"fill":"$bg","children":[
			{"type":"rect","id":"subdark","width":40,"height":20,"fill":"$bg"}]}}
	]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	light, _, _, err := c.Screenshot(context.Background(), res.Doc, "sub", 1)
	if err != nil {
		t.Fatal(err)
	}
	if r, g, b := pngPixel(t, light, 20, 10); r < 250 || g < 250 || b < 250 {
		t.Fatalf("inherited light subtree of a dark page: rgb %d,%d,%d", r, g, b)
	}
	dark, _, _, err := c.Screenshot(context.Background(), res.Doc, "subdark", 1)
	if err != nil {
		t.Fatal(err)
	}
	if r, g, b := pngPixel(t, dark, 20, 10); r > 40 || g > 40 || b > 40 {
		t.Fatalf("dark subtree: rgb %d,%d,%d", r, g, b)
	}
	forced, _, _, err := c.ScreenshotMode(context.Background(), res.Doc, "subdark", 1, "light")
	if err != nil {
		t.Fatal(err)
	}
	if r, g, b := pngPixel(t, forced, 20, 10); r < 250 || g < 250 || b < 250 {
		t.Fatalf("mode light on a dark subtree: rgb %d,%d,%d", r, g, b)
	}
}

func pngPixel(t *testing.T, data []byte, x, y int) (r, g, b uint32) {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	rr, gg, bb, _ := img.At(x, y).RGBA()
	return rr >> 8, gg >> 8, bb >> 8
}

type memShot struct {
	png   []byte
	w, h  int
	saved map[string][]byte
}

func (m *memShot) ScreenshotMode(context.Context, *core.Document, string, float64, string) ([]byte, int, int, error) {
	return append([]byte(nil), m.png...), m.w, m.h, nil
}

func (m *memShot) StorePNG(png []byte) string {
	id := newShotID()
	if m.saved == nil {
		m.saved = map[string][]byte{}
	}
	m.saved[id] = append([]byte(nil), png...)
	return id
}

func (m *memShot) PNG(id string) ([]byte, bool) {
	png, ok := m.saved[id]
	return png, ok
}

func TestRenderScreenshotPath(t *testing.T) {
	s, _ := openTemp(t)
	pngBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	shot := &memShot{png: pngBytes, w: 1, h: 1}
	m := NewMCP(s, "agent:test", shot)
	out, isErr := callText(t, m, "render_screenshot", obj("path", "../secret.png"))
	if !isErr || !strings.Contains(out, "outside") {
		t.Fatalf("traversal: err=%v %q", isErr, out)
	}
	out, isErr = callText(t, m, "render_screenshot", obj("path", "/tmp/out.png"))
	if !isErr || !strings.Contains(out, "outside") {
		t.Fatalf("absolute: err=%v %q", isErr, out)
	}
	dir := filepath.Join(filepath.Dir(s.Path()), "screenshots")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}
	out, isErr = callText(t, m, "render_screenshot", obj("path", "escape/secret.png"))
	if !isErr || !strings.Contains(out, "outside") {
		t.Fatalf("symlink: err=%v %q", isErr, out)
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.png")); !os.IsNotExist(err) {
		t.Fatalf("symlink write escaped: %v", err)
	}
	out, isErr = callText(t, m, "render_screenshot", obj("path", "boards/shot.png"))
	if isErr {
		t.Fatal(out)
	}
	parsed, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	got := parsed.(*jsonv.Object)
	if got.Num("width") != 1 || got.Num("height") != 1 {
		t.Fatalf("reported size: %s", out)
	}
	file := got.Str("path")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, pngBytes) {
		t.Fatalf("file size %d, png %d", len(data), len(pngBytes))
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != int(got.Num("width")) || b.Dy() != int(got.Num("height")) {
		t.Fatalf("png bounds %v reported %v×%v", b, got.Num("width"), got.Num("height"))
	}
	if !strings.HasPrefix(file, dir+string(filepath.Separator)) {
		t.Fatalf("path %s not under %s", file, dir)
	}
	url := got.Str("url")
	id := strings.TrimPrefix(url, "/api/screenshot/")
	stored, ok := shot.PNG(id)
	if !ok || !bytes.Equal(stored, pngBytes) {
		t.Fatalf("download id %q", url)
	}
	plain := m.CallTool(context.Background(), "render_screenshot", obj(), true)
	if plain.Bool("isError") {
		t.Fatal(plain)
	}
	var sawImage bool
	for _, c := range plain.Arr("content") {
		if c.(*jsonv.Object).Str("type") == "image" {
			sawImage = true
		}
	}
	if !sawImage || !strings.Contains(callTextJoin(plain), "1×1px") {
		t.Fatalf("image result without path: %s", jsonv.Stringify(plain, ""))
	}
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0, Shot: shot})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	code, body, hdr := httpDo(t, srv, "GET", url, nil, "")
	if code != 200 || body != string(pngBytes) {
		t.Fatalf("download %d %d bytes", code, len(body))
	}
	if hdr.Get("Content-Type") != "image/png" || hdr.Get("Content-Security-Policy") != "default-src 'none'" {
		t.Fatalf("headers: %v", hdr)
	}
}

func callTextJoin(r *jsonv.Object) string {
	var b strings.Builder
	for _, c := range r.Arr("content") {
		b.WriteString(c.(*jsonv.Object).Str("text"))
	}
	return b.String()
}
