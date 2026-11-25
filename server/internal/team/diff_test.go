package team

import (
	"encoding/json"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func apply(t *testing.T, doc *core.Document, ops string) *core.Document {
	t.Helper()
	parsed, err := jsonv.Parse([]byte(ops))
	if err != nil {
		t.Fatal(err)
	}
	r, err := core.ApplyOps(doc, parsed.([]any))
	if err != nil {
		t.Fatalf("apply %s: %v", ops, err)
	}
	return r.Doc
}

func applyOps(t *testing.T, doc *core.Document, ops []any) *core.Document {
	t.Helper()
	r, err := core.ApplyOps(doc, ops)
	if err != nil {
		t.Fatalf("remote ops %s: %v", jsonv.Stringify(ops, ""), err)
	}
	return r.Doc
}

func synced(doc *core.Document) string {
	v := viewOf(doc)
	out := map[string]any{"name": v.name, "children": v.children, "tokens": raw(v.tokens), "modes": raw(v.modes)}
	nodes := map[string]json.RawMessage{}
	for id, f := range v.nodes {
		nodes[id] = raw(f)
	}
	out["nodes"] = nodes
	b, _ := json.Marshal(out)
	return string(b)
}

const base = `[
 {"op":"create","node":{"type":"frame","id":"f1","name":"F1","width":300,"height":200,"layout":{"mode":"column","gap":8}}},
 {"op":"create","parentId":"f1","node":{"type":"rect","id":"r1","width":10,"height":10,"fill":"#f00"}},
 {"op":"create","parentId":"f1","node":{"type":"text","id":"t1","text":"Oi"}},
 {"op":"create","node":{"type":"frame","id":"f2","x":400,"width":100,"height":100}},
 {"op":"create","parentId":"f2","node":{"type":"ellipse","id":"e1","width":20,"height":20}},
 {"op":"create","node":{"type":"frame","id":"comp","x":600,"width":80,"height":40,"component":true,"fill":"#eee"}},
 {"op":"create","parentId":"comp","node":{"type":"text","id":"label","text":"Botão"}},
 {"op":"create","node":{"type":"frame","id":"inst","x":700,"instanceOf":"comp"}},
 {"op":"create","node":{"type":"shape","id":"s1","x":0,"y":400,"text":"A"}},
 {"op":"create","node":{"type":"shape","id":"s2","x":300,"y":400,"text":"B"}},
 {"op":"create","node":{"type":"connector","id":"c1","from":{"nodeId":"s1"},"to":{"nodeId":"s2"}}},
 {"op":"set_tokens","tokens":{"accent":"#e04a2b"}},
 {"op":"set_tokens","mode":"dark","tokens":{"accent":"#000000"}}
]`

func TestViewLeavesDerivedDataOut(t *testing.T) {
	doc := apply(t, core.CreateDocument("D", "d"), base)
	v := viewOf(doc)
	for id := range v.nodes {
		if core.CopyOwner(doc, core.GetNode(doc, id)) != nil {
			t.Fatalf("instance copy %s is synced", id)
		}
	}
	if v.nodes["c1"].Has("d") || v.nodes["c1"].Has("width") {
		t.Fatal("connector geometry is synced")
	}
	if v.nodes["inst"].Has("width") || v.nodes["inst"].Has("fill") {
		t.Fatal("instance root's component fields are synced")
	}
	if len(v.children["inst"]) != 0 {
		t.Fatal("instance children are synced")
	}
}

func TestRemoteOpsReachTheState(t *testing.T) {
	start := apply(t, core.CreateDocument("D", "d"), base)
	cases := map[string]string{
		"field edits and a new node": `[
			{"op":"update","id":"r1","props":{"fill":"#00f","name":"Quadrado"}},
			{"op":"update","id":"t1","props":{"color":null}},
			{"op":"create","parentId":"f1","index":0,"node":{"type":"rect","id":"r2","width":5,"height":5}}]`,
		"reorder and move between frames": `[
			{"op":"move","id":"t1","parentId":"f1","index":0},
			{"op":"move","id":"e1","parentId":"f1","index":1}]`,
		"delete a frame whose child moved out": `[
			{"op":"move","id":"e1","parentId":null},
			{"op":"delete","id":"f2"}]`,
		"move into a frame that is new": `[
			{"op":"create","node":{"type":"frame","id":"f3","width":50,"height":50}},
			{"op":"move","id":"e1","parentId":"f3"},
			{"op":"delete","id":"f2"}]`,
		"component, instance override, connector end": `[
			{"op":"update","id":"label","props":{"text":"Comprar"}},
			{"op":"update","id":"inst","props":{"fill":"#123456"}},
			{"op":"update","id":"c1","props":{"to":{"nodeId":"s1","side":"top"}}}]`,
		"tokens, modes and name": `[
			{"op":"set_tokens","tokens":{"accent":"#ff0000","panel":"#111111"}},
			{"op":"set_tokens","mode":"dark","tokens":{"accent":null}},
			{"op":"rename_document","name":"Checkout"}]`,
		"group and ungroup": `[{"op":"group","ids":["s1","s2"],"id":"g1"}]`,
	}
	for name, edit := range cases {
		t.Run(name, func(t *testing.T) {
			want := apply(t, start, edit)
			ops := RemoteOps(start, want)
			got := applyOps(t, start, ops)
			if synced(got) != synced(want) {
				t.Fatalf("ops %s\n got  %s\n want %s", jsonv.Stringify(ops, ""), synced(got), synced(want))
			}
			back := applyOps(t, got, RemoteOps(got, start))
			if synced(back) != synced(start) {
				t.Fatalf("back:\n got  %s\n want %s", synced(back), synced(start))
			}
			if len(RemoteOps(got, want)) != 0 {
				t.Fatalf("not idempotent: %s", jsonv.Stringify(RemoteOps(got, want), ""))
			}
		})
	}
}

func TestDiffNamesWhatChanged(t *testing.T) {
	start := apply(t, core.CreateDocument("D", "d"), base)
	next := apply(t, start, `[
		{"op":"update","id":"r1","props":{"fill":"#00f"}},
		{"op":"move","id":"e1","parentId":"f1","index":0},
		{"op":"delete","id":"f2"},
		{"op":"create","parentId":"f1","node":{"type":"rect","id":"r9"}},
		{"op":"set_tokens","tokens":{"accent":null}}]`)
	kinds := map[string]int{}
	var order []string
	for _, c := range Diff(start, next) {
		kinds[c["k"].(string)]++
		order = append(order, c["k"].(string))
	}
	want := map[string]int{"create": 1, "move": 1, "set": 1, "order": 1, "delete": 1, "tokens": 1}
	for k, n := range want {
		if kinds[k] != n {
			t.Fatalf("%s: got %d, want %d (%v)", k, kinds[k], n, order)
		}
	}
	mi, di := -1, -1
	for i, k := range order {
		if k == "move" {
			mi = i
		}
		if k == "delete" {
			di = i
		}
	}
	if mi > di {
		t.Fatalf("delete before move: %v", order)
	}
	if len(Diff(next, next)) != 0 {
		t.Fatal("no change, no diff")
	}
}
