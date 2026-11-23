package core

import (
	"fmt"
	"math"
	"strconv"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

const (
	PlaceGap    = 80.0
	PlaceRowMax = 2400.0
)

type SpotBox struct{ X, Y, W, H float64 }

type PlacementSummary struct {
	PageID  string
	Content SpotBox
	NextX   float64
	NextY   float64
}

func placeNum(n float64) string { return jsonv.FormatNumber(Round4(n)) }

func spot(x, y, w, h float64) SpotBox {
	if w < 0 {
		w = 0
	}
	if h < 0 {
		h = 0
	}
	return SpotBox{Round4(x), Round4(y), Round4(w), Round4(h)}
}

func BoxesOverlap(a, b SpotBox) bool {
	const eps = 0.5
	return a.X < b.X+b.W-eps && a.X+a.W > b.X+eps && a.Y < b.Y+b.H-eps && a.Y+a.H > b.Y+eps
}

func unionBoxes(boxes []SpotBox) (SpotBox, bool) {
	if len(boxes) == 0 {
		return SpotBox{}, false
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, b := range boxes {
		minX = math.Min(minX, b.X)
		minY = math.Min(minY, b.Y)
		maxX = math.Max(maxX, b.X+b.W)
		maxY = math.Max(maxY, b.Y+b.H)
	}
	return spot(minX, minY, maxX-minX, maxY-minY), true
}

func freeOrigin(content SpotBox, has bool, w float64, mode string) (float64, float64) {
	if !has {
		return 0, 0
	}
	if mode == "below" {
		return Round4(content.X), Round4(content.Y + content.H + PlaceGap)
	}
	x := content.X + content.W + PlaceGap
	y := content.Y
	if mode == "free" && x+w > content.X+PlaceRowMax {
		return Round4(content.X), Round4(content.Y + content.H + PlaceGap)
	}
	return Round4(x), Round4(y)
}

func nearOrigin(target SpotBox, side string, w, h float64) (float64, float64) {
	switch side {
	case "left":
		return Round4(target.X - PlaceGap - w), Round4(target.Y)
	case "above":
		return Round4(target.X), Round4(target.Y - PlaceGap - h)
	case "below":
		return Round4(target.X), Round4(target.Y + target.H + PlaceGap)
	default:
		return Round4(target.X + target.W + PlaceGap), Round4(target.Y)
	}
}

func placeDist2(ax, ay, bx, by float64) float64 {
	dx, dy := ax-bx, ay-by
	return dx*dx + dy*dy
}

func nearestFree(occupied []SpotBox, w, h, fromX, fromY float64) (float64, float64) {
	content, has := unionBoxes(occupied)
	var xs, ys []float64
	push := func(x, y float64) { xs = append(xs, x); ys = append(ys, y) }
	if has {
		x, y := freeOrigin(content, true, w, "free")
		push(x, y)
		x, y = freeOrigin(content, true, w, "right")
		push(x, y)
		x, y = freeOrigin(content, true, w, "below")
		push(x, y)
	} else {
		push(0, 0)
	}
	for _, b := range occupied {
		x, y := nearOrigin(b, "right", w, h)
		push(x, y)
		x, y = nearOrigin(b, "below", w, h)
		push(x, y)
		x, y = nearOrigin(b, "left", w, h)
		push(x, y)
		x, y = nearOrigin(b, "above", w, h)
		push(x, y)
	}
	fits := func(x, y float64) bool {
		box := spot(x, y, w, h)
		for _, b := range occupied {
			if BoxesOverlap(box, b) {
				return false
			}
		}
		return true
	}
	bestX, bestY := xs[0], ys[0]
	bestD := placeDist2(bestX, bestY, fromX, fromY)
	bestSet := false
	consider := func(x, y float64, onlyFit bool) {
		if onlyFit && !fits(x, y) {
			return
		}
		d := placeDist2(x, y, fromX, fromY)
		closer := d < bestD-1e-9
		tie := math.Abs(d-bestD) <= 1e-9 && (x < bestX-1e-9 || (math.Abs(x-bestX) <= 1e-9 && y < bestY-1e-9))
		if !bestSet || closer || tie {
			bestX, bestY, bestD, bestSet = x, y, d, true
		}
	}
	for i := range xs {
		consider(xs[i], ys[i], true)
	}
	if !bestSet {
		bestSet = false
		for i := range xs {
			consider(xs[i], ys[i], false)
		}
	}
	return Round4(bestX), Round4(bestY)
}

func hiddenNode(n *Node) bool {
	v, ok := n.Get("visible")
	b, isBool := v.(bool)
	return ok && isBool && !b
}

func parentString(v any) string {
	s, _ := v.(string)
	return s
}

func nodeParent(n *Node) string {
	v, ok := n.Get("parentId")
	if !ok || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func ContentPageID(doc *Document) string {
	var pages []string
	for _, id := range doc.Strings("rootIds") {
		if n := GetNode(doc, id); n != nil && n.Str("type") == "page" {
			pages = append(pages, id)
		}
	}
	if len(pages) == 0 {
		return ""
	}
	for _, id := range pages {
		p := GetNode(doc, id)
		if p == nil || !IsContainer(p.Str("type")) {
			continue
		}
		for _, c := range p.Strings("children") {
			n := GetNode(doc, c)
			if n != nil && n.Str("type") != "connector" && !hiddenNode(n) {
				return id
			}
		}
	}
	return pages[0]
}

func pageOf(doc *Document, rootID string) string {
	if rootID == "" {
		return ContentPageID(doc)
	}
	n := GetNode(doc, rootID)
	if n == nil {
		return ContentPageID(doc)
	}
	if n.Str("type") == "page" {
		return rootID
	}
	for n != nil {
		if n.Str("type") == "page" {
			return n.Str("id")
		}
		pid := nodeParent(n)
		if pid == "" {
			break
		}
		n = GetNode(doc, pid)
	}
	return ""
}

func siblingIDs(doc *Document, parent string) []string {
	if parent == "" {
		return doc.Strings("rootIds")
	}
	p := GetNode(doc, parent)
	if p == nil || !IsContainer(p.Str("type")) {
		return nil
	}
	return p.Strings("children")
}

type placedSibling struct {
	id  string
	box SpotBox
}

func placedSiblings(doc *Document, parent string) []placedSibling {
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		return nil
	}
	ox, oy := 0.0, 0.0
	if parent != "" {
		if p, ok := boxes[parent]; ok {
			ox, oy = p.X, p.Y
		}
	}
	var out []placedSibling
	for _, id := range siblingIDs(doc, parent) {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" || n.Str("type") == "connector" || hiddenNode(n) {
			continue
		}
		b, ok := boxes[id]
		if !ok {
			continue
		}
		out = append(out, placedSibling{id, spot(b.X-ox, b.Y-oy, b.Width, b.Height)})
	}
	return out
}

func boxInParent(doc *Document, id, parent string) (SpotBox, bool) {
	n := GetNode(doc, id)
	if n == nil || n.Str("type") == "page" || n.Str("type") == "connector" {
		return SpotBox{}, false
	}
	boxes, err := Layout(doc, LayoutOptions{})
	if err != nil {
		return SpotBox{}, false
	}
	b, ok := boxes[id]
	if !ok {
		return SpotBox{}, false
	}
	ox, oy := 0.0, 0.0
	if parent != "" {
		if p, ok := boxes[parent]; ok {
			ox, oy = p.X, p.Y
		}
	}
	return spot(b.X-ox, b.Y-oy, b.Width, b.Height), true
}

func numField(o *jsonv.Object, k string) (float64, bool) {
	if o == nil {
		return 0, false
	}
	v, ok := o.Get(k)
	if !ok {
		return 0, false
	}
	f, ok := v.(float64)
	return f, ok
}

func inputFootprint(node *jsonv.Object) (float64, float64) {
	if node == nil {
		return 100, 100
	}
	switch node.Str("type") {
	case "text":
		text := node.Str("text")
		fontSize, ok := numField(node, "fontSize")
		if !ok {
			fontSize = 16
		}
		fontWeight, ok := numField(node, "fontWeight")
		if !ok {
			fontWeight = 400
		}
		lineHeight, ok := numField(node, "lineHeight")
		if !ok {
			lineHeight = 1.4
		}
		letterSpacing, _ := numField(node, "letterSpacing")
		maxW, hasMax := numField(node, "width")
		m := MeasureText(text, fontSize, fontWeight, lineHeight, letterSpacing, maxW, hasMax)
		w, h := m.Width, m.Height
		if nw, ok := numField(node, "width"); ok {
			w = nw
		}
		if nh, ok := numField(node, "height"); ok {
			h = nh
		}
		if w < 0 {
			w = 0
		}
		if h < 0 {
			h = 0
		}
		return Round4(w), Round4(h)
	case "group":
		maxX, maxY := 0.0, 0.0
		for _, c := range node.Arr("children") {
			child, _ := c.(*jsonv.Object)
			if child == nil {
				continue
			}
			cw, ch := inputFootprint(child)
			x, _ := numField(child, "x")
			y, _ := numField(child, "y")
			maxX = math.Max(maxX, x+cw)
			maxY = math.Max(maxY, y+ch)
		}
		return Round4(maxX), Round4(maxY)
	case "shape":
		w, wok := numField(node, "width")
		h, hok := numField(node, "height")
		if !wok {
			w = 160
		}
		if !hok {
			if node.Str("shape") == "note" {
				h = 160
			} else {
				h = 80
			}
		}
		return w, h
	case "path":
		d := node.Str("d")
		_, wok := numField(node, "width")
		_, hok := numField(node, "height")
		if d != "" && (!wok || !hok) {
			if segs, err := ParsePath(d); err == nil {
				b := PathBounds(segs)
				w, _ := numField(node, "width")
				h, _ := numField(node, "height")
				if !wok {
					w = math.Max(1, math.Ceil(b.X+b.Width))
				}
				if !hok {
					h = math.Max(1, math.Ceil(b.Y+b.Height))
				}
				return w, h
			}
		}
	}
	w, wok := numField(node, "width")
	h, hok := numField(node, "height")
	if !wok {
		w = 100
	}
	if !hok {
		h = 100
	}
	return w, h
}

func readPlace(v any) (mode, near, side string, err error) {
	switch t := v.(type) {
	case string:
		switch t {
		case "free", "below", "right", "none":
			return t, "", "", nil
		default:
			return "", "", "", fmt.Errorf(`place must be "free", "below", "right", "none" or {near, side}`)
		}
	case *jsonv.Object:
		near, side = t.Str("near"), t.Str("side")
		switch side {
		case "left", "right", "above", "below":
			if near == "" {
				return "", "", "", fmt.Errorf(`place.near is a node id and place.side is left, right, above or below`)
			}
			return "near", near, side, nil
		default:
			return "", "", "", fmt.Errorf(`place.near is a node id and place.side is left, right, above or below`)
		}
	default:
		return "", "", "", fmt.Errorf(`place must be "free", "below", "right", "none" or {near, side}`)
	}
}

func ResolvePlace(doc *Document, parentID any, node *jsonv.Object, place any) (any, error) {
	mode, near, side, err := readPlace(place)
	if err != nil {
		return nil, err
	}
	if mode == "none" || node == nil || node.Str("type") == "connector" || node.Str("type") == "page" {
		return parentID, nil
	}
	parent := parentString(parentID)
	if parent == "" {
		if page := ContentPageID(doc); page != "" {
			parent = page
		}
	}
	w, h := inputFootprint(node)
	var x, y float64
	if mode == "near" {
		if GetNode(doc, near) == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, near)
		}
		target, ok := boxInParent(doc, near, parent)
		if !ok {
			return nil, fmt.Errorf(`node "%s" has no box to place beside`, near)
		}
		x, y = nearOrigin(target, side, w, h)
	} else {
		sibs := placedSiblings(doc, parent)
		var boxes []SpotBox
		for _, s := range sibs {
			boxes = append(boxes, s.box)
		}
		content, has := unionBoxes(boxes)
		x, y = freeOrigin(content, has, w, mode)
	}
	node.Set("x", x)
	node.Set("y", y)
	if parent == "" {
		return nil, nil
	}
	return parent, nil
}

