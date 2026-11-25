package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func TestLintDesignPoints(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "frame", "id", "board", "name", "Board", "width", 1000.0, "height", 80.0, "fill", "#ffffff",
			"layout", obj("mode", "row", "gap", 16.0),
			"children", []any{
				obj("type", "rect", "id", "a", "name", "A", "width", 400.0, "height", 40.0, "fill", "#111111"),
				obj("type", "rect", "id", "b", "name", "B", "width", 400.0, "height", 40.0, "fill", "#111111"),
				obj("type", "rect", "id", "c", "name", "C", "width", 400.0, "height", 40.0, "fill", "#111111"),
			}),
		obj("type", "frame", "id", "box", "name", "Box", "x", 0.0, "y", 300.0, "fill", "#ffffff",
			"layout", obj("mode", "row", "gap", 8.0),
			"children", []any{
				obj("type", "rect", "width", 80.0, "height", 40.0, "fill", "#111111"),
				obj("type", "rect", "width", 80.0, "height", 40.0, "fill", "#111111"),
			}),
		obj("type", "frame", "id", "mock", "name", "Mock", "x", 0.0, "y", 500.0, "width", 200.0, "height", 80.0, "fill", "#ffffff", "scaledMock", true,
			"children", []any{obj("type", "text", "id", "cap", "text", "Cap", "fontSize", 9.0, "color", "#111111")}),
		obj("type", "frame", "id", "real", "name", "Real", "x", 0.0, "y", 700.0, "width", 200.0, "height", 80.0, "fill", "#ffffff",
			"children", []any{obj("type", "text", "id", "label", "text", "Label", "fontSize", 9.0, "color", "#111111")}),
		obj("type", "frame", "id", "glyph", "name", "Glyph", "x", 300.0, "y", 900.0, "width", 100.0, "height", 100.0, "fill", "#ffffff",
			"children", []any{
				obj("type", "path", "id", "lobe", "name", "Lobe", "x", 10.0, "y", 10.0, "width", 80.0, "height", 80.0, "d", "M0 0 L20 0 L20 20 Z", "fill", "#c43d27"),
				obj("type", "ellipse", "id", "seed", "name", "Seed", "x", 10.0, "y", 10.0, "width", 80.0, "height", 80.0, "fill", "#3d7a4a"),
				obj("type", "path", "id", "stem", "name", "Stem", "x", 10.0, "y", 10.0, "width", 80.0, "height", 80.0, "d", "M60 60 L80 60 L80 80 Z", "fill", "#1f5e33"),
			}),
		obj("type", "frame", "id", "icon", "name", "Icon", "x", 0.0, "y", 900.0, "width", 200.0, "height", 200.0, "fill", "#ffffff",
			"children", []any{
				obj("type", "ellipse", "id", "pod", "name", "Pod", "x", 0.0, "y", 0.0, "width", 40.0, "height", 40.0, "fill", "#c43d27"),
				obj("type", "rect", "id", "body", "name", "Body", "x", 10.0, "y", 10.0, "width", 40.0, "height", 40.0, "fill", "#1e2336"),
				obj("type", "ellipse", "id", "calyx", "name", "Calyx", "x", 90.0, "y", 0.0, "width", 20.0, "height", 20.0, "fill", "#3d7a4a"),
				obj("type", "rect", "id", "left", "name", "Left", "x", 0.0, "y", 100.0, "width", 20.0, "height", 20.0, "fill", "#111111"),
				obj("type", "rect", "id", "right", "name", "Right", "x", 22.0, "y", 100.0, "width", 20.0, "height", 20.0, "fill", "#111111"),
				obj("type", "rect", "id", "under", "name", "Under", "x", 0.0, "y", 160.0, "width", 10.0, "height", 10.0, "fill", "#cccccc"),
				obj("type", "rect", "id", "cover", "name", "Cover", "x", 0.0, "y", 160.0, "width", 30.0, "height", 30.0, "fill", "#111111"),
			}),
	}))
	if isErr {
		t.Fatal(out)
	}

	scoped, isErr := callText(t, m, "lint_design", obj("rootIds", []any{"board"}))
	if isErr || !strings.Contains(scoped, "layout-overflow") || strings.Contains(scoped, `"label"`) || strings.Contains(scoped, "hug-was-meant") {
		t.Fatalf("scoped: %s", scoped)
	}
	parsed, err := jsonv.Parse([]byte(scoped))
	if err != nil {
		t.Fatal(err)
	}
	groups := parsed.(*jsonv.Object).Arr("groups")
	if len(groups) == 0 || groups[0].(*jsonv.Object).Str("rule") == "" {
		t.Fatalf("groups: %s", scoped)
	}
	var saw bool
	for _, g := range groups {
		o := g.(*jsonv.Object)
		if o.Str("rule") == "layout-overflow" && o.Num("count") == 1 && o.Arr("nodeIds")[0] == "board" {
			saw = true
		}
	}
	if !saw {
		t.Fatalf("layout group: %s", scoped)
	}

	hug, isErr := callText(t, m, "lint_design", obj("rootIds", []any{"box"}, "minSeverity", "warning"))
	if isErr || !strings.Contains(hug, "hug-was-meant") || strings.Contains(hug, "layout-overflow") {
		t.Fatalf("hug: %s", hug)
	}
	quiet, isErr := callText(t, m, "lint_design", obj("rootIds", []any{"box"}, "minSeverity", "error"))
	if isErr || !strings.Contains(quiet, `"issues": []`) {
		t.Fatalf("minSeverity: %s", quiet)
	}
	mock, isErr := callText(t, m, "lint_design", obj("rootIds", []any{"mock", "real"}, "minFontSize", 10.0))
	if isErr || strings.Contains(mock, `"cap"`) || !strings.Contains(mock, `"label"`) {
		t.Fatalf("font: %s", mock)
	}
	icon, isErr := callText(t, m, "lint_design", obj("rootId", "icon"))
	if isErr || !strings.Contains(icon, "detached-sibling") || !strings.Contains(icon, "near-gap") || !strings.Contains(icon, "fully-hidden") {
		t.Fatalf("geometry: %s", icon)
	}
	if !strings.Contains(icon, "calyx") || !strings.Contains(icon, "under 4px") || !strings.Contains(icon, "Cover") {
		t.Fatalf("geometry text: %s", icon)
	}
	glyph, isErr := callText(t, m, "lint_design", obj("rootId", "glyph"))
	if isErr || strings.Contains(glyph, "fully-hidden") {
		t.Fatalf("stacked paths share a box but do not hide each other: %s", glyph)
	}
	missing, isErr := callText(t, m, "lint_design", obj("rootIds", []any{"nope"}))
	if !isErr || !strings.Contains(missing, `node "nope" does not exist`) {
		t.Fatalf("missing: %v %s", isErr, missing)
	}

	if _, isErr = callText(t, m, "set_tokens", obj("tokens", obj("ink", "#111111"))); isErr {
		t.Fatal("tokens")
	}
	if _, isErr = callText(t, m, "update_nodes", obj("updates", []any{
		obj("id", "left", "props", obj("lintIgnore", []any{"raw-color"})),
	})); isErr {
		t.Fatal("ignore")
	}
	ignored, _ := callText(t, m, "lint_design", obj("rootIds", []any{"icon"}))
	rawLeft := false
	again, _ := jsonv.Parse([]byte(ignored))
	for _, item := range again.(*jsonv.Object).Arr("issues") {
		o := item.(*jsonv.Object)
		if o.Str("rule") == "raw-color" && o.Str("nodeId") == "left" {
			rawLeft = true
		}
	}
	if rawLeft {
		t.Fatalf("lintIgnore: %s", ignored)
	}
}
