package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestMCPRoundPathCorners(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)

	// Pure mode: nothing is written.
	out, isErr := callText(t, m, "round_path_corners", obj("d", "M0 0 L100 0 L100 100 L0 100 Z", "radius", 10.0))
	if isErr || !strings.Contains(out, `"d": "M10 0 L90 0 A10 10 0 0 1 100 10`) || !strings.Contains(out, `"width": 100`) {
		t.Fatalf("pure: %v %s", isErr, out)
	}
	if strings.Contains(out, "version") {
		t.Fatalf("pure mode must not write: %s", out)
	}

	// With an id: updates d, keeps the box.
	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "path", "id", "sq", "x", 5.0, "y", 6.0, "d", "M0 0 L40 0 L40 40 L0 40 Z", "fill", "#000")})); isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "round_path_corners", obj("id", "sq", "radii", []any{0.0, 10.0, nil, 99.0}))
	if isErr || !strings.Contains(out, `"version"`) {
		t.Fatalf("by id: %v %s", isErr, out)
	}
	n := core.GetNode(s.Doc(), "sq")
	if !strings.HasPrefix(n.Str("d"), "M0 0 L30 0 A10 10 0 0 1 40 10") || n.Num("x") != 5 || n.Num("width") != 40 {
		t.Fatalf("node: %s", core.DescribeNode(n))
	}
	if !strings.Contains(n.Str("d"), "A20 20 0 0 1 0 20") {
		t.Fatalf("a radius larger than half the edge is clamped to 20: %s", n.Str("d"))
	}

	for _, bad := range []*struct {
		args *jsonv.Object
		want string
	}{
		{obj("d", "M0 0 C1 1 2 2 3 3", "radius", 2.0), "straight edges"},
		{obj("d", "M0 0 L1 1"), "pass radius"},
		{obj("radius", 2.0), "pass d or id"},
		{obj("id", "nope", "radius", 2.0), "does not exist"},
	} {
		out, isErr = callText(t, m, "round_path_corners", bad.args)
		if !isErr || !strings.Contains(out, bad.want) {
			t.Fatalf("want %q: %v %s", bad.want, isErr, out)
		}
	}
}

func TestMCPCreateShapePath(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)

	out, isErr := callText(t, m, "create_shape_path", obj("kind", "ring", "id", "rg", "x", 100.0, "y", 80.0, "radius", 50.0, "thickness", 10.0, "props", obj("fill", "#c43d27")))
	if isErr {
		t.Fatal(out)
	}
	n := core.GetNode(s.Doc(), "rg")
	if n.Str("type") != "path" || n.Str("fillRule") != "evenodd" || n.Num("width") != 100 || n.Num("x") != 50 || n.Num("y") != 30 {
		t.Fatalf("ring node (x, y are the center): %s", core.DescribeNode(n))
	}

	out, isErr = callText(t, m, "create_shape_path", obj("kind", "star", "id", "st", "x", 0.0, "y", 0.0, "points", 5.0, "radius", 40.0, "cornerRadius", 3.0))
	if isErr {
		t.Fatal(out)
	}
	st := core.GetNode(s.Doc(), "st")
	if st.Str("fill") != "#000000" || !strings.Contains(st.Str("d"), "A") {
		t.Fatalf("star: %s", core.DescribeNode(st))
	}

	// One undo step per call.
	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if core.GetNode(s.Doc(), "st") != nil || core.GetNode(s.Doc(), "rg") == nil {
		t.Fatal("undo should remove only the star")
	}

	for _, bad := range []*struct {
		args *jsonv.Object
		want string
	}{
		{obj("kind", "star", "radius", 10.0), "points is required"},
		{obj("kind", "ring", "radius", 10.0, "thickness", 10.0), "hole radius"},
		{obj("kind", "polygon", "sides", 5.0, "radius", 10.0, "props", obj("d", "M0 0")), "props.d"},
		{obj("kind", "sector", "radius", 10.0, "startAngle", 3.0, "endAngle", 3.0), "empty"},
	} {
		out, isErr = callText(t, m, "create_shape_path", bad.args)
		if !isErr || !strings.Contains(out, bad.want) {
			t.Fatalf("want %q: %v %s", bad.want, isErr, out)
		}
	}
}
