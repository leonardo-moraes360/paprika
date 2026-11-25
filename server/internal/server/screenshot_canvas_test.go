package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

const stubCanvas = `<!doctype html><body style="margin:0"><div data-testid="viewport"></div>
<canvas data-testid="wasm-layer" data-backend="BACKEND" data-detail="DETAIL" style="position:fixed;inset:0;width:100%;height:100%;background:#ff0000"></canvas>
<script>
const c = document.querySelector("canvas"), v = document.querySelector("[data-testid=viewport]");
const size = () => { c.width = Math.round(innerWidth * devicePixelRatio); c.height = Math.round(innerHeight * devicePixelRatio); };
size(); addEventListener("resize", size);
if ("BACKEND" === "cpu") v.dataset.captureBox = "0,0,30,20";
</script>`

func stubServer(t *testing.T, backend, detail string) *Chrome {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/w/") || r.URL.Query().Get("renderer") != "wasm" || r.URL.Query().Get("capture") != "r" {
			http.Error(w, "bad request "+r.URL.String(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(strings.NewReplacer("BACKEND", backend, "DETAIL", detail).Replace(stubCanvas)))
	}))
	t.Cleanup(ts.Close)
	c := &Chrome{}
	t.Cleanup(c.Close)
	c.SetCanvas(ts.URL)
	return c
}

func wasmDoc(t *testing.T) *core.Document {
	t.Helper()
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "rect", "id", "r", "width", 30.0, "height", 20.0, "fill", "#ff0000")})); isErr {
		t.Fatal(out)
	}
	return s.Doc()
}

func TestScreenshotWASMNeedsCanvas(t *testing.T) {
	c := &Chrome{}
	defer c.Close()
	_, _, _, err := c.ScreenshotWASM(context.Background(), "d", core.CreateDocument("T", "d"), "", 1)
	if err == nil || !strings.Contains(err.Error(), `renderer "wasm"`) || !strings.Contains(err.Error(), "web") {
		t.Fatalf("no canvas: %v", err)
	}
}

func TestCanvasBase(t *testing.T) {
	for host, want := range map[string]string{"": "http://127.0.0.1:9", "0.0.0.0": "http://127.0.0.1:9", "localhost": "http://localhost:9", "::1": "http://[::1]:9"} {
		if got := canvasBase(host, 9); got != want {
			t.Errorf("%q: %s, want %s", host, got, want)
		}
	}
}

func TestRendererWASMArgOnPlainShot(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", &memShot{})
	out, isErr := callText(t, m, "render_screenshot", obj("renderer", "wasm"))
	if !isErr || !strings.Contains(out, `renderer "wasm" is not available`) {
		t.Fatalf("%v %q", isErr, out)
	}
	if _, isErr = callText(t, m, "render_screenshot", obj("renderer", "gpu")); !isErr {
		t.Fatal("renderer gpu accepted")
	}
}

func TestScreenshotWASMCapture(t *testing.T) {
	if FindChromium() == "" || chromiumProblem() != "" {
		t.Skip("Chromium not found")
	}
	doc := wasmDoc(t)
	c := stubServer(t, "cpu", "")
	png, w, h, err := c.ScreenshotWASM(context.Background(), "ws one", doc, "r", 2)
	if err != nil {
		t.Fatal(err)
	}
	if w != 60 || h != 40 {
		t.Fatalf("size %d×%d", w, h)
	}
	if r, g, b := pngPixel(t, png, 5, 5); r < 250 || g > 5 || b > 5 {
		t.Fatalf("pixel %x %x %x", r, g, b)
	}
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", c)
	if _, isErr := callText(t, m, "render_screenshot", obj("renderer", "wasm", "mode", "dark")); !isErr {
		t.Fatal("mode accepted with wasm")
	}
}

func TestScreenshotWASMReportsMissingBundle(t *testing.T) {
	if FindChromium() == "" || chromiumProblem() != "" {
		t.Skip("Chromium not found")
	}
	doc := wasmDoc(t)
	_, _, _, err := stubServer(t, "unavailable", "").ScreenshotWASM(context.Background(), "d", doc, "r", 1)
	if err == nil || !strings.Contains(err.Error(), "no WASM renderer bundle") {
		t.Fatalf("unavailable: %v", err)
	}
	_, _, _, err = stubServer(t, "error", "boom").ScreenshotWASM(context.Background(), "d", doc, "r", 1)
	if err == nil || !strings.Contains(err.Error(), "failed to start: boom") {
		t.Fatalf("error: %v", err)
	}
}
