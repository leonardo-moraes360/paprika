package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
)

func TestTypedTokensPersistAndDetach(t *testing.T) {
	s, path := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "set_tokens", obj("tokens", obj("ink", "#111111"), "type", "color", "collection", "brand"))
	if isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "set_tokens", obj("tokens", obj("peso", 600.0), "type", "fontWeight"))
	if isErr {
		t.Fatal(out)
	}
	out, isErr = callText(t, m, "set_tokens", obj("tokens", obj("ink", 12.0), "type", "color"))
	if !isErr || !strings.Contains(out, "type color expects a color") {
		t.Fatalf("bad type: %v %q", isErr, out)
	}
	out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "text", "id", "tok", "text", "Aa", "color", "$ink", "fontWeight", "$peso")}))
	if isErr {
		t.Fatal(out)
	}
	outline, isErr := callText(t, m, "get_document_outline", obj())
	if isErr || !strings.Contains(outline, "$ink=#111111 color @brand") || !strings.Contains(outline, "$peso=600 fontWeight") {
		t.Fatalf("outline: %v %q", isErr, outline)
	}
	out, isErr = callText(t, m, "detach_tokens", obj("ids", []any{"tok"}, "fields", []any{"fontWeight"}))
	if isErr {
		t.Fatal(out)
	}
	node := core.GetNode(s.Doc(), "tok")
	if node.Num("fontWeight") != 600 || node.Str("color") != "$ink" {
		t.Fatalf("partial detach: %s", node)
	}
	out, isErr = callText(t, m, "detach_tokens", obj("ids", []any{"tok"}))
	if isErr {
		t.Fatal(out)
	}
	if core.GetNode(s.Doc(), "tok").Str("color") != "#111111" {
		t.Fatalf("full detach: %s", core.GetNode(s.Doc(), "tok"))
	}
	reloaded, err := OpenStore(path, OpenOptions{Poll: -1, DocID: s.DocID()})
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.Close()
	meta := core.TokenMeta(reloaded.Doc())
	ink := meta.Obj("ink")
	if ink == nil || ink.Str("type") != "color" || ink.Str("collection") != "brand" {
		t.Fatalf("meta not reloaded: %v", meta)
	}
	if meta.Obj("peso").Str("type") != "fontWeight" {
		t.Fatalf("weight meta: %v", meta)
	}
}