func SummarizePlacement(doc *Document, rootID string) PlacementSummary {
	pageID := pageOf(doc, rootID)
	sibs := placedSiblings(doc, pageID)
	var boxes []SpotBox
	for _, s := range sibs {
		boxes = append(boxes, s.box)
	}
	content, has := unionBoxes(boxes)
	nx, ny := freeOrigin(content, has, 0, "free")
	if !has {
		content = SpotBox{}
	}
	return PlacementSummary{PageID: pageID, Content: content, NextX: nx, NextY: ny}
}

func PlacementFooter(doc *Document, rootID string) string {
	s := SummarizePlacement(doc, rootID)
	page := ""
	if s.PageID != "" {
		page = "page=" + s.PageID + " "
	}
	c := s.Content
	return "content: " + page + "x=" + placeNum(c.X) + " y=" + placeNum(c.Y) + " w=" + placeNum(c.W) + " h=" + placeNum(c.H) + "\nnext: x=" + placeNum(s.NextX) + " y=" + placeNum(s.NextY)
}

func nodeLabel(n *Node, id string) string {
	if n == nil {
		return id
	}
	if name := n.Str("name"); name != "" {
		return name
	}
	if nid := n.Str("id"); nid != "" {
		return nid
	}
	return id
}

func OverlapWarnings(doc *Document, created []string) []string {
	fresh := map[string]bool{}
	for _, id := range created {
		fresh[id] = true
	}
	var warnings []string
	for _, id := range created {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" || n.Str("type") == "connector" || hiddenNode(n) {
			continue
		}
		parent := nodeParent(n)
		if parent != "" {
			p := GetNode(doc, parent)
			if p == nil || p.Str("type") != "page" {
				continue
			}
		}
		sibs := placedSiblings(doc, parent)
		var self *placedSibling
		for i := range sibs {
			if sibs[i].id == id {
				self = &sibs[i]
				break
			}
		}
		if self == nil {
			continue
		}
		var others []placedSibling
		for _, s := range sibs {
			if s.id != id && BoxesOverlap(self.box, s.box) {
				others = append(others, s)
			}
		}
		if len(others) == 0 {
			continue
		}
		other := others[0]
		for _, s := range others {
			if !fresh[s.id] {
				other = s
				break
			}
		}
		var occupied []SpotBox
		for _, s := range sibs {
			if s.id != id {
				occupied = append(occupied, s.box)
			}
		}
		x, y := nearestFree(occupied, self.box.W, self.box.H, self.box.X, self.box.Y)
		on := GetNode(doc, other.id)
		warnings = append(warnings, fmt.Sprintf("%s %s overlaps %s; nearest free spot is %s,%s", n.Str("type"), strconv.Quote(nodeLabel(n, id)), strconv.Quote(nodeLabel(on, other.id)), placeNum(x), placeNum(y)))
	}
	return warnings
}

