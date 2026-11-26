package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

func TestPlaceReferenceUnderFrame(t *testing.T) {
	m, s, dir := importImageSetup(t)
	if _, err := s.Apply([]any{obj("op", "create", "node", obj(
		"type", "frame", "id", "screen", "name", "Screen", "width", 200.0, "height", 120.0,
		"children", []any{obj("type", "rect", "id", "btn", "x", 10.0, "y", 10.0, "width", 40.0, "height", 20.0)},
	))}, "test", "frame"); err != nil {
		t.Fatal(err)
	}
	r := m.CallTool(t.Context(), "place_reference", obj("src", filepath.Join(dir, "pixel.png"), "frameId", "screen"), true)
	if r.Bool("isError") {
		t.Fatalf("error: %s", r.Str("content"))
	}
	out := r.Obj("structuredContent")
	if !out.Bool("locked") || out.Num("opacity") != 0.5 || out.Str("frameId") != "screen" {
		t.Fatalf("result = %v", out)
	}
	if out.Num("width") != 160 || out.Num("height") != 120 || out.Num("x") != 20 || out.Num("y") != 0 {
		t.Fatalf("box = %v", out)
	}
	frame := core.GetNode(s.Doc(), "screen")
	kids := frame.Strings("children")
	if len(kids) < 2 || kids[0] != out.Str("id") {
		t.Fatalf("children = %v", kids)
	}
	node := core.GetNode(s.Doc(), out.Str("id"))
	if node.Str("type") != "image" || !node.Bool("locked") || node.Num("opacity") != 0.5 || node.Str("layoutPositioning") != "absolute" || node.Str("name") != "Reference" {
		t.Fatalf("node = %v", node)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "pixel.png"))
	if err != nil {
		t.Fatal(err)
	}
	if node.Str("src") == "" || len(node.Str("src")) < len(raw) {
		t.Fatal("src missing")
	}
	bad := m.CallTool(t.Context(), "place_reference", obj("src", filepath.Join(dir, "pixel.png"), "frameId", "btn"), true)
	if !bad.Bool("isError") {
		t.Fatal("expected a non-frame error")
	}
	missing := m.CallTool(t.Context(), "place_reference", obj("src", filepath.Join(dir, "pixel.png"), "frameId", "nope"), true)
	if !missing.Bool("isError") {
		t.Fatal("expected a missing-node error")
	}
}
