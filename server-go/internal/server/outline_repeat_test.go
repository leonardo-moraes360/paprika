package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestMCPOutlineStroke(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	node := obj("type", "path", "id", "ln", "x", 100.0, "y", 50.0, "width", 100.0, "height", 0.0, "d", "M0 0 L100 0",
		"stroke", obj("color", "#112233", "width", 10.0), "strokeCap", "butt")
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{node})); isErr {
		t.Fatal(out)
	}
	out, isErr := callText(t, m, "outline_stroke", obj("id", "ln"))
	if isErr || !strings.Contains(out, `"id": "ln"`) || !strings.Contains(out, `"height": 10`) {
		t.Fatalf("outline: %v %s", isErr, out)
	}
	n := core.GetNode(s.Doc(), "ln")
	if n.Str("fill") != "#112233" || n.Has("stroke") || n.Num("y") != 45 || n.Str("d") != "M0 10 L100 10 L100 0 L0 0 Z" {
		t.Fatalf("node: %s", core.DescribeNode(n))
	}
	// One undo step restores the stroke.
	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if n = core.GetNode(s.Doc(), "ln"); !n.Has("stroke") || n.Has("fill") || n.Str("d") != "M0 0 L100 0" {
		t.Fatalf("undo: %s", core.DescribeNode(n))
	}
	// keepStroke leaves the stroke; a filled node is refused.
	if out, isErr = callText(t, m, "outline_stroke", obj("id", "ln", "keepStroke", true)); isErr {
		t.Fatal(out)
	}
	if !core.GetNode(s.Doc(), "ln").Has("stroke") {
		t.Fatal("keepStroke should keep the stroke")
	}
	out, isErr = callText(t, m, "outline_stroke", obj("id", "ln"))
	if !isErr || !strings.Contains(out, "fill besides the stroke") {
		t.Fatalf("filled node: %v %s", isErr, out)
	}
	out, isErr = callText(t, m, "outline_stroke", obj("id", "nope"))
	if !isErr || !strings.Contains(out, "does not exist") {
		t.Fatalf("missing: %v %s", isErr, out)
	}
}

func TestMCPRepeatNodes(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	frame := obj("type", "frame", "id", "f", "x", 0.0, "y", 0.0, "width", 400.0, "height", 400.0, "children", []any{
		obj("type", "rect", "id", "a", "x", 190.0, "y", 40.0, "width", 20.0, "height", 20.0, "fill", "#ff0000"),
	})
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{frame})); isErr {
		t.Fatal(out)
	}
	out, isErr := callText(t, m, "repeat_nodes", obj("id", "a", "count", 4.0, "mode", "radial", "rotate", true))
	if isErr || !strings.Contains(out, `"copies"`) {
		t.Fatalf("radial: %v %s", isErr, out)
	}
	f := core.GetNode(s.Doc(), "f")
	kids := f.Strings("children")
	if len(kids) != 4 {
		t.Fatalf("children: %v", kids)
	}
	last := core.GetNode(s.Doc(), kids[3])
	if last.Num("x") != 40 || last.Num("y") != 190 || last.Num("rotation") != 270 {
		t.Fatalf("last copy: %s", core.DescribeNode(last))
	}
	// One undo step removes every copy.
	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if len(core.GetNode(s.Doc(), "f").Strings("children")) != 1 {
		t.Fatal("undo should remove all copies")
	}
	for _, bad := range []*struct {
		args *jsonv.Object
		want string
	}{
		{obj("id", "a", "count", 3.0, "mode", "linear"), "needs step"},
		{obj("id", "a", "count", 3.0, "mode", "grid", "columns", 2.0, "rows", 1.0), "hold 2 nodes"},
		{obj("id", "f", "count", 3.0, "mode", "radial"), "sized frame"},
	} {
		out, isErr = callText(t, m, "repeat_nodes", bad.args)
		if !isErr || !strings.Contains(out, bad.want) {
			t.Fatalf("want %q: %v %s", bad.want, isErr, out)
		}
	}
}
