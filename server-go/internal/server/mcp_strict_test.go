package server

import (
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Every tool's argument schema and its contract inputSchema name the same keys, and the contract
// says additionalProperties:false (unknown arguments are rejected, not dropped).
func TestToolSchemasMatchContract(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	seen := map[string]bool{}
	for _, tl := range mcpContract.Tools {
		o := tl.(*jsonv.Object)
		name := o.Str("name")
		seen[name] = true
		impl, ok := m.tools[name]
		if !ok {
			t.Errorf("%s: in the contract but not registered", name)
			continue
		}
		in := o.Obj("inputSchema")
		if v, _ := in.Get("additionalProperties"); v != false {
			t.Errorf("%s: inputSchema.additionalProperties must be false", name)
		}
		if impl.schema == nil {
			continue
		}
		want := in.Obj("properties").Keys()
		got := impl.schema.Keys()
		sort.Strings(want)
		sort.Strings(got)
		if !slices.Equal(want, got) {
			t.Errorf("%s: contract keys %v, schema keys %v", name, want, got)
		}
	}
	for name := range m.tools {
		if !seen[name] {
			t.Errorf("%s: registered but not in the contract", name)
		}
	}
}

func TestUnknownArgumentsAreRejected(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	createRect(t, s, "a")
	cases := []struct {
		tool string
		args *jsonv.Object
		want []string
	}{
		{"render_screenshot", obj("id", "a"), []string{`unknown argument "id" (did you mean "rootId"?)`, "valid arguments: compare, mode, path, rootId, scale, workspaceId"}},
		{"render_screenshot", obj("nodeId", "a"), []string{`(did you mean "rootId"?)`}},
		{"export_image", obj("id", "a"), []string{`(did you mean "rootId"?)`}},
		{"export_code", obj("nodeId", "a", "format", "html"), []string{`(did you mean "rootId"?)`}},
		{"lint_design", obj("ids", []any{"a"}), []string{`unknown argument "ids" (did you mean "rootIds"?)`}},
		{"get_nodes", obj("ids", []any{"a"}, "bogus", 1.0), []string{`unknown argument "bogus"`, "valid arguments: ids, workspaceId"}},
	}
	for _, c := range cases {
		out, isErr := callText(t, m, c.tool, c.args)
		if !isErr {
			t.Fatalf("%s %s: expected an error, got %s", c.tool, c.args, out)
		}
		for _, w := range c.want {
			if !strings.Contains(out, w) {
				t.Fatalf("%s: %q not in %s", c.tool, w, out)
			}
		}
	}
}

func TestGetNodesReturnsWhatExists(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	createRect(t, s, "a")
	r := m.CallTool(t.Context(), "get_nodes", obj("ids", []any{"a", "gone"}), true)
	if r.Bool("isError") {
		t.Fatalf("%s", r)
	}
	sc := r.Obj("structuredContent")
	if len(sc.Arr("nodes")) != 1 || len(sc.Arr("missing")) != 1 || sc.Arr("missing")[0] != "gone" {
		t.Fatalf("structured: %s", sc)
	}
	out, isErr := callText(t, m, "get_nodes", obj("ids", []any{"x", "y"}))
	if !isErr || !strings.Contains(out, "nodes do not exist: x, y") {
		t.Fatalf("none exist: %v %s", isErr, out)
	}
	if r := m.CallTool(t.Context(), "get_nodes", obj("ids", []any{"a"}), true); r.Obj("structuredContent").Has("missing") {
		t.Fatalf("missing must be absent when every id exists")
	}
}

func TestExportImageSVG(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	createRect(t, s, "a")
	r := m.CallTool(t.Context(), "export_image", obj("rootId", "a", "format", "svg"), true)
	if r.Bool("isError") {
		t.Fatalf("%s", r)
	}
	text := r.Arr("content")[0].(*jsonv.Object).Str("text")
	sc := r.Obj("structuredContent")
	if !strings.HasPrefix(text, "<svg") || sc.Str("format") != "svg" || sc.Str("mimeType") != "image/svg+xml" {
		t.Fatalf("%s %s", text, sc)
	}
}
