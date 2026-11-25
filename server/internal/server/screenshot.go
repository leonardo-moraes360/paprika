package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/export"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type Chrome struct {
	mu         sync.Mutex
	allocStop  context.CancelFunc
	browser    context.Context
	stop       context.CancelFunc
	saved      map[string][]byte
	savedOrder []string
}

const maxSide = 4096.0

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
			sort.Sort(sort.Reverse(sort.StringSlice(m)))
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

const chromiumInstallCommand = "pnpm --filter @paprika/e2e exec playwright install chromium"

const shotArchiveLimit = 32

var chromiumRevRe = regexp.MustCompile(`(?:chromium_headless_shell|chromium)-(\d+)`)

var shotIDRe = regexp.MustCompile(`^[0-9a-f]{16}$`)

func chromiumProblem() string {
	path := ""
	if env := os.Getenv("PAPRIKA_CHROMIUM"); env != "" {
		st, err := os.Stat(env)
		if err != nil || st.IsDir() {
			return fmt.Sprintf("screenshot unavailable: PAPRIKA_CHROMIUM=%s is not a browser binary. Install Chromium with '%s' or set PAPRIKA_CHROMIUM to an installed Chrome", env, chromiumInstallCommand)
		}
		path = env
	} else {
		path = FindChromium()
		if path == "" {
			return fmt.Sprintf("screenshot unavailable: Chromium not found. Install it with '%s' or set PAPRIKA_CHROMIUM", chromiumInstallCommand)
		}
	}
	return chromiumMismatch(path)
}

func chromiumRevision(path string) string {
	m := chromiumRevRe.FindStringSubmatch(filepath.ToSlash(path))
	if m == nil {
		return ""
	}
	return m[1]
}

