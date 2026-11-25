package core

import (
	"maps"
	"math"
)

const constraintEps = 1e-3
const constraintMax = 100_000.0

type sizeSnap struct {
	w, h     float64
	wOK, hOK bool
}

func snapOf(n *Node) sizeSnap {
	if n.Str("type") == "page" {
		return sizeSnap{}
	}
	w, wOK := sizeNum(n, "width")
	h, hOK := sizeNum(n, "height")
	return sizeSnap{w: w, h: h, wOK: wOK, hOK: hOK}
}

func constraintModes(n *Node) (h, v string) {
	h, v = "left", "top"
	c := n.Obj("constraints")
	if c == nil {
		return
	}
	if s := c.Str("horizontal"); s != "" {
		h = s
	}
	if s := c.Str("vertical"); s != "" {
		v = s
	}
	return
}

func inFlow(parent, child *Node) bool {
	lay := parent.Obj("layout")
	if lay == nil {
		return false
	}
	mode := lay.Str("mode")
	if mode != "row" && mode != "column" {
		return false
	}
	return child.Str("layoutPositioning") != "absolute"
}

func adjustable(n *Node) bool {
	if n == nil {
		return false
	}
	t := n.Str("type")
	return t != "" && t != "page" && t != "connector" && n.Str("sourceId") == ""
}

func clampSize(v float64) float64 {
	if v < 0 {
		v = 0
	}
	if v > constraintMax {
		v = constraintMax
	}
	return Round4(v)
}

func moveAxis(pos, size, oldP, newP float64, sizeOK bool, mode string) (float64, float64, bool) {
	d := newP - oldP
	if math.Abs(d) <= constraintEps {
		return pos, size, sizeOK
	}
	if mode == "left" || mode == "top" {
		return pos, size, sizeOK
	}
	if mode == "right" || mode == "bottom" {
		return Round4(pos + d), size, sizeOK
	}
	if mode == "center" {
		return Round4(pos + d/2), size, sizeOK
	}
	if oldP <= constraintEps {
		return pos, size, sizeOK
	}
	r := newP / oldP
	next := size
	ok := sizeOK
	if sizeOK {
		next = clampSize(size * r)
	}
	return Round4(pos * r), next, ok
}

func scaleBox(n *Node, rw, rh float64) {
	if math.Abs(rw-1) > constraintEps {
		n.Set("x", Round4(n.Num("x")*rw))
	}
	if math.Abs(rh-1) > constraintEps {
		n.Set("y", Round4(n.Num("y")*rh))
	}
	if n.Str("type") == "group" {
		return
	}
	if w, ok := sizeNum(n, "width"); ok && math.Abs(rw-1) > constraintEps {
		n.Set("width", clampSize(w*rw))
	}
	if h, ok := sizeNum(n, "height"); ok && math.Abs(rh-1) > constraintEps {
		n.Set("height", clampSize(h*rh))
	}
}

func scaleGroupContents(doc *Document, g *Node, rw, rh float64) {
	for _, cid := range g.Strings("children") {
		child := GetNode(doc, cid)
		if !adjustable(child) {
			continue
		}
		scaleBox(child, rw, rh)
		if child.Str("type") == "group" {
			scaleGroupContents(doc, child, rw, rh)
		}
	}
}

func adjustChild(doc *Document, parent *Node, cid string, oldW, oldH, newW, newH float64) {
	child := GetNode(doc, cid)
	if !adjustable(child) || inFlow(parent, child) {
		return
	}
	h, v := constraintModes(child)
	var w, ht float64
	wOK, hOK := false, false
	if child.Str("type") != "group" {
		w, wOK = sizeNum(child, "width")
		ht, hOK = sizeNum(child, "height")
	}
	nx, nw, nwOK := moveAxis(child.Num("x"), w, oldW, newW, wOK, h)
	ny, nh, nhOK := moveAxis(child.Num("y"), ht, oldH, newH, hOK, v)
	child.Set("x", nx)
	child.Set("y", ny)
	if child.Str("type") != "group" && child.Str("instanceOf") == "" {
		if h == "scale" && nwOK {
			child.Set("width", nw)
		}
		if v == "scale" && nhOK {
			child.Set("height", nh)
		}
		return
	}
	if h == "scale" || v == "scale" {
		rw, rh := 1.0, 1.0
		if h == "scale" && oldW > constraintEps {
			rw = newW / oldW
		}
		if v == "scale" && oldH > constraintEps {
			rh = newH / oldH
		}
		scaleGroupContents(doc, child, rw, rh)
	}
}

