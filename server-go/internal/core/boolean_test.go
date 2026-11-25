package core

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestBooleanRingsIntersect(t *testing.T) {
	a := []boolRing{{{0, 0}, {100, 0}, {100, 100}, {0, 100}}}
	b := []boolRing{{{50, 50}, {150, 50}, {150, 150}, {50, 150}}}
	r := BooleanRings(a, b, BoolIntersect)
	if len(r) == 0 {
		t.Fatal("expected intersection ring")
	}
}

func TestCombinePathsUnion(t *testing.T) {
	doc := CreateDocument("T", "doc")
	r, err := ApplyOps(doc, []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject(
			"type", "frame", "id", "f", "width", 400.0, "height", 300.0,
			"children", []any{
				jsonv.NewObject("type", "rect", "id", "a", "x", 10.0, "y", 10.0, "width", 100.0, "height", 100.0, "fill", "#c43d27"),
				jsonv.NewObject("type", "rect", "id", "b", "x", 60.0, "y", 60.0, "width", 100.0, "height", 100.0, "fill", "#1e2336"),
			},
		)),
	})
	if err != nil {
		t.Fatal(err)
	}
	out, err := ApplyOps(r.Doc, []any{
		jsonv.NewObject("op", "combine_paths", "ids", []any{"a", "b"}, "operation", "union", "id", "u"),
	})
	if err != nil {
		t.Fatal(err)
	}
	u := GetNode(out.Doc, "u")
	if u == nil || u.Str("type") != "path" {
		t.Fatalf("expected path u, got %v", u)
	}
	if u.Str("fill") != "#c43d27" {
		t.Fatalf("expected bottom fill, got %s", u.Str("fill"))
	}
	if GetNode(out.Doc, "a") != nil || GetNode(out.Doc, "b") != nil {
		t.Fatal("sources should be deleted")
	}
}

func TestCombinePathsSubtractRing(t *testing.T) {
	doc := CreateDocument("T", "doc")
	r, err := ApplyOps(doc, []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject(
			"type", "frame", "id", "f", "width", 200.0, "height", 200.0,
			"children", []any{
				jsonv.NewObject("type", "rect", "id", "outer", "x", 0.0, "y", 0.0, "width", 100.0, "height", 100.0, "fill", "#c43d27"),
				jsonv.NewObject("type", "rect", "id", "inner", "x", 25.0, "y", 25.0, "width", 50.0, "height", 50.0, "fill", "#000"),
			},
		)),
	})
	if err != nil {
		t.Fatal(err)
	}
	out, err := ApplyOps(r.Doc, []any{
		jsonv.NewObject("op", "combine_paths", "ids", []any{"outer", "inner"}, "operation", "subtract", "id", "ring"),
	})
	if err != nil {
		t.Fatal(err)
	}
	n := GetNode(out.Doc, "ring")
	if n == nil || n.Str("type") != "path" {
		t.Fatal("expected ring path")
	}
	d := n.Str("d")
	if strings.Count(d, "Z") < 2 {
		t.Fatalf("expected outer+hole, d=%s", d)
	}
}

func TestCombinePathsDisjoint(t *testing.T) {
	doc := CreateDocument("T", "doc")
	r, err := ApplyOps(doc, []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject(
			"type", "frame", "id", "f", "width", 400.0, "height", 200.0,
			"children", []any{
				jsonv.NewObject("type", "rect", "id", "a", "x", 0.0, "y", 0.0, "width", 40.0, "height", 40.0, "fill", "#c43d27"),
				jsonv.NewObject("type", "ellipse", "id", "b", "x", 200.0, "y", 20.0, "width", 40.0, "height", 40.0, "fill", "#1e2336"),
			},
		)),
	})
	if err != nil {
		t.Fatal(err)
	}
	out, err := ApplyOps(r.Doc, []any{
		jsonv.NewObject("op", "combine_paths", "ids", []any{"a", "b"}, "operation", "union", "id", "u"),
	})
	if err != nil {
		t.Fatal(err)
	}
	u := GetNode(out.Doc, "u")
	if u == nil || u.Str("type") != "path" {
		t.Fatal("expected path")
	}
	if strings.Count(u.Str("d"), "Z") < 2 {
		t.Fatalf("expected two contours, d=%s", u.Str("d"))
	}
}