func strIndex(list []string, id string) int {
	for i, s := range list {
		if s == id {
			return i
		}
	}
	return -1
}

func chainOf(doc *Document, id string) []string {
	out := []string{id}
	cur := GetNode(doc, id)
	for cur != nil && nodeParent(cur) != "" {
		out = append(out, nodeParent(cur))
		cur = GetNode(doc, nodeParent(cur))
	}
	return out
}

func paintsAfter(doc *Document, a, b string) bool {
	if a == b {
		return false
	}
	ca, cb := chainOf(doc, a), chainOf(doc, b)
	in := func(list []string, id string) bool { return strIndex(list, id) >= 0 }
	if in(ca, b) || in(cb, a) {
		return false
	}
	common := ""
	for _, id := range cb {
		if in(ca, id) {
			common = id
			break
		}
	}
	var childA, childB string
	var list []string
	if common == "" {
		childA, childB = ca[len(ca)-1], cb[len(cb)-1]
		list = doc.Strings("rootIds")
	} else {
		ia, ib := strIndex(ca, common), strIndex(cb, common)
		if ia <= 0 || ib <= 0 {
			return false
		}
		childA, childB = ca[ia-1], cb[ib-1]
		p := GetNode(doc, common)
		if p == nil || !IsContainer(p.Str("type")) {
			return false
		}
		list = p.Strings("children")
	}
	return strIndex(list, childA) > strIndex(list, childB)
}

