package core

import (
	"math"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestGoldenStrokeOutline(t *testing.T) {
	g := loadGolden(t)
	cases := g.Arr("strokeCases")
	if len(cases) == 0 {
		t.Fatal("strokeCases fixture missing: run pnpm go:golden")
	}
	for _, v := range cases {
		c := v.(*jsonv.Object)
		doc := CreateDocument("Untitled", "abc")
		tokens := jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject("brand", "#c43d27"))
		r, err := ApplyOps(doc, []any{tokens, jsonv.NewObject("op", "create", "node", c.Obj("node"))})
		if err != nil {
			t.Fatalf("%s: %v", c.Str("name"), err)
		}
		plan, perr := OutlineStrokeOps(r.Doc, c.Str("id"), c.Bool("keep"))
		var got *jsonv.Object
		if perr != nil {
			got = jsonv.NewObject("ok", false, "error", perr.Error())
		} else {
			b := plan.Bounds
			got = jsonv.NewObject("ok", true, "value", jsonv.NewObject(
				"ops", plan.Ops, "id", plan.ID, "d", plan.D,
				"bounds", jsonv.NewObject("x", b.X, "y", b.Y, "width", b.Width, "height", b.Height)))
		}
		want, _ := c.Get("result")
		eq(t, "stroke "+c.Str("name"), jsonv.Stringify(got, ""), jsonv.Stringify(want, ""))
	}
}

func ringWinding(x, y float64, rings [][]Point) int {
	w := 0
	for _, r := range rings {
		for i := range r {
			a, b := r[i], r[(i+1)%len(r)]
			cross := (b.X-a.X)*(y-a.Y) - (x-a.X)*(b.Y-a.Y)
			if a.Y <= y {
				if b.Y > y && cross > 0 {
					w++
				}
			} else if b.Y <= y && cross < 0 {
				w--
			}
		}
	}
	return w
}

func TestOutlineStrokeCoverage(t *testing.T) {
	segs, err := ParsePath("M20 50 L120 50")
	if err != nil {
		t.Fatal(err)
	}
	rings := OutlineStrokeRings(segs, StrokeOutlineParams{Width: 12, Cap: "round", Join: "round"})
	both, either := 0, 0
	for y := 41.13; y <= 59; y += 0.5 {
		for x := 11.21; x <= 129; x += 0.5 {
			a := ringWinding(x, y, rings) != 0
			cx := math.Max(20, math.Min(120, x))
			b := math.Hypot(x-cx, y-50) <= 6
			if a && b {
				both++
			}
			if a || b {
				either++
			}
		}
	}
	if iou := float64(both) / float64(either); iou < 0.98 {
		t.Errorf("round-capped line IoU %.4f < 0.98", iou)
	}
	circle, _ := ParsePath("M100 50 A50 50 0 1 1 100 150 A50 50 0 1 1 100 50 Z")
	ring := OutlineStrokeRings(circle, StrokeOutlineParams{Width: 10, Cap: "butt", Join: "round"})
	if len(ring) != 2 || ringWinding(100, 100, ring) != 0 || ringWinding(100, 52, ring) == 0 {
		t.Errorf("closed circle should be an annulus: %d rings", len(ring))
	}
}