func applyConstraints(before, draft *Document) {
	base := map[string]sizeSnap{}
	if nodes := Nodes(before); nodes != nil {
		for _, id := range nodes.Keys() {
			if n := nodes.Obj(id); n != nil && n.Str("type") != "page" {
				base[id] = snapOf(n)
			}
		}
	}
	if nodes := Nodes(draft); nodes != nil {
		for _, id := range nodes.Keys() {
			n := nodes.Obj(id)
			if n == nil || n.Str("type") == "page" {
				continue
			}
			now := snapOf(n)
			prev, ok := base[id]
			if !ok {
				base[id] = now
				continue
			}
			if !prev.wOK {
				prev.w, prev.wOK = now.w, now.wOK
			}
			if !prev.hOK {
				prev.h, prev.hOK = now.h, now.hOK
			}
			base[id] = prev
		}
	}
	var visit func(string)
	visit = func(id string) {
		n := GetNode(draft, id)
		if n == nil {
			return
		}
		if n.Str("type") == "frame" && n.Str("instanceOf") == "" && n.Str("sourceId") == "" {
			old := base[id]
			nw, nwOK := sizeNum(n, "width")
			nh, nhOK := sizeNum(n, "height")
			widthChanged := old.wOK && nwOK && math.Abs(nw-old.w) > constraintEps
			heightChanged := old.hOK && nhOK && math.Abs(nh-old.h) > constraintEps
			if widthChanged || heightChanged {
				oldW, newW := nw, nw
				oldH, newH := nh, nh
				if widthChanged {
					oldW, newW = old.w, nw
				}
				if heightChanged {
					oldH, newH = old.h, nh
				}
				for _, cid := range append([]string(nil), n.Strings("children")...) {
					adjustChild(draft, n, cid, oldW, oldH, newW, newH)
				}
			}
		}
		if IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				visit(c)
			}
		}
	}
	for _, id := range draft.Strings("rootIds") {
		visit(id)
	}
	followLayout(before, draft)
}

func layoutAll(doc *Document) map[string]LayoutBox {
	out := map[string]LayoutBox{}
	var pages []string
	for _, id := range doc.Strings("rootIds") {
		if n := GetNode(doc, id); n != nil && n.Str("type") == "page" {
			pages = append(pages, id)
		}
	}
	if len(pages) == 0 {
		boxes, err := Layout(doc, LayoutOptions{})
		if err != nil {
			return out
		}
		return boxes
	}
	for _, id := range pages {
		boxes, err := Layout(doc, LayoutOptions{RootID: id})
		if err != nil {
			continue
		}
		maps.Copy(out, boxes)
	}
	return out
}

func hasPinned(doc *Document, f *Node) bool {
	for _, cid := range f.Strings("children") {
		c := GetNode(doc, cid)
		if !adjustable(c) || inFlow(f, c) {
			continue
		}
		if h, v := constraintModes(c); h != "left" || v != "top" {
			return true
		}
	}
	return false
}

// followLayout: frames whose own size is not numeric (fill, hug) still change size when an
// ancestor is resized or their content changes. Their pinned non-flow children follow the delta of
// the laid-out size.
func followLayout(before, draft *Document) {
	nodes := Nodes(draft)
	if nodes == nil {
		return
	}
	cands := map[string]bool{}
	for _, id := range nodes.Keys() {
		n := nodes.Obj(id)
		if n == nil || n.Str("type") != "frame" || n.Str("instanceOf") != "" || n.Str("sourceId") != "" {
			continue
		}
		prev := GetNode(before, id)
		if prev == nil || prev.Str("type") == "page" {
			continue
		}
		dynW := !sizeNumOk(n, "width") && !sizeNumOk(prev, "width")
		dynH := !sizeNumOk(n, "height") && !sizeNumOk(prev, "height")
		if (dynW || dynH) && hasPinned(draft, n) {
			cands[id] = true
		}
	}
	if len(cands) == 0 {
		return
	}
	was := layoutAll(before)
	now := layoutAll(draft)
	var visit func(string)
	visit = func(id string) {
		n := GetNode(draft, id)
		if n == nil {
			return
		}
		if cands[id] {
			delete(cands, id)
			prev := GetNode(before, id)
			a, aok := was[id]
			b, bok := now[id]
			if aok && bok {
				dynW := !sizeNumOk(n, "width") && !sizeNumOk(prev, "width")
				dynH := !sizeNumOk(n, "height") && !sizeNumOk(prev, "height")
				wc := dynW && math.Abs(b.Width-a.Width) > constraintEps
				hc := dynH && math.Abs(b.Height-a.Height) > constraintEps
				if wc || hc {
					oldW, oldH := b.Width, b.Height
					if wc {
						oldW = a.Width
					}
					if hc {
						oldH = a.Height
					}
					for _, cid := range append([]string(nil), n.Strings("children")...) {
						adjustChild(draft, n, cid, oldW, oldH, b.Width, b.Height)
					}
				}
			}
		}
		if IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				visit(c)
			}
		}
	}
	for _, id := range draft.Strings("rootIds") {
		visit(id)
	}
}
