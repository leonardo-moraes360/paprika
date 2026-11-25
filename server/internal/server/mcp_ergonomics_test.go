package server

import (
	"context"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func structured(t *testing.T, m *MCP, name string, args *jsonv.Object) *jsonv.Object {
	t.Helper()
	r := m.CallTool(context.Background(), name, args, true)
	if r.Bool("isError") {
		t.Fatalf("%s: %v", name, callTextJoin(r))
	}
	o, ok := r.Get("structuredContent")
	if !ok {
		t.Fatalf("%s: no structuredContent", name)
	}
	return o.(*jsonv.Object)
}

func TestFindNodesStructuredAndExact(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "capa", "name", "Capa · X", "x", 0.0, "y", 0.0, "width", 200.0, "height", 100.0, "children", []any{
			obj("type", "text", "id", "t", "name", "Titulo", "text", "oi", "x", 4.0, "y", 6.0),
		}),
		obj("type", "frame", "id", "claro", "name", "Capa · X · claro", "x", 300.0, "y", 0.0, "width", 200.0, "height", 100.0),
	}))
	if isErr {
		t.Fatal(out)
	}
	sub := structured(t, m, "find_nodes", obj("name", "capa · x"))
	if len(sub.Arr("nodes")) != 2 || sub.Bool("truncated") {
		t.Fatalf("substring: %v", jsonv.Stringify(sub, ""))
	}
	exact := structured(t, m, "find_nodes", obj("name", "Capa · X", "exact", true))
	nodes := exact.Arr("nodes")
	if len(nodes) != 1 {
		t.Fatalf("exact: %v", jsonv.Stringify(exact, ""))
	}
	n := nodes[0].(*jsonv.Object)
	if n.Str("id") != "capa" || n.Str("type") != "frame" || n.Str("name") != "Capa · X" || n.Num("width") != 200 || n.Num("height") != 100 {
		t.Fatalf("node: %v", jsonv.Stringify(n, ""))
	}
	if v, ok := n.Get("parentId"); !ok || v != nil {
		t.Fatalf("parentId: %v %v", v, ok)
	}
	if none := structured(t, m, "find_nodes", obj("name", "capa · x", "exact", true)); len(none.Arr("nodes")) != 0 {
		t.Fatalf("exact is case-sensitive: %v", jsonv.Stringify(none, ""))
	}
	child := structured(t, m, "find_nodes", obj("type", "text"))
	if c := child.Arr("nodes")[0].(*jsonv.Object); c.Str("parentId") != "capa" || c.Num("x") != 4 {
		t.Fatalf("child: %v", jsonv.Stringify(c, ""))
	}
	cut := structured(t, m, "find_nodes", obj("type", "frame", "limit", 1.0))
	if len(cut.Arr("nodes")) != 1 || !cut.Bool("truncated") {
		t.Fatalf("limit: %v", jsonv.Stringify(cut, ""))
	}
	text, _ := callText(t, m, "find_nodes", obj("name", "Capa · X", "exact", true))
	if !strings.HasPrefix(text, "frame#capa ") || strings.Contains(text, "claro") {
		t.Fatalf("text: %q", text)
	}
	empty := structured(t, m, "find_nodes", obj("name", "nada"))
	if len(empty.Arr("nodes")) != 0 || empty.Bool("truncated") {
		t.Fatalf("empty: %v", jsonv.Stringify(empty, ""))
	}
	if msg, isErr := callText(t, m, "find_nodes", obj("exact", true)); !isErr || !strings.Contains(msg, "exact needs name") {
		t.Fatalf("exact without name: %q", msg)
	}
}

func TestLintDesignIssuesAndIgnoreRules(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "box", "name", "Box", "x", 0.0, "y", 0.0, "fill", "#ffffff",
			"layout", obj("mode", "row", "gap", 8.0),
			"children", []any{
				obj("type", "rect", "width", 80.0, "height", 40.0, "fill", "#111111"),
				obj("type", "rect", "width", 80.0, "height", 40.0, "fill", "#111111"),
			}),
	}))
	if isErr {
		t.Fatal(out)
	}
	full := structured(t, m, "lint_design", obj("rootId", "box"))
	if len(full.Arr("issues")) == 0 || len(full.Arr("groups")) == 0 {
		t.Fatalf("full: %v", jsonv.Stringify(full, ""))
	}
	rule := full.Arr("groups")[0].(*jsonv.Object).Str("rule")
	groupsOnly := structured(t, m, "lint_design", obj("rootId", "box", "issues", false))
	if groupsOnly.Has("issues") || len(groupsOnly.Arr("groups")) != len(full.Arr("groups")) {
		t.Fatalf("issues false: %v", jsonv.Stringify(groupsOnly, ""))
	}
	skipped := structured(t, m, "lint_design", obj("rootId", "box", "ignoreRules", []any{rule}))
	for _, g := range skipped.Arr("groups") {
		if g.(*jsonv.Object).Str("rule") == rule {
			t.Fatalf("rule %s still grouped", rule)
		}
	}
	for _, i := range skipped.Arr("issues") {
		if i.(*jsonv.Object).Str("rule") == rule {
			t.Fatalf("rule %s still listed", rule)
		}
	}
	if len(skipped.Arr("issues")) >= len(full.Arr("issues")) {
		t.Fatalf("nothing skipped: %d vs %d", len(skipped.Arr("issues")), len(full.Arr("issues")))
	}
	counts := skipped.Obj("counts")
	if int(counts.Num("error")+counts.Num("warning")+counts.Num("info")) != len(skipped.Arr("issues")) {
		t.Fatalf("counts do not follow the filter: %v", jsonv.Stringify(skipped, ""))
	}
}
