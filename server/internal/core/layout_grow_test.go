package core

import "testing"

func growRow(t *testing.T, children string, frameW string) map[string]LayoutBox {
	t.Helper()
	doc := mustOps(t, `[{"op":"create","node":{
		"type":"frame","id":"f","width":`+frameW+`,"height":60,"layout":{"mode":"row","gap":10,"padding":20},
		"children":[`+children+`]}}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	return boxes
}

func TestLayoutGrowSpacerPushesToEnd(t *testing.T) {
	b := growRow(t, `{"type":"rect","id":"a","width":50,"height":20},
		{"type":"rect","id":"sp","width":0,"height":0,"layoutGrow":1},
		{"type":"rect","id":"z","width":50,"height":20}`, "400")
	near(t, b["a"].X, 20, 0.01)
	near(t, b["sp"].X, 80, 0.01)
	near(t, b["sp"].Width, 360-50-50-20, 0.01)
	near(t, b["z"].X, 330, 0.01)
}

func TestLayoutGrowWeights(t *testing.T) {
	b := growRow(t, `{"type":"rect","id":"a","width":40,"height":20,"layoutGrow":1},
		{"type":"rect","id":"b","width":40,"height":20,"layoutGrow":3},
		{"type":"rect","id":"c","width":100,"height":20}`, "400")
	free := 360.0 - (40 + 40 + 100 + 20)
	near(t, b["a"].Width, 40+free/4, 0.001)
	near(t, b["b"].Width, 40+free*3/4, 0.001)
	near(t, b["c"].X, 280, 0.001)
}

func TestLayoutGrowFractionAndHugText(t *testing.T) {
	b := growRow(t, `{"type":"rect","id":"a","width":100,"height":20,"layoutGrow":0.5}`, "400")
	near(t, b["a"].Width, 100+(360-100)*0.5, 0.001)
	b = growRow(t, `{"type":"text","id":"t","text":"Title","width":"hug","height":"hug","fontSize":16,"layoutGrow":1},
		{"type":"rect","id":"r","width":40,"height":20}`, "400")
	near(t, b["t"].Width, 360-10-40, 0.001)
	near(t, b["r"].X, 340, 0.001)
}

func TestLayoutGrowColumnAndFill(t *testing.T) {
	doc := mustOps(t, `[{"op":"create","node":{
		"type":"frame","id":"f","width":200,"height":300,"layout":{"mode":"column"},
		"children":[
			{"type":"rect","id":"a","width":50,"height":100,"layoutGrow":1},
			{"type":"rect","id":"b","width":50,"height":"fill","layoutGrow":5}
		]}}]`)
	b, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, b["a"].Height, 200, 0.001)
	near(t, b["b"].Height, 100, 0.001)
}

func TestLayoutGrowHugFrameAndStyle(t *testing.T) {
	doc := mustOps(t, `[{"op":"create","node":{
		"type":"frame","id":"f","width":"hug","height":40,"layout":{"mode":"row"},
		"children":[
			{"type":"rect","id":"a","width":70,"height":20,"layoutGrow":2},
			{"type":"rect","id":"b","width":"fill","height":20,"layoutGrow":2}
		]}}]`)
	b, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, b["a"].Width, 70, 0.001)
	if g, ok := NodeStyle(doc, GetNode(doc, "a"), false).Get("flexGrow"); !ok || g != 2.0 {
		t.Fatalf("flexGrow = %v, %v", g, ok)
	}
	if _, ok := NodeStyle(doc, GetNode(doc, "b"), false).Get("flexGrow"); ok {
		t.Fatal("fill child must not emit flexGrow")
	}
}
