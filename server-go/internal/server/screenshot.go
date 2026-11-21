package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
)

// Chrome renders the same HTML as the export (core.NodeStyle) in headless Chromium over CDP.
// The browser starts on first use and is reused.
type Chrome struct {
	mu        sync.Mutex
	allocStop context.CancelFunc
	browser   context.Context
	stop      context.CancelFunc
}

const maxSide = 4096.0

// FindChromium locates a Chromium binary: $PAPRIKA_CHROMIUM, Playwright's cache, then the system.
func FindChromium() string {
	if p := os.Getenv("PAPRIKA_CHROMIUM"); p != "" {
		return p
	}
	var roots []string
	if p := os.Getenv("PLAYWRIGHT_BROWSERS_PATH"); p != "" && p != "0" {
		roots = append(roots, p)
	}
	if home, err := os.UserHomeDir(); err == nil {
		roots = append(roots, filepath.Join(home, ".cache", "ms-playwright"), filepath.Join(home, "Library", "Caches", "ms-playwright"))
	}
	roots = append(roots, "/opt/pw-browsers")
	patterns := []string{
		"chromium_headless_shell-*/chrome-*/headless_shell",
		"chromium_headless_shell-*/chrome-*/chrome-headless-shell",
		"chromium-*/chrome-linux*/chrome",
		"chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
		"chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
		"chromium-*/chrome-win*/chrome.exe",
	}
	for _, r := range roots {
		for _, pat := range patterns {
			m, _ := filepath.Glob(filepath.Join(r, pat))
			sort.Sort(sort.Reverse(sort.StringSlice(m))) // newest build first
			for _, p := range m {
				if st, err := os.Stat(p); err == nil && !st.IsDir() {
					return p
				}
			}
		}
	}
	for _, name := range []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	return ""
}

func (c *Chrome) ensure() (context.Context, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.browser != nil && c.browser.Err() == nil {
		return c.browser, nil
	}
	path := FindChromium()
	if path == "" {
		return nil, errors.New("screenshot indisponível: Chromium não encontrado. Instale com 'npx playwright install chromium' ou defina PAPRIKA_CHROMIUM")
	}
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(path),
		chromedp.Flag("headless", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("font-render-hinting", "none"),
		// Same as Playwright's default (chromiumSandbox: false), which the TypeScript server uses:
		// it only renders Paprika's own HTML, and the sandbox cannot start where unprivileged user
		// namespaces are blocked (e.g. Ubuntu 24.04+ with AppArmor, as on GitHub runners).
		chromedp.NoSandbox,
	)
	alloc, allocStop := chromedp.NewExecAllocator(context.Background(), opts...)
	browser, stop := chromedp.NewContext(alloc)
	if err := chromedp.Do(browser); err != nil {
		stop()
		allocStop()
		return nil, fmt.Errorf("screenshot indisponível: falha ao iniciar %s: %w", path, err)
	}
	c.allocStop, c.browser, c.stop = allocStop, browser, stop
	return browser, nil
}

// Screenshot renders a node (or the whole canvas) to PNG. The scale is reduced so no side exceeds 4096px.
func (c *Chrome) Screenshot(ctx context.Context, doc *core.Document, rootID string, scale float64) ([]byte, int, int, error) {
	// A node comes out transparent; a page (or the canvas) uses its own background, or white.
	bg := ""
	if rootID != "" {
		if n := core.GetNode(doc, rootID); n == nil || n.Str("type") != "page" {
			bg = "transparent"
		}
	}
	html, bounds, err := core.RenderHTML(doc, core.RenderOptions{RootID: rootID, Background: bg})
	if err != nil {
		return nil, 0, 0, err
	}
	width := math.Ceil(bounds.Width)
	height := math.Ceil(bounds.Height)
	if scale == 0 {
		scale = 1
	}
	scale = math.Max(0.1, math.Min(scale, math.Min(maxSide/width, maxSide/height)))
	browser, err := c.ensure()
	if err != nil {
		return nil, 0, 0, err
	}
	tab, cancel := chromedp.NewContext(browser)
	defer cancel()
	tab, cancelTimeout := context.WithTimeout(tab, 15*time.Second)
	defer cancelTimeout()
	go func() {
		select {
		case <-ctx.Done():
			cancelTimeout()
		case <-tab.Done():
		}
	}()
	var png []byte
	err = chromedp.Do(tab,
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetDeviceMetricsOverride, emulation.SetDeviceMetricsOverrideParams{Width: int64(width), Height: int64(height), DeviceScaleFactor: scale})
			return err
		}),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			if rootID == "" {
				return nil
			}
			_, err := cdp.Call(ctx, t, emulation.SetDefaultBackgroundColorOverride, emulation.SetDefaultBackgroundColorOverrideParams{Color: &cdp.RGBA{R: 0, G: 0, B: 0, A: 0}})
			return err
		}),
		chromedp.Navigate("about:blank"),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			tree, err := cdp.Call(ctx, t, page.GetFrameTree, cdp.Empty{})
			if err != nil {
				return err
			}
			_, err = cdp.Call(ctx, t, page.SetDocumentContent, page.SetDocumentContentParams{FrameID: tree.FrameTree.Frame.ID, HTML: html})
			return err
		}),
		// Same as Playwright's waitUntil "load": images (http(s) and data:) finish loading.
		chromedp.Evaluate[chromedp.Void](`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => document.fonts ? document.fonts.ready.then(() => 1) : 1)`, chromedp.EvalAwaitPromise),
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

// Close stops the browser.
func (c *Chrome) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stop != nil {
		c.stop()
		c.allocStop()
		c.stop, c.allocStop, c.browser = nil, nil, nil
	}
}
