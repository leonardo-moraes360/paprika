package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

type WASMScreenshotter interface {
	ScreenshotWASM(ctx context.Context, workspaceID string, doc *core.Document, rootID string, scale float64) (png []byte, width, height int, err error)
}

type canvasEndpoint interface {
	SetCanvas(base string)
}

func canvasBase(host string, port int) string {
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(port))}).String()
}

func (c *Chrome) SetCanvas(base string) {
	c.mu.Lock()
	c.canvas = base
	c.mu.Unlock()
}

const waitWASMBackend = `new Promise((resolve) => {
  const t0 = performance.now();
  const tick = () => {
    const el = document.querySelector('[data-testid="wasm-layer"]');
    const backend = el ? el.dataset.backend : "";
    if (backend === "cpu" || backend === "webgpu" || backend === "error" || backend === "unavailable") resolve([backend, el.dataset.detail || ""]);
    else if (performance.now() - t0 > 20000) resolve(["timeout", document.querySelector('[data-testid="viewport"]') ? "wasm layer missing or still loading" : "canvas did not open the workspace"]);
    else setTimeout(tick, 50);
  };
  tick();
})`

const waitCaptureBox = `new Promise((resolve) => {
  const t0 = performance.now();
  const tick = () => {
    const box = document.querySelector('[data-testid="viewport"]')?.dataset.captureBox;
    if (box) resolve(box);
    else if (performance.now() - t0 > 20000) resolve("");
    else setTimeout(tick, 50);
  };
  tick();
})`

const waitCapturePainted = `Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })), document.fonts ? document.fonts.ready : 0).then(() => new Promise((resolve) => {
  const t0 = performance.now();
  let stable = 0;
  const tick = () => {
    const c = document.querySelector('[data-testid="wasm-layer"]');
    const ok = c && c.width === Math.round(innerWidth * devicePixelRatio) && c.height === Math.round(innerHeight * devicePixelRatio);
    stable = ok ? stable + 1 : 0;
    if (stable >= 4 || performance.now() - t0 > 10000) resolve(stable >= 4);
    else requestAnimationFrame(tick);
  };
  tick();
}))`

func (c *Chrome) ScreenshotWASM(ctx context.Context, workspaceID string, doc *core.Document, rootID string, scale float64) ([]byte, int, int, error) {
	c.mu.Lock()
	base := c.canvas
	c.mu.Unlock()
	if base == "" {
		return nil, 0, 0, errors.New(`renderer "wasm" needs the canvas web app, which this server is not serving (run "paprika serve" with the web build, web-legacy/dist). Use renderer "dom" for the DOM screenshot`)
	}
	id := rootID
	if id == "" {
		id = core.ContentPageID(doc)
	}
	n := core.GetNode(doc, id)
	if n == nil {
		return nil, 0, 0, fmt.Errorf(`renderer "wasm": node "%s" does not exist`, id)
	}
	q := url.Values{"renderer": {"wasm"}, "capture": {id}}
	if pg := core.PageOf(doc, id); pg != "" {
		q.Set("page", pg)
	}
	target := base + "/w/" + url.PathEscape(workspaceID) + "?" + q.Encode()
	browser, err := c.ensure()
	if err != nil {
		return nil, 0, 0, err
	}
	tab, cancel := chromedp.NewContext(browser)
	defer cancel()
	tab, cancelTimeout := context.WithTimeout(tab, 60*time.Second)
	defer cancelTimeout()
	go func() {
		select {
		case <-ctx.Done():
			cancelTimeout()
		case <-tab.Done():
		}
	}()
	transparent := n.Str("type") != "page"
	if scale == 0 {
		scale = 1
	}
	metrics := func(w, h int64, dsf float64) chromedp.Action[chromedp.Void] {
		return chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetDeviceMetricsOverride, emulation.SetDeviceMetricsOverrideParams{Width: w, Height: h, DeviceScaleFactor: dsf})
			return err
		})
	}
	err = chromedp.Do(tab,
		metrics(1280, 800, 1),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			if !transparent {
				return nil
			}
			return t.Call(ctx, emulation.SetDefaultBackgroundColorOverride.Method, map[string]any{"color": map[string]any{"r": 0, "g": 0, "b": 0, "a": 0}}, nil)
		}),
		chromedp.Navigate(target),
	)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("screenshot falhou: %w", err)
	}
	state, err := chromedp.Run(tab, chromedp.Evaluate[[]string](waitWASMBackend, chromedp.EvalAwaitPromise))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("screenshot falhou: %w", err)
	}
	switch state[0] {
	case "unavailable":
		return nil, 0, 0, errors.New(`renderer "wasm" is unavailable: this build has no WASM renderer bundle (web-legacy/src/wasm, built by "pnpm build" with Rust and wasm-bindgen-cli installed). Use renderer "dom"`)
	case "error":
		return nil, 0, 0, fmt.Errorf(`renderer "wasm" failed to start: %s`, strings.TrimSpace(state[1]))
	case "timeout":
		return nil, 0, 0, fmt.Errorf(`renderer "wasm" did not become ready: %s`, state[1])
	}
	raw, err := chromedp.Run(tab, chromedp.Evaluate[string](waitCaptureBox, chromedp.EvalAwaitPromise))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("screenshot falhou: %w", err)
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 4 {
		return nil, 0, 0, fmt.Errorf(`renderer "wasm": the canvas did not paint node "%s" (is it hidden or off the current page?)`, id)
	}
	bw, _ := strconv.ParseFloat(parts[2], 64)
	bh, _ := strconv.ParseFloat(parts[3], 64)
	width := math.Max(1, math.Ceil(bw))
	height := math.Max(1, math.Ceil(bh))
	scale = math.Max(0.1, math.Min(scale, math.Min(maxSide/width, maxSide/height)))
	var png []byte
	err = chromedp.Do(tab,
		metrics(int64(width), int64(height), scale),
		chromedp.Evaluate[chromedp.Void](waitCapturePainted, chromedp.EvalAwaitPromise),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			fromSurface := true
			r, err := cdp.Call(ctx, t, page.CaptureScreenshot, page.CaptureScreenshotParams{Format: page.CaptureScreenshotFormatPng, FromSurface: &fromSurface})
			png = r.Data
			return err
		}),
	)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("screenshot falhou: %w", err)
	}
	return png, int(math.Round(width * scale)), int(math.Round(height * scale)), nil
}
