package server

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/contract"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestPlaceContractMentionsPlace(t *testing.T) {
	v, err := jsonv.Parse(contract.MCP)
	if err != nil {
		t.Fatal(err)
	}
	root := v.(*jsonv.Object)
	if !strings.Contains(root.Str("instructions"), "Placement:") || !strings.Contains(root.Str("instructions"), `place:"free"`) {
		t.Fatal("instructions missing the placement rule")
	}
	if !strings.Contains(contract.GuidePtBR, "Posicionamento:") || !strings.Contains(contract.GuidePtBR, `place:"free"`) {
		t.Fatal("pt-BR guide missing the placement rule")
	}
	want := map[string]bool{
		"create_nodes": true, "duplicate_nodes": true, "import_svg": true,
		"import_html": true, "import_image": true, "import_document": true,
	}
	for _, tool := range root.Arr("tools") {
		o := tool.(*jsonv.Object)
		name := o.Str("name")
		if !want[name] {
			continue
		}
		if !strings.Contains(o.Str("description"), "place") {
			t.Fatalf("%s description does not mention place", name)
		}
		if o.Obj("inputSchema").Obj("properties").Obj("place") == nil {
			t.Fatalf("%s schema has no place", name)
		}
		delete(want, name)
	}
	if len(want) != 0 {
		t.Fatalf("missing tools %v", want)
	}
}

func TestPlaceFreeRowAndExactXY(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "a", "width", 200.0, "height", 100.0),
		obj("type", "frame", "id", "b", "width", 200.0, "height", 100.0),
	}))
	if isErr {
		t.Fatal(out)
	}
	if ax, ay := core.GetNode(s.Doc(), "a").Num("x"), core.GetNode(s.Doc(), "a").Num("y"); ax != 0 || ay != 0 {
		t.Fatalf("a at %v,%v", ax, ay)
	}
	if bx, by := core.GetNode(s.Doc(), "b").Num("x"), core.GetNode(s.Doc(), "b").Num("y"); bx != 280 || by != 0 {
		t.Fatalf("b at %v,%v", bx, by)
	}
	out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "rect", "id", "pin", "x", 12.0, "y", 34.0, "width", 10.0, "height", 10.0)}))
	if isErr {
		t.Fatal(out)
	}
	if x, y := core.GetNode(s.Doc(), "pin").Num("x"), core.GetNode(s.Doc(), "pin").Num("y"); x != 12 || y != 34 {
		t.Fatalf("explicit xy %v,%v", x, y)
	}
	out, isErr = callText(t, m, "get_bounds", obj())
	if isErr || !strings.Contains(out, `"next"`) || !strings.Contains(out, `"content"`) {
		t.Fatalf("bounds: %s", out)
	}
	out, isErr = callText(t, m, "get_document_outline", obj())
	if isErr || !strings.Contains(out, "content: x=0 y=0") || !strings.Contains(out, "next: x=") {
		t.Fatalf("outline: %s", out)
	}
}

func TestPlaceConcurrentWriters(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	var wg sync.WaitGroup
	errCh := make(chan string, 6)
	for g := range 2 {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := range 3 {
				r := m.CallTool(context.Background(), "create_nodes", obj("nodes", []any{
					obj("type", "frame", "name", fmt.Sprintf("f%d-%d", g, i), "width", 200.0, "height", 100.0),
				}), true)
				if r.Bool("isError") {
					errCh <- jsonv.Stringify(r, "")
				}
			}
		}(g)
	}
	wg.Wait()
	close(errCh)
	for e := range errCh {
		t.Fatal(e)
	}
	got := map[string]bool{}
	for _, id := range s.Doc().Strings("rootIds") {
		n := core.GetNode(s.Doc(), id)
		key := fmt.Sprintf("%g,%g", n.Num("x"), n.Num("y"))
		if got[key] {
			t.Fatalf("two frames share %s", key)
		}
		got[key] = true
	}
	for _, w := range []string{"0,0", "280,0", "560,0", "840,0", "1120,0", "1400,0"} {
		if !got[w] {
			t.Fatalf("missing %s in %v", w, got)
		}
	}
}

func TestPlaceDuplicateBesideAndOverlapWarning(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "board", "name", "Board", "x", 0.0, "y", 0.0, "width", 320.0, "height", 120.0, "fill", "#ffffff"),
	})); isErr {
		t.Fatal(out)
	}
	out, isErr := callText(t, m, "duplicate_nodes", obj("ids", []any{"board"}, "props", obj("mode", "dark", "name", "Board dark")))
	if isErr {
		t.Fatal(out)
	}
	parsed, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	id := parsed.(*jsonv.Object).Arr("copies")[0].(string)
	n := core.GetNode(s.Doc(), id)
	if n.Num("x") != 400 || n.Num("y") != 0 || n.Str("mode") != "dark" {
		t.Fatalf("copy: %s", jsonv.Stringify(n, ""))
	}
	out, isErr = callText(t, m, "create_nodes", obj("place", "none", "nodes", []any{
		obj("type", "frame", "id", "dark", "name", "Dark", "x", 40.0, "y", 40.0, "width", 320.0, "height", 120.0, "fill", "#111111"),
	}))
	if isErr || !strings.Contains(out, `overlaps \"Board\"`) || !strings.Contains(out, "nearest free spot") {
		t.Fatalf("warning: %s", out)
	}
}

func TestPlaceLintOverlapAndOverlay(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "card", "name", "Card", "x", 0.0, "y", 0.0, "width", 220.0, "height", 140.0, "fill", "#f4f1ea", "children", []any{
			obj("type", "text", "id", "label", "name", "Landing page", "text", "Landing page", "x", 16.0, "y", 16.0, "width", 120.0, "height", 24.0),
		}),
		obj("type", "frame", "id", "modal", "name", "Delete", "x", 8.0, "y", 8.0, "width", 200.0, "height", 100.0, "fill", "#ffffff"),
	}))
	if isErr {
		t.Fatal(out)
	}
	if out, isErr = callText(t, m, "update_nodes", obj("updates", []any{obj("id", "modal", "props", obj("index", "back"))})); isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "lint_design", obj())
	if isErr || !strings.Contains(out, "overlapping-boards") || !strings.Contains(out, "covered-by-overlay") || !strings.Contains(out, `index: \"front\"`) {
		t.Fatalf("lint: %s", out)
	}
}
