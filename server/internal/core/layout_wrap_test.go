package core

import "testing"

func TestLayoutWrapRow(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"f","width":300,"height":"hug",
			"layout":{"mode":"row","gap":12,"padding":10,"wrap":true},
			"children":[
				{"type":"rect","id":"c0","width":88,"height":40},{"type":"rect","id":"c1","width":88,"height":40},
				{"type":"rect","id":"c2","width":88,"height":40},{"type":"rect","id":"c3","width":88,"height":40},
				{"type":"rect","id":"c4","width":88,"height":40},{"type":"rect","id":"c5","width":88,"height":40},
				{"type":"rect","id":"c6","width":88,"height":40}
			]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["f"].Width, 300, 0.01)
	near(t, boxes["f"].Height, 10+4*40+3*12+10, 0.01)
	near(t, boxes["c1"].X, 110, 0.01)
	near(t, boxes["c2"].X, 10, 0.01)
	near(t, boxes["c2"].Y, 62, 0.01)
	near(t, boxes["c6"].Y, 166, 0.01)
}

func TestLayoutWrapFillWidthInColumn(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"page","width":360,"height":"hug","layout":{"mode":"column","gap":16,"padding":8},
			"children":[
				{"type":"frame","id":"grid","width":"fill","height":"hug","layout":{"mode":"row","gap":12,"wrap":true},
					"children":[
						{"type":"rect","id":"g0","width":100,"height":30},{"type":"rect","id":"g1","width":100,"height":30},
						{"type":"rect","id":"g2","width":100,"height":30},{"type":"rect","id":"g3","width":100,"height":30},
						{"type":"rect","id":"g4","width":100,"height":30}
					]},
				{"type":"rect","id":"tail","width":"fill","height":10}
			]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["grid"].Width, 344, 0.01)
	near(t, boxes["grid"].Height, 72, 0.01)
	near(t, boxes["g3"].Y, 50, 0.01)
	near(t, boxes["tail"].Y, 8+72+16, 0.01)
	near(t, boxes["page"].Height, 8+72+16+10+8, 0.01)
}

func TestLayoutWrapColumnAndAlignContent(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"col","width":"hug","height":120,"layout":{"mode":"column","gap":8,"wrap":true},
			"children":[
				{"type":"rect","id":"c0","width":50,"height":40},{"type":"rect","id":"c1","width":50,"height":40},
				{"type":"rect","id":"c2","width":50,"height":40},{"type":"rect","id":"c3","width":50,"height":40},
				{"type":"rect","id":"c4","width":50,"height":40}
			]
		}
	},{
		"op":"create","node":{
			"type":"frame","id":"row","y":300,"width":200,"height":200,
			"layout":{"mode":"row","gap":10,"wrap":true,"align":"center","justify":"between"},
			"children":[
				{"type":"rect","id":"a","width":90,"height":20},{"type":"rect","id":"b","width":90,"height":40},
				{"type":"rect","id":"c","width":90,"height":30},{"type":"rect","id":"d","width":90,"height":30},
				{"type":"rect","id":"e","width":90,"height":30}
			]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["col"].Width, 50*3+8*2, 0.01)
	near(t, boxes["c2"].X, 58, 0.01)
	near(t, boxes["c2"].Y, 0, 0.01)
	l1, l2 := 40+80.0/3, 30+80.0/3
	near(t, boxes["a"].Y, 300+(l1-20)/2, 0.01)
	near(t, boxes["c"].Y, 300+l1+10+(l2-30)/2, 0.01)
	near(t, boxes["b"].X, 110, 0.01)
	near(t, boxes["e"].X, 0, 0.01)
}

func TestLayoutIDsOnOtherPage(t *testing.T) {
	doc := mustOps(t, `[
		{"op":"create","node":{"type":"frame","id":"one","x":5,"y":6,"width":10,"height":10}},
		{"op":"add_page","id":"p2","name":"Two"},
		{"op":"create","parentId":"p2","node":{"type":"frame","id":"two","x":100,"y":200,"width":30,"height":40,
			"layout":{"mode":"row","padding":4},"children":[{"type":"rect","id":"kid","width":10,"height":10}]}}
	]`)
	first, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := first["two"]; ok {
		t.Fatal("no ids: only the first page is laid out")
	}
	both, err := Layout(doc, LayoutOptions{IDs: []string{"one", "kid", "two"}})
	if err != nil {
		t.Fatal(err)
	}
	near(t, both["one"].X, 5, 0.01)
	near(t, both["two"].X, 100, 0.01)
	near(t, both["kid"].X, 104, 0.01)
	near(t, both["kid"].Y, 204, 0.01)
	only, _ := Layout(doc, LayoutOptions{IDs: []string{"kid"}})
	if len(only) != 1 {
		t.Fatalf("want only kid, got %v", only)
	}
}