func findBrowsersJSON() string {
	var roots []string
	if wd, err := os.Getwd(); err == nil {
		roots = append(roots, wd)
	}
	if exe, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Dir(exe))
	}
	seen := map[string]bool{}
	for _, root := range roots {
		dir := root
		for range 8 {
			if seen[dir] {
				break
			}
			seen[dir] = true
			direct := filepath.Join(dir, "node_modules", "playwright-core", "browsers.json")
			if st, err := os.Stat(direct); err == nil && !st.IsDir() {
				return direct
			}
			matches, _ := filepath.Glob(filepath.Join(dir, "node_modules", ".pnpm", "playwright-core@*", "node_modules", "playwright-core", "browsers.json"))
			if len(matches) > 0 {
				sort.Strings(matches)
				return matches[len(matches)-1]
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return ""
}

func expectedChromiumRevisions() map[string]bool {
	p := findBrowsersJSON()
	if p == "" {
		return nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var doc struct {
		Browsers []struct {
			Name     string `json:"name"`
			Revision string `json:"revision"`
		} `json:"browsers"`
	}
	if json.Unmarshal(data, &doc) != nil {
		return nil
	}
	out := map[string]bool{}
	for _, b := range doc.Browsers {
		if (b.Name == "chromium" || b.Name == "chromium-headless-shell") && b.Revision != "" {
			out[b.Revision] = true
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func chromiumMismatch(path string) string {
	got := chromiumRevision(path)
	if got == "" {
		return ""
	}
	want := expectedChromiumRevisions()
	if len(want) == 0 || want[got] {
		return ""
	}
	expected := make([]string, 0, len(want))
	for rev := range want {
		expected = append(expected, rev)
	}
	sort.Strings(expected)
	return fmt.Sprintf("screenshot unavailable: Chromium build %s is installed, but Playwright expects build %s. Install it with '%s' or set PAPRIKA_CHROMIUM", got, strings.Join(expected, " or "), chromiumInstallCommand)
}

func chromiumStartup(shot Screenshotter) string {
	if _, ok := shot.(*Chrome); !ok {
		return ""
	}
	return chromiumProblem()
}

func (c *Chrome) ensure() (context.Context, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.browser != nil && c.browser.Err() == nil {
		return c.browser, nil
	}
	if msg := chromiumProblem(); msg != "" {
		return nil, errors.New(msg)
	}
	path := FindChromium()
	if path == "" {
		return nil, fmt.Errorf("screenshot unavailable: Chromium not found. Install it with '%s' or set PAPRIKA_CHROMIUM", chromiumInstallCommand)
	}
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(path),
		chromedp.Flag("headless", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("font-render-hinting", "none"),
		chromedp.NoSandbox,
	)
	alloc, allocStop := chromedp.NewExecAllocator(context.Background(), opts...)
	browser, stop := chromedp.NewContext(alloc)
	if err := chromedp.Do(browser); err != nil {
		stop()
		allocStop()
		return nil, fmt.Errorf("screenshot unavailable: failed to start %s: %w. Install Chromium with '%s' or set PAPRIKA_CHROMIUM", path, err, chromiumInstallCommand)
	}
	c.allocStop, c.browser, c.stop = allocStop, browser, stop
	return browser, nil
}

func (c *Chrome) Screenshot(ctx context.Context, doc *core.Document, rootID string, scale float64) ([]byte, int, int, error) {
	return c.ScreenshotMode(ctx, doc, rootID, scale, "")
}

func (c *Chrome) ScreenshotMode(ctx context.Context, doc *core.Document, rootID string, scale float64, mode string) ([]byte, int, int, error) {
	png, w, h, _, err := c.ScreenshotScaled(ctx, doc, rootID, scale, mode)
	return png, w, h, err
}

func (c *Chrome) ScreenshotScaled(ctx context.Context, doc *core.Document, rootID string, scale float64, mode string) ([]byte, int, int, float64, error) {
	doc = docForMode(doc, rootID, mode)
	bg := ""
	if rootID != "" {
		if n := core.GetNode(doc, rootID); n == nil || n.Str("type") != "page" {
			bg = "transparent"
		}
	}
	html, bounds, err := core.RenderHTML(doc, core.RenderOptions{RootID: rootID, Background: bg})
	if err != nil {
		return nil, 0, 0, 0, err
	}
	html = withInterFaces(html)
	measureW, measureH := false, false
	if n := core.GetNode(doc, rootID); rootID != "" && n != nil && n.Str("type") != "page" {
		w, _ := n.Get("width")
		h, _ := n.Get("height")
		_, wNum := w.(float64)
		_, hNum := h.(float64)
		measureW, measureH = !wNum, !hNum
	}
	width := math.Ceil(bounds.Width)
	height := math.Ceil(bounds.Height)
	if measureW {
		width = viewportGuess
	}
	if measureH {
		height = viewportGuess
	}
	if scale == 0 {
		scale = 1
	}
	want := scale
	scale = math.Max(0.1, math.Min(scale, math.Min(maxSide/width, maxSide/height)))
	browser, err := c.ensure()
	if err != nil {
		return nil, 0, 0, 0, err
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
	err = chromedp.Do(tab, loadHTML(html, width, height, rootID != ""))
	if err == nil && (measureW || measureH) {
		var size []float64
		size, err = chromedp.Run(tab, chromedp.Evaluate[[]float64](fmt.Sprintf(measureRoot, measureW, measureH)))
		if err == nil && len(size) == 2 {
			width, height = size[0], size[1]
			scale = math.Max(0.1, math.Min(want, math.Min(maxSide/width, maxSide/height)))
		}
	}
	if err == nil {
		err = chromedp.Do(tab, applyScale(width, height, scale))
	}
	if err == nil {
		err = chromedp.Do(tab, chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			fromSurface := true
			r, err := cdp.Call(ctx, t, page.CaptureScreenshot, page.CaptureScreenshotParams{Format: page.CaptureScreenshotFormatPng, FromSurface: &fromSurface})
			png = r.Data
			return err
		}))
	}
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("screenshot falhou: %w", err)
	}
	return png, int(math.Round(width * scale)), int(math.Round(height * scale)), scale, nil
}

const viewportGuess = 1280

const measureRoot = `((mw, mh) => {
  const b = document.body, el = b.firstElementChild;
  if (!el) return [1, 1];
  if (mw) b.style.width = "max-content";
  if (mh) b.style.height = "max-content";
  const r = el.getBoundingClientRect();
  const w = mw ? Math.max(1, Math.ceil(r.width)) : b.getBoundingClientRect().width;
  const h = mh ? Math.max(1, Math.ceil(r.height)) : b.getBoundingClientRect().height;
  b.style.width = w + "px";
  b.style.height = h + "px";
  return [w, h];
})(%t, %t)`

func applyScale(width, height, scale float64) chromedp.Action[chromedp.Void] {
	return chromedp.Steps(
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetDeviceMetricsOverride, emulation.SetDeviceMetricsOverrideParams{Width: int64(math.Round(width * scale)), Height: int64(math.Round(height * scale)), DeviceScaleFactor: 1})
			return err
		}),
		chromedp.Evaluate[chromedp.Void](fmt.Sprintf(`document.documentElement.style.zoom = "%s"`, strconv.FormatFloat(scale, 'f', -1, 64))),
	)
}

func loadHTML(html string, width, height float64, transparent bool) chromedp.Action[chromedp.Void] {
	return chromedp.Steps(
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			_, err := cdp.Call(ctx, t, emulation.SetDeviceMetricsOverride, emulation.SetDeviceMetricsOverrideParams{Width: int64(width), Height: int64(height), DeviceScaleFactor: 1})
			return err
		}),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			if !transparent {
				return nil
			}
			return t.Call(ctx, emulation.SetDefaultBackgroundColorOverride.Method, map[string]any{"color": map[string]any{"r": 0, "g": 0, "b": 0, "a": 0}}, nil)
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
		chromedp.Evaluate[chromedp.Void](`Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => document.fonts ? document.fonts.ready.then(() => 1) : 1)`, chromedp.EvalAwaitPromise),
	)
}