func descendantOf(doc *Document, id, ancestor string) bool {
	cur := GetNode(doc, id)
	for cur != nil && nodeParent(cur) != "" {
		if nodeParent(cur) == ancestor {
			return true
		}
		cur = GetNode(doc, nodeParent(cur))
	}
	return false
}

func flowParent(doc *Document, id string) bool {
	n := GetNode(doc, id)
	if n == nil || nodeParent(n) == "" {
		return false
	}
	p := GetNode(doc, nodeParent(n))
	if p == nil || p.Str("type") != "frame" {
		return false
	}
	lay := p.Obj("layout")
	return lay != nil && lay.Str("mode") != "" && lay.Str("mode") != "none"
}

func intersectionArea(a, b SpotBox) float64 {
	w := math.Min(a.X+a.W, b.X+b.W) - math.Max(a.X, b.X)
	h := math.Min(a.Y+a.H, b.Y+b.H) - math.Max(a.Y, b.Y)
	if w <= 0 || h <= 0 {
		return 0
	}
	return w * h
}

func covers(frame, text SpotBox) bool {
	area := text.W * text.H
	if area <= 0 {
		return false
	}
	return intersectionArea(frame, text) >= area*0.8-1e-6
}

func opaqueFrame(doc *Document, n *Node) bool {
	if n == nil || n.Str("type") != "frame" || hiddenNode(n) {
		return false
	}
	if op, ok := numField(n, "opacity"); ok && op < 0.99 {
		return false
	}
	fill, ok := n.Get("fill")
	if !ok || fill == nil {
		return false
	}
	c, ok := ParseColor(jsString(ResolveValue(doc, fill, ModeOf(doc, n))))
	return ok && c.A >= 0.99
}

