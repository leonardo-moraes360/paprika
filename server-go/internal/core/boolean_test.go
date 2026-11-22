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