const bakeComputedJS = `(() => {
  const skip = new Set(["script", "style", "link", "meta", "title", "head"]);
  let unreadable = 0;
  function declared(el) {
    const out = new Map();
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          try { if (!el.matches(rule.selectorText)) continue; } catch (e) { continue; }
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style.item(i);
            out.set(prop, rule.style.getPropertyValue(prop));
          }
        } else if (rule.cssRules) {
          try { visit(rule.cssRules); } catch (e) { unreadable++; }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { unreadable++; continue; }
      visit(rules);
    }
    for (let i = 0; i < el.style.length; i++) {
      const prop = el.style.item(i);
      out.set(prop, el.style.getPropertyValue(prop));
    }
    return out;
  }
  function rotateOf(t) {
    const m = /^matrix\(([^)]+)\)$/.exec(t);
    if (!m) return t === "none" ? "" : t;
    const p = m[1].split(",").map((s) => Number(s));
    if (p.length < 4 || p.some((n) => !Number.isFinite(n))) return "";
    const a = p[0], b = p[1], c = p[2], d = p[3];
    if (Math.abs(a - d) > 0.02 || Math.abs(b + c) > 0.02) return "";
    const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI * 1000) / 1000;
    if (!deg) return "";
    return "rotate(" + deg + "deg)";
  }
  function shadowOf(s) {
    if (!s || s === "none") return "none";
    return s.replace(/((?:rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8})\s+((?:-?[\d.]+px\s+){2,4})/g, (_, color, offs) => offs.trim() + " " + color);
  }
  function resolved(el, prop) {
    const cs = getComputedStyle(el);
    switch (prop) {
      case "background":
      case "background-color": return "background-color:" + cs.backgroundColor;
      case "color": return "color:" + cs.color;
      case "font-weight": return "font-weight:" + cs.fontWeight;
      case "font-size": return "font-size:" + cs.fontSize;
      case "font-family": return "font-family:" + cs.fontFamily;
      case "line-height": return "line-height:" + cs.lineHeight;
      case "letter-spacing": return "letter-spacing:" + cs.letterSpacing;
      case "text-align": return "text-align:" + cs.textAlign;
      case "white-space": return "white-space:" + cs.whiteSpace;
      case "gap":
      case "row-gap":
      case "column-gap": return "gap:" + cs.gap;
      case "padding":
      case "padding-top":
      case "padding-right":
      case "padding-bottom":
      case "padding-left": return "padding:" + cs.paddingTop + " " + cs.paddingRight + " " + cs.paddingBottom + " " + cs.paddingLeft;
      case "display": return "display:" + cs.display;
      case "flex-direction": return "flex-direction:" + cs.flexDirection;
      case "align-items": return "align-items:" + cs.alignItems;
      case "justify-content": return "justify-content:" + cs.justifyContent;
      case "flex-wrap": return "flex-wrap:" + cs.flexWrap;
      case "flex":
      case "flex-grow":
      case "flex-shrink":
      case "flex-basis": return "flex:" + cs.flexGrow + " " + cs.flexShrink + " " + cs.flexBasis;
      case "align-self": return "align-self:" + cs.alignSelf;
      case "position": return "position:" + cs.position;
      case "left": return "left:" + cs.left;
      case "top": return "top:" + cs.top;
      case "width": return "width:" + cs.width;
      case "height": return "height:" + cs.height;
      case "opacity": return "opacity:" + cs.opacity;
      case "overflow": return "overflow:" + cs.overflow;
      case "object-fit": return "object-fit:" + cs.objectFit;
      case "border":
      case "border-width":
      case "border-style":
      case "border-color":
      case "border-top": return "border:" + cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor;
      case "border-radius": return "border-radius:" + cs.borderTopLeftRadius;
      case "box-shadow": return "box-shadow:" + shadowOf(cs.boxShadow);
      case "transform": return "transform:" + (rotateOf(cs.transform) || "none");
      case "filter": return "filter:" + cs.filter;
      case "backdrop-filter": return "backdrop-filter:" + cs.backdropFilter;
      case "outline":
      case "outline-width":
      case "outline-style":
      case "outline-color": return "outline:" + cs.outlineWidth + " " + cs.outlineStyle + " " + cs.outlineColor;
      case "outline-offset": return "outline-offset:" + cs.outlineOffset;
      default: return "";
    }
  }
  function walk(el) {
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    if (skip.has(tag)) return;
    const props = declared(el);
    if (props.size) {
      const parts = [];
      const seen = new Set();
      for (const prop of props.keys()) {
        const line = resolved(el, prop);
        if (!line) continue;
        const key = line.slice(0, line.indexOf(":"));
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(line);
      }
      if (parts.length) {
        el.setAttribute("style", parts.join(";"));
        el.removeAttribute("class");
      }
    }
    for (const child of [...el.children]) walk(child);
  }
  if (document.body) walk(document.body);
  for (const el of [...document.querySelectorAll("style, script")]) el.remove();
  return JSON.stringify({ html: document.documentElement.outerHTML, unreadable });
})()`

