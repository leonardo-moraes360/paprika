package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func buttonTree(component bool) *jsonv.Object {
	n := obj("type", "frame", "id", "btn", "width", 120.0, "height", 40.0, "children", []any{
		obj("type", "text", "id", "lbl", "text", "OK", "width", 40.0, "height", 20.0, "bind", obj("text", "label")),
		obj("type", "frame", "id", "wrap", "width", 20.0, "height", 20.0, "children", []any{
			obj("type", "rect", "id", "fe-btn-press", "width", 8.0, "height", 8.0, "bind", obj("visible", "pressed")),
		}),
	})
	if component {
		n.Set("component", true)
		n.Set("componentProps", []any{
			obj("name", "label", "type", "text", "default", "OK"),
			obj("name", "pressed", "type", "boolean", "default", false),
		})
	}
	return n
}

func TestMCPBindInTheTransactionThatMakesTheComponent(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{buttonTree(false)}))
	if !isErr || !strings.Contains(out, `"lbl" has a bind outside a component: none of its ancestors is a component`) {
		t.Fatalf("plain tree: %q", out)
	}
	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{buttonTree(true)})); isErr {
		t.Fatalf("component tree: %q", out)
	}
	if !core.GetNode(s.Doc(), "btn").Bool("component") {
		t.Fatal("btn should be a component")
	}
}

func TestMCPDetachInstanceDropsBind(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "create_nodes", obj("nodes", []any{buttonTree(true)}))
	if out, isErr := callText(t, m, "create_instance", obj("componentId", "btn", "id", "i1", "propValues", obj("label", "Salvar", "pressed", true))); isErr {
		t.Fatalf("instance: %q", out)
	}
	lbl := core.CopyID("i1", "lbl")
	if !core.GetNode(s.Doc(), lbl).Has("bind") {
		t.Fatal("the copy should carry the bind before detaching")
	}
	if out, isErr := callText(t, m, "detach_instance", obj("ids", []any{"i1"})); isErr {
		t.Fatalf("detach: %q", out)
	}
	n := core.GetNode(s.Doc(), lbl)
	if n.Has("bind") || n.Has("sourceId") || n.Str("text") != "Salvar" || core.GetNode(s.Doc(), "i1").Has("instanceOf") {
		t.Fatalf("detached copy: %s", jsonv.Stringify(n, ""))
	}
	if !core.GetNode(s.Doc(), "btn").Bool("component") || !core.GetNode(s.Doc(), "lbl").Has("bind") {
		t.Fatal("the component keeps its bind")
	}
}

func TestMCPDetachTokensOnInstances(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "set_tokens", obj("tokens", obj("brand", "#c43d27", "alt", "#112233", "pad", 8.0)))
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "card", "component", true, "width", 100.0, "height", 40.0, "fill", "$brand",
			"layout", obj("mode", "row", "gap", "$pad"), "children", []any{
				obj("type", "text", "id", "t", "text", "x", "color", "$brand", "width", 10.0, "height", 10.0),
			}),
		obj("type", "frame", "id", "i1", "instanceOf", "card"),
	})); isErr {
		t.Fatalf("create: %q", out)
	}
	out, isErr := callText(t, m, "detach_tokens", obj("ids", []any{"i1", core.CopyID("i1", "t")}))
	if isErr || !strings.Contains(out, `"skipped"`) || !strings.Contains(out, `"layout"`) || !strings.Contains(out, `"color"`) {
		t.Fatalf("derived fields should be skipped, not fail: %v %q", isErr, out)
	}
	callText(t, m, "update_nodes", obj("updates", []any{
		obj("id", "i1", "props", obj("fill", "$alt")),
		obj("id", core.CopyID("i1", "t"), "props", obj("color", "$alt")),
	}))
	if out, isErr = callText(t, m, "detach_tokens", obj("ids", []any{"i1", core.CopyID("i1", "t")})); isErr {
		t.Fatalf("detach owned: %q", out)
	}
	if got := core.GetNode(s.Doc(), core.CopyID("i1", "t")).Str("color"); got != "#112233" {
		t.Fatalf("copy color: %q", got)
	}
	if got := core.GetNode(s.Doc(), "i1").Str("fill"); got != "#112233" {
		t.Fatalf("instance fill: %q", got)
	}
	if got := core.GetNode(s.Doc(), "i1").Obj("layout").Str("gap"); got != "$pad" {
		t.Fatalf("derived layout should stay on the component: %q", got)
	}
}
