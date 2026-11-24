package server

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

type styleShot struct {
	html string
	err  error
}

func (styleShot) ScreenshotMode(context.Context, *core.Document, string, float64, string) ([]byte, int, int, error) {
	return nil, 0, 0, errors.New("unused")
}

func (s styleShot) ComputedHTML(context.Context, string) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return s.html, nil
}

func TestImportHTMLComputed(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "import_html", obj("html", `<p class="x">a</p>`, "computed", true))
	if !isErr || !strings.Contains(out, "Chromium") {
		t.Fatalf("missing chromium: isErr=%v %q", isErr, out)
	}
	if s.Version() != 0 {
		t.Fatal("a refused computed import must not write")
	}

	m = NewMCP(s, "agent:test", styleShot{err: errors.New("browser crashed")})
	out, isErr = callText(t, m, "import_html", obj("html", `<p class="x">a</p>`, "computed", true))
	if !isErr || !strings.Contains(out, "browser crashed") {
		t.Fatalf("computer error: isErr=%v %q", isErr, out)
	}
	if s.Version() != 0 {
		t.Fatal("a failed computed import must not write")
	}

	m = NewMCP(s, "agent:test", styleShot{html: `<body><p style="color:#c43d27;font-size:20px">Olá</p></body>`})
	out, isErr = callText(t, m, "import_html", obj("html", `<p class="x">a</p>`, "computed", true))
	if isErr || !strings.Contains(out, "Chromium computed style") {
		t.Fatalf("computed: isErr=%v %q", isErr, out)
	}
	found := false
	for _, id := range core.Nodes(s.Doc()).Keys() {
		n := core.GetNode(s.Doc(), id)
		if n.Str("type") == "text" && n.Str("text") == "Olá" && n.Str("color") == "#c43d27" && n.Num("fontSize") == 20 {
			found = true
		}
	}
	if !found {
		t.Fatalf("styled text missing:\n%s", jsonv.Stringify(s.Doc(), "  "))
	}
}

func TestChromeComputedHTML(t *testing.T) {
	if FindChromium() == "" || chromiumProblem() != "" {
		t.Skip("Chromium not found")
	}
	c := &Chrome{}
	defer c.Close()
	baked, err := c.ComputedHTML(context.Background(), `<style>.card{display:flex;gap:8px;background:#abcdef;width:120px;padding:4px;color:#112233}</style><div class="card"><span>Oi</span></div>`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(baked, "card") && strings.Contains(baked, "class=") {
		t.Fatalf("class left in place: %s", baked)
	}
	r, err := core.ImportHTML(baked, core.ImportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Nodes) != 1 || r.Nodes[0].Str("type") != "frame" {
		t.Fatalf("frame: %s warnings %v", jsonv.Stringify(jsonv.NewObject("nodes", nodesAnyImport(r)), ""), r.Warnings)
	}
	frame := r.Nodes[0]
	if frame.Num("width") != 120 {
		t.Fatalf("width: %s", jsonv.Stringify(frame, ""))
	}
	layout := frame.Obj("layout")
	if layout == nil || layout.Str("mode") != "row" || layout.Num("gap") != 8 {
		t.Fatalf("layout: %s", jsonv.Stringify(frame, ""))
	}
	var text *jsonv.Object
	for _, ch := range frame.Arr("children") {
		n := ch.(*jsonv.Object)
		if n.Str("type") == "text" && n.Str("text") == "Oi" {
			text = n
		}
	}
	if text == nil || !strings.Contains(strings.ToLower(text.Str("color")), "112233") && !strings.Contains(text.Str("color"), "rgb(17, 34, 51)") {
		t.Fatalf("text color: %s", jsonv.Stringify(frame, ""))
	}
}

func nodesAnyImport(r core.ImportResult) []any {
	out := make([]any, len(r.Nodes))
	for i, n := range r.Nodes {
		out[i] = n
	}
	return out
}
