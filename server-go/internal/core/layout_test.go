package core

import (
	"math"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func near(t *testing.T, got, want, eps float64) {
	t.Helper()
	if math.Abs(got-want) > eps {
		t.Fatalf("got %v want %v (±%v)", got, want, eps)
	}
}

func mustOps(t *testing.T, ops string) *Document {
	t.Helper()
	v, err := jsonv.Parse([]byte(ops))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ApplyOps(CreateDocument("t", "d"), v.([]any))
	if err != nil {
		t.Fatal(err)
	}
	return r.Doc
}

func TestMeasureTextDeterministic(t *testing.T) {
	a := MeasureText("Olá", 16, 400, 1.4, 0, 0, false)
	b := MeasureText("Olá", 32, 400, 1.4, 0, 0, false)
	if a.Width <= 0 {
		t.Fatal("width")
	}
	near(t, b.Width, a.Width*2, 1e-9)
	near(t, a.Height, 16*1.4, 1e-9)
	if MeasureText("a\nb", 10, 400, 1.4, 0, 0, false).Lines != 2 {
		t.Fatal("lines")
	}
}

func TestLayoutRotatedCorners(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"board","x":10,"y":20,"width":200,"height":100,
			"children":[{"type":"rect","id":"r","x":30,"y":10,"width":40,"height":20,"rotation":90,"fill":"#c43d27"}]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	r := boxes["r"]
	near(t, r.X, 40, 0.01)
	near(t, r.Y, 30, 0.01)
	near(t, r.Origin.X, 60, 0.01)
	near(t, r.Origin.Y, 40, 0.01)
	near(t, r.Corners[0].X, 50, 1)
	near(t, r.Corners[0].Y, 60, 1)
	near(t, r.Corners[1].X, 50, 1)
	near(t, r.Corners[1].Y, 20, 1)
}

func TestLayoutNestedAutoLayout(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"outer","x":0,"y":0,"width":320,"height":200,
			"layout":{"mode":"column","gap":8,"padding":16},
			"children":[
				{"type":"frame","id":"inner","width":"fill","height":"hug",
					"layout":{"mode":"row","gap":4,"padding":8,"align":"center"},
					"children":[
						{"type":"rect","id":"a","width":40,"height":20,"fill":"#111"},
						{"type":"rect","id":"b","width":"fill","height":20,"fill":"#222"},
						{"type":"rect","id":"c","width":24,"height":24,"fill":"#333"}
					]},
				{"type":"rect","id":"bar","width":"fill","height":4,"fill":"#ff278c"}
			]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["inner"].X, 16, 1)
	near(t, boxes["inner"].Y, 16, 1)
	near(t, boxes["inner"].Width, 288, 1)
	near(t, boxes["inner"].Height, 40, 1)
	near(t, boxes["b"].Width, 288-16-40-24-8, 1)
	near(t, boxes["bar"].Y, 16+40+8, 1)
	near(t, boxes["bar"].Width, 288, 1)
}

func TestNormalizePathOrigin(t *testing.T) {
	segs, err := ParsePath("M40 30 L80 30 L60 70 Z")
	if err != nil {
		t.Fatal(err)
	}
	o := PathOrigin(segs)
	near(t, o.X, 40, 0.01)
	near(t, o.Y, 30, 0.01)
	moved, origin, b := NormalizePath(segs)
	near(t, origin.X, 40, 0.01)
	near(t, b.X, 0, 0.01)
	near(t, b.Y, 0, 0.01)
	if SerializePath(moved)[:4] != "M0 0" {
		t.Fatalf("normalized %q", SerializePath(moved))
	}
}