func absoluteBoxes(doc *Document) map[string]SpotBox {
	boxes, err := Layout(doc, LayoutOptions{})
	out := map[string]SpotBox{}
	if err != nil {
		return out
	}
	for id, b := range boxes {
		out[id] = spot(b.X, b.Y, b.Width, b.Height)
	}
	return out
}

func PlacementLint(doc *Document, ids []string) []LintIssue {
	abs := absoluteBoxes(doc)
	var issues []LintIssue
	nodeIDs := Nodes(doc).Keys()
	for _, id := range ids {
		n := GetNode(doc, id)
		if n == nil {
			continue
		}
		if n.Str("type") == "frame" && !hiddenNode(n) {
			parent := nodeParent(n)
			top := parent == ""
			if !top {
				if p := GetNode(doc, parent); p != nil && p.Str("type") == "page" {
					top = true
				}
			}
			if top {
				sibs := placedSiblings(doc, parent)
				var self *placedSibling
				for i := range sibs {
					if sibs[i].id == id {
						self = &sibs[i]
						break
					}
				}
				if self != nil {
					list := siblingIDs(doc, parent)
					for _, other := range sibs {
						if other.id == id || GetNode(doc, other.id).Str("type") != "frame" {
							continue
						}
						oi, ii := strIndex(list, other.id), strIndex(list, id)
						if oi < 0 || oi >= ii || !BoxesOverlap(self.box, other.box) {
							continue
						}
						var occupied []SpotBox
						for _, s := range sibs {
							if s.id != id {
								occupied = append(occupied, s.box)
							}
						}
						x, y := nearestFree(occupied, self.box.W, self.box.H, self.box.X, self.box.Y)
						on := GetNode(doc, other.id)
						issues = append(issues, LintIssue{
							Rule: "overlapping-boards", Severity: "warning", NodeID: id,
							Message: `overlaps "` + nodeLabel(on, other.id) + `"; nearest free spot is ` + placeNum(x) + "," + placeNum(y),
						})
					}
				}
			}
		}
		if n.Str("type") == "text" && !hiddenNode(n) {
			textBox, ok := abs[id]
			if !ok {
				continue
			}
			for _, oid := range nodeIDs {
				o := GetNode(doc, oid)
				if !opaqueFrame(doc, o) || flowParent(doc, oid) {
					continue
				}
				if descendantOf(doc, id, oid) || !paintsAfter(doc, id, oid) {
					continue
				}
				frameBox, ok := abs[oid]
				if !ok || !covers(frameBox, textBox) {
					continue
				}
				other := false
				for sid, b := range abs {
					if sid == id || sid == oid || descendantOf(doc, sid, oid) {
						continue
					}
					if BoxesOverlap(frameBox, b) {
						other = true
						break
					}
				}
				if !other {
					continue
				}
				issues = append(issues, LintIssue{
					Rule: "covered-by-overlay", Severity: "warning", NodeID: id,
					Message: `painted above opaque frame "` + nodeLabel(o, oid) + `" which covers it; set index: "front" on "` + nodeLabel(o, oid) + `"`,
				})
			}
		}
	}
	return issues
}
