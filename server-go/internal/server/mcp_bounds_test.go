package server

import (
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestMCPGetBoundsWrapAndOtherPage(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	chips := make([]any, 11)
	for i := range chips {
		chips[i] = obj("type", "rect", "id", "chip"+string(rune('a'+i)), "width", 88.0, "height", 40.0, "fill", "#c43d27")
	}
	if out, isErr := callText(t, m, "create_nodes", obj("place", "none", "nodes", []any{obj(
		"type", "frame", "id", "chips", "x", 0.0, "y", 0.0, "width", 400.0, "height", "hug",
		"layout", obj("mode", "row", "gap", 12.0, "wrap", true),
		"children", chips,
	)})); isErr {
		t.Fatalf("create_nodes: %s", out)
	}
	out, isErr := callText(t, m, "get_bounds", obj("ids", []any{"chips", "chipk"}))
	if isErr {
		t.Fatalf("get_bounds: %s", out)
	}
	v, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	boxes := v.(*jsonv.Object).Obj("boxes")
	if got := boxes.Obj("chips").Num("height"); got != 3*40+2*12 {
		t.Fatalf("wrapped height = %v, want 144", got)
	}
	if got := boxes.Obj("chipk").Num("y"); got != 104 {
		t.Fatalf("third line y = %v, want 104", got)
	}

	if out, isErr = callText(t, m, "create_page", obj("name", "Second")); isErr {
		t.Fatalf("create_page: %s", out)
	}
	var second string
	for _, id := range s.Doc().Strings("rootIds") {
		if n := core.GetNode(s.Doc(), id); n != nil && n.Str("type") == "page" && n.Str("name") == "Second" {
			second = id
		}
	}
	if second == "" {
		t.Fatal("second page not found")
	}
	if out, isErr = callText(t, m, "create_nodes", obj("parentId", second, "place", "none", "nodes", []any{obj(
		"type", "frame", "id", "other", "x", 700.0, "y", 20.0, "width", 100.0, "height", 60.0,
		"children", []any{obj("type", "rect", "id", "otherkid", "x", 5.0, "y", 6.0, "width", 10.0, "height", 10.0)},
	)})); isErr {
		t.Fatalf("create_nodes page 2: %s", out)
	}
	out, isErr = callText(t, m, "get_bounds", obj("ids", []any{"chips", "otherkid", second}))
	if isErr {
		t.Fatalf("get_bounds: %s", out)
	}
	v, _ = jsonv.Parse([]byte(out))
	res := v.(*jsonv.Object)
	if res.Obj("boxes").Obj("chips") == nil || res.Obj("boxes").Obj("otherkid") == nil {
		t.Fatalf("ids of both pages need a box: %s", out)
	}
	if res.Obj("boxes").Obj("otherkid").Num("x") != 705 {
		t.Fatalf("otherkid x: %s", out)
	}
	un := res.Arr("unplaced")
	if len(un) != 1 || un[0].(*jsonv.Object).Str("id") != second {
		t.Fatalf("the page id is named in unplaced: %s", out)
	}
}
