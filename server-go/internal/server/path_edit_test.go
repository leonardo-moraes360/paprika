package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestMCPEditPath(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)

	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "path", "id", "tri", "x", 100.0, "y", 50.0, "d", "M0 0 L10 0 L10 10",
	)}))
	if isErr {
		t.Fatal(out)
	}
	info, isErr := callText(t, m, "path_info", obj("id", "tri"))
	if isErr || !strings.Contains(info, `"index": 2`) || !strings.Contains(info, `"at": 1`) {
		t.Fatalf("path_info anchors: %v %s", isErr, info)
	}
	bare, isErr := callText(t, m, "path_info", obj("d", "M0 0 Q10 0 10 10"))
	if isErr || !strings.Contains(bare, `"in"`) || !strings.Contains(bare, `"out"`) {
		t.Fatalf("path_info d anchors: %v %s", isErr, bare)
	}

	out, isErr = callText(t, m, "edit_path", obj("id", "tri", "index", 0.0, "position", obj("x", -5.0, "y", -3.0)))
	if isErr {
		t.Fatalf("edit_path: %s", out)
	}
	if !strings.Contains(out, `"d": "M0 0 L15 3 L15 13"`) || !strings.Contains(out, `"x": 95`) || !strings.Contains(out, `"y": 47`) || !strings.Contains(out, `"width": 15`) {
		t.Fatalf("props: %s", out)
	}
	n := core.GetNode(s.Doc(), "tri")
	if n.Str("d") != "M0 0 L15 3 L15 13" || n.Num("x") != 95 || n.Num("y") != 47 || n.Num("width") != 15 || n.Num("height") != 13 {
		t.Fatalf("node: %s", core.DescribeNode(n))
	}
	again, _ := callText(t, m, "path_info", obj("id", "tri"))
	if !strings.Contains(again, `"x": 15`) || !strings.Contains(again, `"y": 13`) {
		t.Fatalf("anchors after edit: %s", again)
	}
	hist, _ := callText(t, m, "get_history", obj("limit", 1.0))
	if !strings.Contains(hist, `"label": "move point"`) {
		t.Fatalf("history: %s", hist)
	}

	out, isErr = callText(t, m, "edit_path", obj(
		"id", "tri", "index", 1.0,
		"handles", obj("out", obj("x", 20.0, "y", 3.0), "mirror", false),
	))
	if isErr {
		t.Fatalf("handle: %s", out)
	}
	hist, _ = callText(t, m, "get_history", obj("limit", 1.0))
	if !strings.Contains(hist, `"label": "move handle"`) {
		t.Fatalf("handle history: %s", hist)
	}

	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if core.GetNode(s.Doc(), "tri").Str("d") != "M0 0 L10 0 L10 10" {
		t.Fatalf("undo: %s", core.GetNode(s.Doc(), "tri").Str("d"))
	}

	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "row", "width", 200.0, "height", 80.0, "layout", obj("mode", "row"), "children", []any{
			obj("type", "path", "id", "flow", "x", 10.0, "y", 20.0, "d", "M0 0 L10 0"),
		}),
		obj("type", "path", "id", "icon", "x", 8.0, "y", 8.0, "width", 24.0, "height", 24.0, "viewBox", []any{0.0, 0.0, 24.0, 24.0}, "d", "M-2 0 L30 0"),
		obj("type", "path", "id", "lockd", "locked", true, "d", "M0 0 L1 0"),
		obj("type", "rect", "id", "box"),
	})); isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "edit_path", obj("id", "flow", "index", 0.0, "position", obj("x", -5.0, "y", 0.0)))
	if isErr {
		t.Fatalf("flow: %s", out)
	}
	flow := core.GetNode(s.Doc(), "flow")
	if flow.Num("x") != 10 || flow.Num("y") != 20 || flow.Str("d") != "M0 0 L15 0" || flow.Num("width") != 15 {
		t.Fatalf("flow node: d=%s x=%v y=%v w=%v", flow.Str("d"), flow.Num("x"), flow.Num("y"), flow.Num("width"))
	}
	out, isErr = callText(t, m, "edit_path", obj("id", "icon", "index", 1.0, "position", obj("x", 40.0, "y", 2.0)))
	if isErr {
		t.Fatalf("viewBox: %s", out)
	}
	icon := core.GetNode(s.Doc(), "icon")
	if icon.Str("d") != "M-2 0 L40 2" || icon.Num("x") != 8 || icon.Num("width") != 24 {
		t.Fatalf("viewBox node: d=%s x=%v w=%v", icon.Str("d"), icon.Num("x"), icon.Num("width"))
	}

	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "path", "id", "bend", "x", 0.0, "y", 0.0,
		"d", "M0 0 C0 0 5 10 10 10 C15 10 20 0 20 0",
	)})); isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "edit_path", obj(
		"id", "bend", "index", 1.0,
		"position", obj("x", 10.0, "y", 20.0),
		"handles", obj("out", obj("x", 10.0, "y", 20.0), "mirror", false),
	))
	if isErr || !strings.Contains(out, `"d": "M0 0 C0 0 5 20 10 20 C10 20 20 0 20 0"`) {
		t.Fatalf("anchor then handle: %v %s", isErr, out)
	}

	for _, c := range []struct {
		args *jsonv.Object
		want string
	}{
		{obj("id", "missing", "index", 0.0, "position", obj("x", 0.0, "y", 0.0)), `node "missing" does not exist`},
		{obj("id", "box", "index", 0.0, "position", obj("x", 0.0, "y", 0.0)), `not a path`},
		{obj("id", "lockd", "index", 0.0, "position", obj("x", 0.0, "y", 0.0)), `is locked`},
		{obj("id", "tri", "index", 9.0, "position", obj("x", 0.0, "y", 0.0)), `out of range`},
		{obj("id", "tri", "index", 0.0), `pass position or handles`},
		{obj("id", "tri", "index", 0.0, "handles", obj("mirror", true)), `handles needs in or out`},
	} {
		msg, bad := callText(t, m, "edit_path", c.args)
		if !bad || !strings.Contains(msg, c.want) {
			t.Fatalf("want %q in error, got %v %q", c.want, bad, msg)
		}
	}

	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "frame", "id", "cmp", "width", 40.0, "height", 40.0,
		"children", []any{obj("type", "path", "id", "srcp", "d", "M0 0 L10 0")},
	)})); isErr {
		t.Fatal(out)
	}
	if out, isErr = callText(t, m, "create_component", obj("id", "cmp")); isErr {
		t.Fatal(out)
	}
	if out, isErr = callText(t, m, "create_instance", obj("componentId", "cmp", "id", "inst")); isErr {
		t.Fatal(out)
	}
	copyID := core.CopyID("inst", "srcp")
	out, isErr = callText(t, m, "edit_path", obj("id", copyID, "index", 0.0, "position", obj("x", 1.0, "y", 1.0)))
	if !isErr || !strings.Contains(out, "copy inside the instance") {
		t.Fatalf("instance copy: %v %s", isErr, out)
	}
}
