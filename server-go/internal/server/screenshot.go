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
	"github.com/chromedp/cdproto/runtime"
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
	)
	if os.Geteuid() == 0 {
		opts = append(opts, chromedp.NoSandbox)
	}
	alloc, allocStop := chromedp.NewExecAllocator(context.Background(), opts...)
	browser, stop := chromedp.NewContext(alloc)
	if err := chromedp.Run(browser); err != nil {
		stop()
		allocStop()
		return nil, fmt.Errorf("screenshot indisponível: falha ao iniciar %s: %w", path, err)
	}
	c.allocStop, c.browser, c.stop = allocStop, browser, stop
	return browser, nil
}

// Screenshot renders a node (or the whole canvas) to PNG. The scale is reduced so no side exceeds 4096px.
func (c *Chrome) Screenshot(ctx context.Context, doc *core.Document, rootID string, scale float64) ([]byte, int, int, error) {
	bg := "#ffffff"
	if rootID != "" {
		bg = "transparent"
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
	err = chromedp.Run(tab,
		emulation.SetDeviceMetricsOverride(int64(width), int64(height), scale, false),
		chromedp.ActionFunc(func(ctx context.Context) error {
			if rootID == "" {
				return nil
			}
			return emulation.SetDefaultBackgroundColorOverride().WithColor(&cdp.RGBA{R: 0, G: 0, B: 0, A: 0}).Do(ctx)
		}),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			tree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}
			return page.SetDocumentContent(tree.Frame.ID, html).Do(ctx)
		}),
		// Same as Playwright's waitUntil "load": images (http(s) and data:) finish loading.
		chromedp.Evaluate(`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => document.fonts ? document.fonts.ready.then(() => 1) : 1)`, nil,
			func(p *runtime.EvaluateParams) *runtime.EvaluateParams { return p.WithAwaitPromise(true) }),
		chromedp.ActionFunc(func(ctx context.Context) error {
			png, err = page.CaptureScreenshot().WithFormat(page.CaptureScreenshotFormatPng).WithFromSurface(true).Do(ctx)
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