func (c *Chrome) ComputedHTML(ctx context.Context, html string) (string, error) {
	if msg := chromiumProblem(); msg != "" {
		return "", fmt.Errorf("computed styles need Chromium. %s", msg)
	}
	browser, err := c.ensure()
	if err != nil {
		return "", fmt.Errorf("computed styles need Chromium. %w", err)
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
	err = chromedp.Do(tab,
		chromedp.Navigate("about:blank"),
		chromedp.Func(func(ctx context.Context, t *chromedp.Target) error {
			tree, err := cdp.Call(ctx, t, page.GetFrameTree, cdp.Empty{})
			if err != nil {
				return err
			}
			_, err = cdp.Call(ctx, t, page.SetDocumentContent, page.SetDocumentContentParams{FrameID: tree.FrameTree.Frame.ID, HTML: html})
			return err
		}),
	)
	if err != nil {
		return "", fmt.Errorf("computed styles failed in Chromium: %w. Install Chromium with '%s' or set PAPRIKA_CHROMIUM", err, chromiumInstallCommand)
	}
	raw, err := chromedp.Run(tab, chromedp.Evaluate[string](bakeComputedJS))
	if err != nil {
		return "", fmt.Errorf("computed styles failed in Chromium: %w. Install Chromium with '%s' or set PAPRIKA_CHROMIUM", err, chromiumInstallCommand)
	}
	var parsed struct {
		HTML       string `json:"html"`
		Unreadable int    `json:"unreadable"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil || parsed.HTML == "" {
		return "", errors.New("computed styles failed in Chromium: the document came back empty. Install Chromium with '" + chromiumInstallCommand + "' or set PAPRIKA_CHROMIUM")
	}
	if len(parsed.HTML) > 2_000_000 {
		return "", fmt.Errorf("computed HTML is too large: %d characters (limit 2000000)", len(parsed.HTML))
	}
	return parsed.HTML, nil
}

func (c *Chrome) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stop != nil {
		c.stop()
		c.allocStop()
		c.stop, c.allocStop, c.browser = nil, nil, nil
	}
}

type shotArchive interface {
	StorePNG(png []byte) string
	PNG(id string) ([]byte, bool)
}

func (c *Chrome) StorePNG(png []byte) string {
	id := newShotID()
	buf := append([]byte(nil), png...)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.saved == nil {
		c.saved = map[string][]byte{}
	}
	c.saved[id] = buf
	c.savedOrder = append(c.savedOrder, id)
	for len(c.savedOrder) > shotArchiveLimit {
		drop := c.savedOrder[0]
		c.savedOrder = c.savedOrder[1:]
		delete(c.saved, drop)
	}
	return id
}

func (c *Chrome) PNG(id string) ([]byte, bool) {
	if !shotIDRe.MatchString(id) {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	png, ok := c.saved[id]
	if !ok {
		return nil, false
	}
	return append([]byte(nil), png...), true
}

func newShotID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%016x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func docForMode(doc *core.Document, rootID, mode string) *core.Document {
	if mode == "" || doc == nil {
		return doc
	}
	clone, ok := jsonv.Clone(doc).(*jsonv.Object)
	if !ok || clone == nil {
		return doc
	}
	if rootID != "" {
		if n := core.GetNode(clone, rootID); n != nil {
			if target := themeCarrier(clone, n); target != nil {
				target.Set("mode", mode)
			}
		}
		return clone
	}
	if p := core.FirstPage(clone); p != nil {
		p.Set("mode", mode)
		return clone
	}
	for _, id := range clone.Strings("rootIds") {
		n := core.GetNode(clone, id)
		if n != nil && (n.Str("type") == "frame" || n.Str("type") == "page") {
			n.Set("mode", mode)
		}
	}
	return clone
}

func themeCarrier(doc *core.Document, n *core.Node) *core.Node {
	for cur, depth := n, 0; cur != nil && depth < 1000; depth++ {
		if t := cur.Str("type"); t == "frame" || t == "page" {
			return cur
		}
		pid, ok := core.ParentID(cur)
		if !ok || pid == "" {
			return nil
		}
		cur = core.GetNode(doc, pid)
	}
	return nil
}

func screenshotDir(dbPath string) (string, error) {
	raw := os.Getenv("PAPRIKA_SCREENSHOTS")
	if raw == "" {
		raw = filepath.Join(filepath.Dir(dbPath), "screenshots")
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	return real, nil
}

func writeScreenshot(dbPath, rel string, png []byte) (string, error) {
	dir, err := screenshotDir(dbPath)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == "" || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is outside the screenshot directory (%s)", rel, dir)
	}
	abs := filepath.Join(dir, clean)
	if !within(dir, abs) {
		return "", fmt.Errorf("path %q is outside the screenshot directory (%s)", rel, dir)
	}
	parent := filepath.Dir(abs)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return "", err
	}
	realParent, err := filepath.EvalSymlinks(parent)
	if err != nil || (realParent != dir && !within(dir, realParent)) {
		return "", fmt.Errorf("path %q is outside the screenshot directory (%s)", rel, dir)
	}
	dest := filepath.Join(realParent, filepath.Base(abs))
	if !within(dir, dest) {
		return "", fmt.Errorf("path %q is outside the screenshot directory (%s)", rel, dir)
	}
	if st, lerr := os.Lstat(dest); lerr == nil && st.Mode()&os.ModeSymlink != 0 {
		real, rerr := filepath.EvalSymlinks(dest)
		if rerr != nil || !within(dir, real) {
			return "", fmt.Errorf("path %q is outside the screenshot directory (%s)", rel, dir)
		}
		dest = real
	}
	if err := os.WriteFile(dest, png, 0o644); err != nil {
		return "", err
	}
	return dest, nil
}

func screenshotURL(shot Screenshotter, png []byte) string {
	arc, ok := shot.(shotArchive)
	if !ok {
		return ""
	}
	return "/api/screenshot/" + arc.StorePNG(png)
}

var (
	interFacesOnce sync.Once
	interFacesCSS  string
)

func withInterFaces(html string) string {
	interFacesOnce.Do(func() {
		css, err := export.InterFontFaceCSS(func(file string) (string, error) {
			raw, ok := export.InterFile(file)
			if !ok {
				return "", fmt.Errorf("missing %s", file)
			}
			return "data:font/ttf;base64," + base64.StdEncoding.EncodeToString(raw), nil
		})
		if err == nil {
			interFacesCSS = "<style>" + css + "</style>"
		}
	})
	if interFacesCSS == "" {
		return html
	}
	return strings.Replace(html, "</head>", interFacesCSS+"</head>", 1)
}