func TestCombinePathsRotated(t *testing.T) {
	doc := CreateDocument("T", "doc")
	r, err := ApplyOps(doc, []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject(
			"type", "frame", "id", "f", "width", 300.0, "height", 300.0,
			"children", []any{
				jsonv.NewObject("type", "rect", "id", "a", "x", 40.0, "y", 40.0, "width", 80.0, "height", 80.0, "fill", "#c43d27"),
				jsonv.NewObject("type", "rect", "id", "b", "x", 70.0, "y", 70.0, "width", 80.0, "height", 80.0, "rotation", 45.0, "fill", "#1e2336"),
			},
		)),
	})
	if err != nil {
		t.Fatal(err)
	}
	out, err := ApplyOps(r.Doc, []any{
		jsonv.NewObject("op", "combine_paths", "ids", []any{"a", "b"}, "operation", "union", "id", "u"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if GetNode(out.Doc, "u") == nil || GetNode(out.Doc, "u").Str("type") != "path" {
		t.Fatal("expected rotated union path")
	}
}

func TestCombinePathsRejects(t *testing.T) {
	doc := CreateDocument("T", "doc")
	r, err := ApplyOps(doc, []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject("type", "rect", "id", "a", "width", 10.0, "height", 10.0)),
		jsonv.NewObject("op", "create", "node", jsonv.NewObject("type", "frame", "id", "f", "width", 10.0, "height", 10.0)),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ApplyOps(r.Doc, []any{
		jsonv.NewObject("op", "combine_paths", "ids", []any{"a", "f"}, "operation", "union"),
	})
	if err == nil || !strings.Contains(err.Error(), "path, rect, ellipse or shape") {
		t.Fatalf("expected type error, got %v", err)
	}
}

func combineScene(t *testing.T) *Document {
	t.Helper()
	r, err := ApplyOps(CreateDocument("T", "doc"), []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject(
			"type", "frame", "id", "f", "width", 400.0, "height", 300.0,
			"children", []any{
				jsonv.NewObject("type", "ellipse", "id", "disc", "x", 0.0, "y", 0.0, "width", 100.0, "height", 100.0, "fill", "#c43d27"),
				jsonv.NewObject("type", "rect", "id", "dome", "x", 20.0, "y", 0.0, "width", 60.0, "height", 40.0, "fill", "#1e2336",
					"gradient", jsonv.NewObject("type", "linear", "angle", 90.0, "stops", []any{
						jsonv.NewObject("color", "#ffffff", "offset", 0.0), jsonv.NewObject("color", "#000000", "offset", 1.0)})),
				jsonv.NewObject("type", "ellipse", "id", "hole", "x", 30.0, "y", 30.0, "width", 40.0, "height", 40.0, "fill", "#000000"),
			},
		)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return r.Doc
}

func TestCombinePathsBatchRing(t *testing.T) {
	doc := combineScene(t)
	out, err := ApplyOps(doc, []any{jsonv.NewObject("op", "combine_paths", "id", "ring", "name", "Ring", "operations", []any{
		jsonv.NewObject("op", "union", "ids", []any{"disc", "dome"}, "as", "body"),
		jsonv.NewObject("op", "subtract", "ids", []any{"body", "hole"}),
	})})
	if err != nil {
		t.Fatal(err)
	}
	n := GetNode(out.Doc, "ring")
	if n == nil || n.Str("type") != "path" || n.Str("fill") != "#c43d27" || n.Str("name") != "Ring" || n.Str("fillRule") != "evenodd" {
		t.Fatalf("unexpected ring %v", n)
	}
	if strings.Count(n.Str("d"), "Z") < 2 {
		t.Fatalf("expected outer + hole, d=%s", n.Str("d"))
	}
	for _, id := range []string{"disc", "dome", "hole"} {
		if GetNode(out.Doc, id) != nil {
			t.Fatalf("%s should be deleted", id)
		}
	}
}

func TestCombinePathsStyleChoices(t *testing.T) {
	doc := combineScene(t)
	run := func(style any) *Node {
		t.Helper()
		op := jsonv.NewObject("op", "combine_paths", "ids", []any{"hole", "disc", "dome"}, "operation", "union", "id", "o")
		if style != nil {
			op.Set("style", style)
		}
		out, err := ApplyOps(doc, []any{op})
		if err != nil {
			t.Fatal(err)
		}
		return GetNode(out.Doc, "o")
	}
	if got := run(nil).Str("fill"); got != "#c43d27" {
		t.Fatalf("default should be bottom, got %s", got)
	}
	if got := run("top").Str("fill"); got != "#000000" {
		t.Fatalf("top: %s", got)
	}
	if got := run("first").Str("fill"); got != "#000000" { // ids[0] is hole
		t.Fatalf("first: %s", got)
	}
	if got := run("last"); got.Str("fill") != "#1e2336" || !got.Has("gradient") {
		t.Fatalf("last: %v", got)
	}
	if got := run(jsonv.NewObject("from", "dome", "opacity", 0.25)); got.Num("opacity") != 0.25 || !got.Has("gradient") {
		t.Fatalf("from+opacity: %v", got)
	}
	if got := run(jsonv.NewObject("from", "dome", "fill", "#abcdef")); got.Str("fill") != "#abcdef" || got.Has("gradient") {
		t.Fatalf("fill override should drop the copied gradient: %v", got)
	}
}

func TestCombinePathsBatchErrors(t *testing.T) {
	doc := combineScene(t)
	cases := []struct {
		op   *jsonv.Object
		want string
	}{
		{jsonv.NewObject("op", "combine_paths"), "ids + operation, or operations"},
		{jsonv.NewObject("op", "combine_paths", "ids", []any{"disc", "dome"}, "operation", "union", "operations", []any{jsonv.NewObject("op", "union", "ids", []any{"disc", "dome"})}), "not both"},
		{jsonv.NewObject("op", "combine_paths", "operations", []any{
			jsonv.NewObject("op", "union", "ids", []any{"disc", "dome"}, "as", "u"),
			jsonv.NewObject("op", "subtract", "ids", []any{"u", "nope"}),
		}), "operations[1] (subtract): nodes do not exist: nope"},
		{jsonv.NewObject("op", "combine_paths", "operations", []any{
			jsonv.NewObject("op", "union", "ids", []any{"disc", "dome"}, "as", "disc"),
		}), `operations[0] (union): "as" name "disc" is already a node id`},
		{jsonv.NewObject("op", "combine_paths", "operations", []any{
			jsonv.NewObject("op", "union", "ids", []any{"disc", "dome"}, "as", "u"),
			jsonv.NewObject("op", "subtract", "ids", []any{"hole", "u"}),
		}), "operations[1] (subtract): boolean subtract produced an empty path"},
		{jsonv.NewObject("op", "combine_paths", "ids", []any{"disc", "dome"}, "operation", "union", "style", jsonv.NewObject("from", "zz")), `style.from "zz" does not exist`},
	}
	for _, c := range cases {
		_, err := ApplyOps(doc, []any{c.op})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("want error containing %q, got %v", c.want, err)
		}
	}
}
