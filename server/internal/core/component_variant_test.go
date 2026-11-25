package core

import "testing"

const variantCard = `[{"op":"create","node":{"type":"frame","id":"card","component":true,"width":200,"height":100,
	"layout":{"mode":"column","gap":0,"padding":0},
	"componentProps":[{"name":"estado","type":"variant","options":["vazio","importando","pronto"],"default":"vazio"}],
	"children":[
		{"type":"rect","id":"v0","width":200,"height":40,"bind":{"variant":{"estado":"vazio"}}},
		{"type":"rect","id":"v1","width":200,"height":40,"bind":{"variant":{"estado":["importando","pronto"]}}},
		{"type":"rect","id":"v2","width":200,"height":40,"bind":{"variant":{"estado":"pronto"}}}
	]}},
	{"op":"create","node":{"type":"frame","id":"inst","instanceOf":"card","x":300,"propValues":{"estado":"pronto"}}}]`

func TestBindVariantListOnInstance(t *testing.T) {
	doc := mustOps(t, variantCard)
	if GetNode(doc, CopyID("inst", "v0")) != nil {
		t.Fatal("v0 should be omitted")
	}
	if GetNode(doc, CopyID("inst", "v1")) == nil || GetNode(doc, CopyID("inst", "v2")) == nil {
		t.Fatal("v1 and v2 should show for pronto")
	}
}

func TestMainComponentShowsDefaultVariant(t *testing.T) {
	doc := mustOps(t, variantCard)
	for _, id := range []string{"v0", "v1", "v2"} {
		if GetNode(doc, id) == nil {
			t.Fatalf("%s must stay in the document", id)
		}
	}
	if NodeStyle(doc, GetNode(doc, "v0"), false).Str("display") == "none" {
		t.Fatal("default variant should show")
	}
	for _, id := range []string{"v1", "v2"} {
		if NodeStyle(doc, GetNode(doc, id), false).Str("display") != "none" {
			t.Fatalf("%s should be hidden", id)
		}
	}
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := boxes["v1"]; ok {
		t.Fatal("hidden variant should not take layout space")
	}
	for _, is := range LintDocument(doc, "") {
		if is.Rule == "layout-overflow" {
			t.Fatalf("unexpected %v", is)
		}
	}
}

func TestCreateInstanceFillBecomesOverride(t *testing.T) {
	doc := mustOps(t, `[{"op":"create","node":{"type":"frame","id":"btn","component":true,"width":80,"height":30,"fill":"#3355ff"}},
		{"op":"create","node":{"type":"frame","id":"i2","instanceOf":"btn","x":100,"fill":"#ff0000"}},
		{"op":"create","node":{"type":"frame","id":"i3","instanceOf":"btn","x":200,"fill":"#3355ff"}}]`)
	if got := GetNode(doc, "i2").Str("fill"); got != "#ff0000" {
		t.Fatalf("i2 fill %q", got)
	}
	if ov := GetNode(doc, "i2").Obj("overrides"); ov == nil || ov.Obj("btn") == nil || ov.Obj("btn").Str("fill") != "#ff0000" {
		t.Fatal("i2 should carry overrides.btn.fill")
	}
	if GetNode(doc, "i3").Has("overrides") {
		t.Fatal("i3 fill equals the component, no override expected")
	}
}
