package core

import "testing"

const fillTextSentence = "The quick brown fox jumps over the lazy dog again and again"

func fillTextDoc(t *testing.T, width string) *Document {
	return mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"f","width":420,"height":"hug","layout":{"mode":"column","padding":24},
			"children":[{"type":"text","id":"t","text":"`+fillTextSentence+`","width":`+width+`,"height":"hug","fontSize":16}]
		}
	}]`)
}

func TestLayoutHugFrameMeasuresFillTextAtResolvedWidth(t *testing.T) {
	boxes, err := Layout(fillTextDoc(t, `"fill"`), LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["t"].Width, 372, 0.01)
	near(t, boxes["t"].Height, 44.8, 0.01)
	near(t, boxes["f"].Height, 48+44.8, 0.01)
	fixed, err := Layout(fillTextDoc(t, "372"), LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["f"].Height, fixed["f"].Height, 0.01)
}

func TestLayoutHugRowMeasuresFillTextAtItsShare(t *testing.T) {
	doc := mustOps(t, `[{
		"op":"create","node":{
			"type":"frame","id":"f","width":420,"height":"hug","layout":{"mode":"row","padding":24,"gap":12},
			"children":[
				{"type":"rect","id":"r","width":60,"height":10},
				{"type":"text","id":"t","text":"`+fillTextSentence+`","width":"fill","height":"hug","fontSize":16}
			]
		}
	}]`)
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, boxes["t"].Width, 300, 0.01)
	near(t, boxes["f"].Height, 48+boxes["t"].Height, 0.01)
}
