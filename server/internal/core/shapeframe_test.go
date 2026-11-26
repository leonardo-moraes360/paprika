package core

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func shapeFrameDoc(t *testing.T) *Document {
	t.Helper()
	h := NewHistory(CreateDocument("T", "d"))
	ops := []any{
		jsonv.NewObject("op", "create", "parentId", nil, "node", jsonv.NewObject("type", "frame", "id", "board", "width", 600.0, "height", 400.0)),
		jsonv.NewObject("op", "create", "parentId", "board", "node", jsonv.NewObject("type", "rect", "id", "r", "x", 40.0, "y", 30.0, "width", 200.0, "height", 80.0, "radius", 12.0, "fill", "#cc3322",
			"stroke", jsonv.NewObject("color", "#000000", "width", 2.0))),
		jsonv.NewObject("op", "create", "parentId", "board", "node", jsonv.NewObject("type", "text", "id", "t", "x", 60.0, "y", 50.0, "text", "Salvar")),
		jsonv.NewObject("op", "create", "parentId", "board", "node", jsonv.NewObject("type", "ellipse", "id", "e", "x", 300.0, "y", 100.0, "width", 120.0, "height", 120.0, "radius", 5.0)),
		jsonv.NewObject("op", "create", "parentId", "board", "node", jsonv.NewObject("type", "path", "id", "p", "x", 340.0, "y", 140.0, "width", 10.0, "height", 10.0, "d", "M0 0 L10 0 L10 10 Z")),
	}
	if _, err := h.ApplyBatch(ops, "user", "", ""); err != nil {
		t.Fatal(err)
	}
	return h.Doc()
}

func TestConvertToFrameAdoptsAndUndoesExactly(t *testing.T) {
	doc := shapeFrameDoc(t)
	start := jsonv.Stringify(doc, "")
	for _, c := range []struct{ id, child string }{{"r", "t"}, {"e", "p"}} {
		res, err := ApplyOps(doc, []any{
			jsonv.NewObject("op", "convert_to_frame", "id", c.id, "adopt", []any{c.child}),
			jsonv.NewObject("op", "update", "id", c.id, "props", jsonv.NewObject("layout", jsonv.NewObject("mode", "row", "justify", "center", "align", "center", "padding", 0.0))),
		})
		if err != nil {
			t.Fatal(err)
		}
		n := GetNode(res.Doc, c.id)
		if n.Str("type") != "frame" || !n.Bool("clip") {
			t.Fatalf("%s: %s", c.id, jsonv.Stringify(n, ""))
		}
		if got := GetNode(res.Doc, c.child); got.Str("parentId") != c.id {
			t.Fatalf("%s not adopted: %s", c.child, jsonv.Stringify(got, ""))
		}
		if c.id == "e" && n.Num("radius") != 60 {
			t.Fatalf("ellipse radius %v", n.Num("radius"))
		}
		back, err := ApplyOps(res.Doc, res.Inverse)
		if err != nil {
			t.Fatal(err)
		}
		if got := jsonv.Stringify(back.Doc, ""); got != start {
			t.Fatalf("%s: undo differs\n%s\n%s", c.id, got, start)
		}
		redo, err := ApplyOps(back.Doc, back.Inverse)
		if err != nil {
			t.Fatal(err)
		}
		if jsonv.Stringify(redo.Doc, "") != jsonv.Stringify(res.Doc, "") {
			t.Fatalf("%s: redo differs", c.id)
		}
	}
}

func TestConvertToFrameRelativeCoordinatesAndStroke(t *testing.T) {
	doc := shapeFrameDoc(t)
	res, err := ApplyOps(doc, []any{jsonv.NewObject("op", "convert_to_frame", "id", "r", "adopt", []any{"t"})})
	if err != nil {
		t.Fatal(err)
	}
	child := GetNode(res.Doc, "t")
	if child.Num("x") != 18 || child.Num("y") != 18 {
		t.Fatalf("child at %v,%v, want 18,18 (offset by the 2px inside stroke)", child.Num("x"), child.Num("y"))
	}
	if kids := GetNode(res.Doc, "board").Strings("children"); strings.Join(kids, ",") != "r,e,p" {
		t.Fatalf("board children %v", kids)
	}
}

func TestConvertToFrameRefusals(t *testing.T) {
	doc := shapeFrameDoc(t)
	cases := []struct {
		op   *jsonv.Object
		want string
	}{
		{jsonv.NewObject("op", "convert_to_frame", "id", "board"), "only a rect or ellipse"},
		{jsonv.NewObject("op", "convert_to_frame", "id", "nope"), "does not exist"},
		{jsonv.NewObject("op", "convert_to_frame", "id", "r", "adopt", []any{"r"}), "cannot adopt itself"},
		{jsonv.NewObject("op", "convert_to_frame", "id", "r", "adopt", []any{"board"}), "not a sibling"},
		{jsonv.NewObject("op", "convert_to_shape", "id", "r", "shape", "rect"), "needs a frame"},
	}
	for _, c := range cases {
		if _, err := ApplyOps(doc, []any{c.op}); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want %q", jsonv.Stringify(c.op, ""), err, c.want)
		}
	}
	oval, err := ApplyOps(doc, []any{jsonv.NewObject("op", "update", "id", "e", "props", jsonv.NewObject("height", 100.0))})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyOps(oval.Doc, []any{jsonv.NewObject("op", "convert_to_frame", "id", "e")}); err == nil || !strings.Contains(err.Error(), "not a circle") {
		t.Errorf("oval: %v", err)
	}
	spun, err := ApplyOps(doc, []any{jsonv.NewObject("op", "update", "id", "r", "props", jsonv.NewObject("rotation", 10.0))})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyOps(spun.Doc, []any{jsonv.NewObject("op", "convert_to_frame", "id", "r", "adopt", []any{"t"})}); err == nil || !strings.Contains(err.Error(), "rotated") {
		t.Errorf("rotated: %v", err)
	}
}

func TestConvertToShapeOnlyPlainFrames(t *testing.T) {
	doc := shapeFrameDoc(t)
	res, err := ApplyOps(doc, []any{jsonv.NewObject("op", "convert_to_frame", "id", "r")})
	if err != nil {
		t.Fatal(err)
	}
	back, err := ApplyOps(res.Doc, []any{jsonv.NewObject("op", "convert_to_shape", "id", "r", "shape", "rect")})
	if err != nil {
		t.Fatal(err)
	}
	if jsonv.Stringify(back.Doc, "") != jsonv.Stringify(doc, "") {
		t.Fatal("round trip differs")
	}
	busy, err := ApplyOps(res.Doc, []any{jsonv.NewObject("op", "update", "id", "r", "props", jsonv.NewObject("layout", jsonv.NewObject("mode", "row")))})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyOps(busy.Doc, []any{jsonv.NewObject("op", "convert_to_shape", "id", "r", "shape", "rect")}); err == nil || !strings.Contains(err.Error(), "frame content") {
		t.Errorf("busy frame: %v", err)
	}
}
