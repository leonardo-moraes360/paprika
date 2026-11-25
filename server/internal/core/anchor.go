package core

type NodeAnchor struct {
	PageID              string
	X, Y, Width, Height float64
}

func AnchorOf(doc *Document, id string) (NodeAnchor, bool) {
	n := GetNode(doc, id)
	if n == nil || n.Str("type") == "page" {
		return NodeAnchor{}, false
	}
	var b dbox
	if boxes, err := Layout(doc, LayoutOptions{IDs: []string{id}}); err == nil {
		if lb, ok := boxes[id]; ok {
			b = dbox{lb.X, lb.Y, lb.Width, lb.Height}
		} else {
			b = canvasBox(doc, n)
		}
	} else {
		b = canvasBox(doc, n)
	}
	pageID := ""
	cur, _ := mustGet(n, "parentId").(string)
	for depth := 0; cur != "" && depth < 1000; depth++ {
		p := GetNode(doc, cur)
		if p == nil {
			break
		}
		if p.Str("type") == "page" {
			pageID = cur
			break
		}
		cur, _ = mustGet(p, "parentId").(string)
	}
	return NodeAnchor{PageID: pageID, X: b.x, Y: b.y, Width: b.w, Height: b.h}, true
}
