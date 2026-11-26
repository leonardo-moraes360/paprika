package core

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func applyRaw(t *testing.T, ops string) (*Document, error) {
	t.Helper()
	v, err := jsonv.Parse([]byte(ops))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ApplyOps(CreateDocument("t", "d"), v.([]any))
	if err != nil {
		return nil, err
	}
	return r.Doc, nil
}

func TestLengthTokensResolveAndReflow(t *testing.T) {
	doc := mustOps(t, `[{"op":"set_tokens","tokens":{"radius.md":12,"space.md":8,"space.sm":4,"text.md":18,"text.lh":1.5,"brand":"#ff0000"}},
		{"op":"create","node":{"type":"frame","id":"a","width":120,"height":100,"radius":"$radius.md","stroke":{"color":"#111","width":"$space.sm"},"shadow":{"x":"$space.sm","y":"$space.md","blur":"$space.md","spread":0,"color":"#000"},"layout":{"mode":"column","gap":"$space.md","padding":"$space.md"},"children":[
			{"type":"rect","id":"a1","width":20,"height":20},
			{"type":"rect","id":"a2","width":20,"height":20},
			{"type":"text","id":"t","text":"Oi","fontSize":"$text.md","lineHeight":"$text.lh","letterSpacing":"$space.sm"}
		]}},
		{"op":"create","node":{"type":"frame","id":"b","x":200,"width":80,"height":80,"layout":{"mode":"column","gap":"$space.md","padding":["$space.md","$space.sm","$space.md","$space.sm"]},"children":[{"type":"rect","id":"b1","width":20,"height":20}]}}]`)
	css := NodeStyle(doc, GetNode(doc, "a"), false)
	if css.Str("borderRadius") != "12px" || css.Str("gap") != "8px" || css.Str("padding") != "8px" || css.Str("border") != "4px solid #111" {
		t.Fatalf("style %v", css)
	}
	if css.Str("boxShadow") != "4px 8px 8px 0px #000" {
		t.Fatalf("shadow %s", css.Str("boxShadow"))
	}
	text := NodeStyle(doc, GetNode(doc, "t"), false)
	if text.Str("fontSize") != "18px" || text.Num("lineHeight") != 1.5 || text.Str("letterSpacing") != "4px" {
		t.Fatalf("text %v", text)
	}
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["a1"].Y, 8, 1e-9)
	near(t, boxes["a2"].Y, 36, 1e-9)
	near(t, boxes["b1"].X, 204, 1e-9)
	near(t, boxes["b1"].Y, 8, 1e-9)

	v, err := jsonv.Parse([]byte(`[{"op":"set_tokens","tokens":{"space.md":24}}]`))
	if err != nil {
		t.Fatal(err)
	}
	next, err := ApplyOps(doc, v.([]any))
	if err != nil {
		t.Fatal(err)
	}
	moved, err := Layout(next.Doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, moved["a1"].Y, 24, 1e-9)
	near(t, moved["a2"].Y, 68, 1e-9)
	near(t, moved["b1"].Y, 24, 1e-9)
	if NodeStyle(next.Doc, GetNode(next.Doc, "a"), false).Str("gap") != "24px" {
		t.Fatal("gap")
	}
	if NodeStyle(next.Doc, GetNode(next.Doc, "b"), false).Str("padding") != "24px 4px 24px 4px" {
		t.Fatal("padding")
	}
	vars := NodeStyleVars(doc, GetNode(doc, "t"), false, true)
	if vars.Str("fontSize") != "var(--text\\.md)" || vars.Str("lineHeight") != "calc(var(--text\\.lh) / 1px)" || vars.Str("letterSpacing") != "var(--space\\.sm)" {
		t.Fatalf("vars %v", vars)
	}
}

func TestLengthTokensRefuseWrongKind(t *testing.T) {
	cases := []struct{ ops, want string }{
		{`[{"op":"set_tokens","tokens":{"brand":"#ff0000"}},{"op":"create","node":{"type":"rect","id":"r","radius":"$brand"}}]`,
			`op[1]: node "r" radius: token "$brand" resolved to "#ff0000", expected a length`},
		{`[{"op":"set_tokens","tokens":{"text.huge":2000}},{"op":"create","node":{"type":"text","id":"t","text":"a","fontSize":"$text.huge"}}]`,
			`op[1]: node "t" fontSize: token "$text.huge" is 2000, expected a number >= 1 and <= 1000`},
		{`[{"op":"set_tokens","tokens":{"neg":-2}},{"op":"create","node":{"type":"rect","id":"r","shadow":{"x":0,"y":0,"blur":"$neg","color":"#000"}}}]`,
			`op[1]: node "r" shadow.blur: token "$neg" is -2, expected a number >= 0`},
		{`[{"op":"create","node":{"type":"frame","id":"f","layout":{"padding":[0,8,1]}}}]`, `layout.padding takes one value (all sides), [vertical, horizontal] or [top, right, bottom, left]`},
		{`[{"op":"create","node":{"type":"rect","id":"r","width":"$space.8"}}]`, `width and height take a number (0..100000), "hug" or "fill"`},
		{`[{"op":"create","node":{"type":"text","id":"t","text":"a","lineHeight":22}}]`, `lineHeight is a unitless multiplier of fontSize between 0 and 10 (e.g. 1.4), not pixels; for a 22px line on 16px text use 1.375`},
		{`[{"op":"create","node":{"type":"path","id":"p","d":"M0 0 L10 10","fill":"linear-gradient(90deg, #fff, #000)"}}]`, `use the structured gradient field`},
	}
	for _, c := range cases {
		_, err := applyRaw(t, c.ops)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("got %v want %s", err, c.want)
		}
	}
	doc, err := applyRaw(t, `[{"op":"create","node":{"type":"text","id":"t","text":"a","fontSize":"$text.md"}}]`)
	if err != nil {
		t.Fatal(err)
	}
	if GetNode(doc, "t").Str("fontSize") != "$text.md" {
		t.Fatal("unknown token")
	}
}
