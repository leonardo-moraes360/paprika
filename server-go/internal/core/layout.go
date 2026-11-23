package core

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/layout.ts: absolute boxes for agents (row/column, hug/fill, rotation).

// LayoutPt is a 2D point.
type LayoutPt struct{ X, Y float64 }

// LayoutBox is an absolute box with rotated corners and transform origin (centre).
type LayoutBox struct {
	X, Y, Width, Height float64
	Origin              LayoutPt
	Corners             [4]LayoutPt // TL, TR, BR, BL after CSS clockwise rotation
}

// FontAvg is the mean Latin advance / em for Inter-like sans at weight 400.
const FontAvg = 0.552

// TextMetrics is a deterministic text box shared by TS and Go.
type TextMetrics struct {
	Width, Height float64
	Lines         int
}

// MeasureText approximates Inter / system-ui; optional maxWidth wraps by character advance.
func MeasureText(text string, fontSize float64, fontWeight, lineHeight, letterSpacing float64, maxWidth float64, hasMax bool) TextMetrics {
	if fontWeight == 0 {
		fontWeight = 400
	}
	if lineHeight == 0 {
		lineHeight = 1.4
	}
	advance := FontAvg * fontSize * (1 + (fontWeight-400)/4000)
	lineH := fontSize * lineHeight
	paragraphs := strings.Split(text, "\n")
	var lines []string
	for _, para := range paragraphs {
		if !hasMax || maxWidth <= 0 || para == "" {
			lines = append(lines, para)
			continue
		}
		cur := ""
		for _, r := range para {
			ch := string(r)
			next := cur + ch
			n := utf8.RuneCountInString(next)
			w := float64(n)*advance + math.Max(0, float64(n-1))*letterSpacing
			if cur != "" && w > maxWidth {
				lines = append(lines, cur)
				cur = ch
			} else {
				cur = next
			}
		}
		lines = append(lines, cur)
	}
	if len(lines) == 0 {
		lines = append(lines, "")
	}
	width := 0.0
	for _, line := range lines {
		if line == "" {
			continue
		}
		n := utf8.RuneCountInString(line)
		w := float64(n)*advance + math.Max(0, float64(n-1))*letterSpacing
		if w > width {
			width = w
		}
	}
	return TextMetrics{Round4(width), Round4(float64(len(lines)) * lineH), len(lines)}
}

func padOf(doc *Document, n *Node) (t, r, b, l float64) {
	lay := n.Obj("layout")
	if lay == nil {
		return
	}
	mode := ModeOf(doc, n)
	one := func(v any) float64 {
		if f, ok := ResolveLength(doc, v, mode); ok {
			return f
		}
		return 0
	}
	if v, ok := lay.Get("padding"); ok {
		if arr, is := v.([]any); is && len(arr) == 4 {
			return one(arr[0]), one(arr[1]), one(arr[2]), one(arr[3])
		}
		p := one(v)
		return p, p, p, p
	}
	return
}

func gapOf(doc *Document, n *Node) float64 {
	lay := n.Obj("layout")
	if lay == nil {
		return 0
	}
	g, _ := lay.Get("gap")
	if f, ok := ResolveLength(doc, g, ModeOf(doc, n)); ok {
		return f
	}
	return 0
}

func sizeNum(n *Node, key string) (float64, bool) {
	v, ok := n.Get(key)
	if !ok {
		return 0, false
	}
	f, ok := v.(float64)
	return f, ok
}

func sizeKind(n *Node, key string) string {
	v, ok := n.Get(key)
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func cornersOf(x, y, w, h, rotation float64) [4]LayoutPt {
	cx, cy := x+w/2, y+h/2
	pts := [4]LayoutPt{{x, y}, {x + w, y}, {x + w, y + h}, {x, y + h}}
	if rotation == 0 {
		for i := range pts {
			pts[i].X, pts[i].Y = Round4(pts[i].X), Round4(pts[i].Y)
		}
		return pts
	}
	rad := rotation * math.Pi / 180
	cos, sin := math.Cos(rad), math.Sin(rad)
	for i, p := range pts {
		dx, dy := p.X-cx, p.Y-cy
		pts[i] = LayoutPt{Round4(cx + dx*cos + dy*sin), Round4(cy - dx*sin + dy*cos)}
	}
	return pts
}

func boxAt(x, y, w, h, rotation float64) LayoutBox {
	ox, oy := Round4(x), Round4(y)
	ow, oh := Round4(math.Max(0, w)), Round4(math.Max(0, h))
	origin := LayoutPt{Round4(ox + ow/2), Round4(oy + oh/2)}
	return LayoutBox{ox, oy, ow, oh, origin, cornersOf(ox, oy, ow, oh, rotation)}
}

type wh struct{ w, h float64 }

func intrinsicText(doc *Document, n *Node, maxW float64, hasMax bool) wh {
	mode := ModeOf(doc, n)
	fsRaw, _ := n.Get("fontSize")
	fs := ResolveValue(doc, fsRaw, mode)
	fontSize := 16.0
	switch v := fs.(type) {
	case float64:
		fontSize = v
	case string:
		if f, err := parseFloat(v); err == nil {
			fontSize = f
		}
	}
	lhRaw, _ := n.Get("lineHeight")
	lh, lhOK := ResolveLength(doc, lhRaw, mode)
	if !lhOK {
		lh = n.Num("lineHeight")
	}
	lsRaw, _ := n.Get("letterSpacing")
	ls, lsOK := ResolveLength(doc, lsRaw, mode)
	if !lsOK {
		ls = n.Num("letterSpacing")
	}
	m := MeasureText(n.Str("text"), fontSize, n.Num("fontWeight"), lh, ls, maxW, hasMax)
	return wh{m.Width, m.Height}
}

func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscan(s, &f)
	return f, err
}

func flowChildren(doc *Document, n *Node) []*Node {
	var out []*Node
	for _, id := range n.Strings("children") {
		c := GetNode(doc, id)
		if c == nil || c.Str("type") == "connector" {
			continue
		}
		if c.Has("visible") && !c.Bool("visible") {
			continue
		}
		out = append(out, c)
	}
	return out
}

func ignoresLayout(n *Node) bool {
	return n.Str("layoutPositioning") == "absolute"
}

func flowItems(doc *Document, n *Node) []*Node {
	var out []*Node
	for _, c := range flowChildren(doc, n) {
		if !ignoresLayout(c) {
			out = append(out, c)
		}
	}
	return out
}

func hasFlow(n *Node) bool {
	if n.Str("type") != "frame" {
		return false
	}
	lay := n.Obj("layout")
	return lay != nil && lay.Str("mode") != "" && lay.Str("mode") != "none"
}

func preferred(doc *Document, n *Node, hintW, hintH float64, hasHintW, hasHintH bool) wh {
	if n.Str("type") == "page" {
		return wh{}
	}
	fw, hasFW := sizeNum(n, "width")
	fh, hasFH := sizeNum(n, "height")
	switch n.Str("type") {
	case "text":
		var maxW float64
		hasMax := false
		if hasFW {
			maxW, hasMax = fw, true
		} else if hasHintW {
			maxW, hasMax = hintW, true
		}
		t := intrinsicText(doc, n, maxW, hasMax)
		w, h := t.w, t.h
		if hasFW {
			w = fw
		}
		if hasFH {
			h = fh
		}
		return wh{w, h}
	case "group", "connector":
		return wh{numOr0(n, "width"), numOr0(n, "height")}
	case "shape", "rect", "ellipse", "image", "path":
		w, h := 0.0, 0.0
		if hasFW {
			w = fw
		}
		if hasFH {
			h = fh
		}
		return wh{w, h}
	case "frame":
		if !hasFlow(n) {
			if hasFW && hasFH {
				return wh{fw, fh}
			}
			kids := flowChildren(doc, n)
			maxX, maxY := 0.0, 0.0
			for _, c := range kids {
				s := preferred(doc, c, 0, 0, false, false)
				maxX = math.Max(maxX, c.Num("x")+s.w)
				maxY = math.Max(maxY, c.Num("y")+s.h)
			}
			w, h := maxX, maxY
			if hasFW {
				w = fw
			}
			if hasFH {
				h = fh
			}
			return wh{w, h}
		}
		pt, pr, pb, pl := padOf(doc, n)
		gap := gapOf(doc, n)
		kids := flowItems(doc, n)
		row := n.Obj("layout").Str("mode") == "row"
		main, cross := 0.0, 0.0
		for i, c := range kids {
			s := preferred(doc, c, 0, 0, false, false)
			if row {
				main += s.w
				cross = math.Max(cross, s.h)
			} else {
				main += s.h
				cross = math.Max(cross, s.w)
			}
			if i > 0 {
				main += gap
			}
		}
		contentW, contentH := cross, main
		if row {
			contentW, contentH = main, cross
		}
		w, h := contentW+pl+pr, contentH+pt+pb
		if hasFW {
			w = fw
		}
		if hasFH {
			h = fh
		}
		return wh{w, h}
	}
	w, h := 0.0, 0.0
	if hasFW {
		w = fw
	}
	if hasFH {
		h = fh
	}
	return wh{w, h}
}

type place struct {
	id              string
	x, y, w, h, rot float64
}

func placeSized(doc *Document, n *Node, absX, absY, w, h float64, out *[]place) {
	t := n.Str("type")
	if t == "page" || t == "connector" {
		placeTree(doc, n.Str("id"), absX, absY, out, 0, 0, false)
		return
	}
	if hasFlow(n) {
		placeFlowFrame(doc, n, absX, absY, w, h, out)
		return
	}
	rot := 0.0
	if t != "group" {
		rot = n.Num("rotation")
	}
	*out = append(*out, place{n.Str("id"), absX, absY, w, h, rot})
	if IsContainer(t) {
		for _, c := range n.Strings("children") {
			child := GetNode(doc, c)
			if child == nil {
				continue
			}
			if child.Str("type") == "connector" {
				placeTree(doc, c, absX, absY, out, 0, 0, false)
				continue
			}
			placeTree(doc, c, absX+child.Num("x"), absY+child.Num("y"), out, w, h, true)
		}
	}
}

func placeFlowFrame(doc *Document, n *Node, absX, absY, frameW, frameH float64, out *[]place) {
	pt, pr, pb, pl := padOf(doc, n)
	*out = append(*out, place{n.Str("id"), absX, absY, frameW, frameH, n.Num("rotation")})
	kids := flowItems(doc, n)
	lay := n.Obj("layout")
	row := lay.Str("mode") == "row"
	innerW := math.Max(0, frameW-pl-pr)
	innerH := math.Max(0, frameH-pt-pb)
	gap := gapOf(doc, n)

	type base struct {
		n                   *Node
		baseW, baseH        float64
		fillMain, fillCross bool
	}
	bases := make([]base, len(kids))
	for i, c := range kids {
		p := preferred(doc, c, 0, 0, false, false)
		bw, bh := p.w, p.h
		if f, ok := sizeNum(c, "width"); ok {
			bw = f
		} else if sizeKind(c, "width") == "fill" {
			bw = 0
		}
		if f, ok := sizeNum(c, "height"); ok {
			bh = f
		} else if sizeKind(c, "height") == "fill" {
			bh = 0
		}
		bases[i] = base{
			n: c, baseW: bw, baseH: bh,
			fillMain:  (row && sizeKind(c, "width") == "fill") || (!row && sizeKind(c, "height") == "fill"),
			fillCross: (row && sizeKind(c, "height") == "fill") || (!row && sizeKind(c, "width") == "fill"),
		}
	}
	fixedMain := 0.0
	fillCount := 0
	for i, b := range bases {
		if row {
			fixedMain += b.baseW
		} else {
			fixedMain += b.baseH
		}
		if i > 0 {
			fixedMain += gap
		}
		if b.fillMain {
			fillCount++
		}
	}
	free := math.Max(0, map[bool]float64{true: innerW, false: innerH}[row]-fixedMain)
	fillEach := 0.0
	if fillCount > 0 {
		fillEach = free / float64(fillCount)
	}

	type item struct {
		n    *Node
		w, h float64
	}
	placed := make([]item, len(bases))
	for i, b := range bases {
		w, h := b.baseW, b.baseH
		if b.fillMain {
			if row {
				w = fillEach
			} else {
				h = fillEach
			}
		}
		if b.fillCross || lay.Str("align") == "stretch" {
			if row {
				h = innerH
			} else {
				w = innerW
			}
		}
		if b.n.Str("type") == "text" {
			var tw float64
			has := false
			if sizeKind(b.n, "width") == "fill" || sizeNumOk(b.n, "width") {
				tw, has = w, true
			}
			t := intrinsicText(doc, b.n, tw, has)
			if sizeKind(b.n, "width") == "hug" {
				w = t.w
			}
			if sizeKind(b.n, "height") == "hug" || !sizeNumOk(b.n, "height") {
				h = t.h
			}
		}
		placed[i] = item{b.n, math.Max(0, w), math.Max(0, h)}
	}

	totalMain := 0.0
	for i, p := range placed {
		if row {
			totalMain += p.w
		} else {
			totalMain += p.h
		}
		if i > 0 {
			totalMain += gap
		}
	}
	spare := map[bool]float64{true: innerW, false: innerH}[row] - totalMain
	main0 := 0.0
	justify := lay.Str("justify")
	if justify == "center" {
		main0 = spare / 2
	} else if justify == "end" {
		main0 = spare
	}
	betweenGap := gap
	if justify == "between" && len(placed) > 1 {
		betweenGap = math.Max(0, spare) / float64(len(placed)-1)
	}
	cursor := main0
	align := lay.Str("align")
	for i, p := range placed {
		cross := 0.0
		crossSpare := map[bool]float64{true: innerH, false: innerW}[row] - map[bool]float64{true: p.h, false: p.w}[row]
		if align == "center" {
			cross = crossSpare / 2
		} else if align == "end" {
			cross = crossSpare
		}
		var lx, ly float64
		if row {
			lx, ly = pl+cursor, pt+cross
		} else {
			lx, ly = pl+cross, pt+cursor
		}
		placeSized(doc, p.n, absX+lx, absY+ly, p.w, p.h, out)
		step := p.h
		if row {
			step = p.w
		}
		cursor += step + betweenGap
		_ = i
	}
	for _, c := range n.Strings("children") {
		child := GetNode(doc, c)
		if child == nil || child.Str("type") == "connector" || child.Str("type") == "page" {
			continue
		}
		if child.Has("visible") && !child.Bool("visible") {
			continue
		}
		if !ignoresLayout(child) {
			continue
		}
		placeTree(doc, c, absX+child.Num("x"), absY+child.Num("y"), out, frameW, frameH, true)
	}
	for _, c := range n.Strings("children") {
		if child := GetNode(doc, c); child != nil && child.Str("type") == "connector" {
			placeTree(doc, c, absX, absY, out, 0, 0, false)
		}
	}
}

func sizeNumOk(n *Node, key string) bool {
	_, ok := sizeNum(n, key)
	return ok
}

func placeTree(doc *Document, id string, absX, absY float64, out *[]place, parentW, parentH float64, hasParent bool) {
	n := GetNode(doc, id)
	if n == nil {
		return
	}
	if n.Str("type") == "page" {
		for _, c := range n.Strings("children") {
			placeTree(doc, c, 0, 0, out, 0, 0, false)
		}
		return
	}
	if n.Str("type") == "connector" {
		*out = append(*out, place{id, absX + n.Num("x"), absY + n.Num("y"), numOr0(n, "width"), numOr0(n, "height"), 0})
		return
	}
	if hasFlow(n) {
		pref := preferred(doc, n, parentW, parentH, hasParent, hasParent)
		frameW, frameH := pref.w, pref.h
		if f, ok := sizeNum(n, "width"); ok {
			frameW = f
		} else if sizeKind(n, "width") == "fill" && hasParent {
			frameW = parentW
		}
		if f, ok := sizeNum(n, "height"); ok {
			frameH = f
		} else if sizeKind(n, "height") == "fill" && hasParent {
			frameH = parentH
		}
		placeFlowFrame(doc, n, absX, absY, frameW, frameH, out)
		return
	}
	pref := preferred(doc, n, parentW, parentH, hasParent, hasParent)
	w, h := pref.w, pref.h
	if f, ok := sizeNum(n, "width"); ok {
		w = f
	} else if sizeKind(n, "width") == "fill" && hasParent {
		w = parentW
	}
	if f, ok := sizeNum(n, "height"); ok {
		h = f
	} else if sizeKind(n, "height") == "fill" && hasParent {
		h = parentH
	}
	if n.Str("type") == "text" {
		var maxW float64
		has := false
		if f, ok := sizeNum(n, "width"); ok {
			maxW, has = f, true
		} else if hasParent {
			maxW, has = parentW, true
		}
		t := intrinsicText(doc, n, maxW, has)
		if sizeKind(n, "width") == "hug" {
			w = t.w
		}
		if sizeKind(n, "height") == "hug" {
			h = t.h
		}
	}
	rot := 0.0
	if n.Str("type") != "group" {
		rot = n.Num("rotation")
	}
	*out = append(*out, place{id, absX, absY, w, h, rot})
	if IsContainer(n.Str("type")) {
		for _, c := range n.Strings("children") {
			child := GetNode(doc, c)
			if child == nil {
				continue
			}
			if child.Str("type") == "connector" {
				placeTree(doc, c, absX, absY, out, 0, 0, false)
				continue
			}
			placeTree(doc, c, absX+child.Num("x"), absY+child.Num("y"), out, 0, 0, false)
		}
	}
}

func subtreeIds(doc *Document, rootID string) map[string]bool {
	out := map[string]bool{rootID: true}
	var walk func(string)
	walk = func(id string) {
		n := GetNode(doc, id)
		if n == nil || !IsContainer(n.Str("type")) {
			return
		}
		for _, c := range n.Strings("children") {
			out[c] = true
			walk(c)
		}
	}
	walk(rootID)
	return out
}

func pageIdOf(doc *Document, id string) string {
	cur := GetNode(doc, id)
	for cur != nil {
		if cur.Str("type") == "page" {
			return cur.Str("id")
		}
		pid := cur.Str("parentId")
		if pid == "" {
			break
		}
		cur = GetNode(doc, pid)
	}
	if p := FirstPage(doc); p != nil {
		return p.Str("id")
	}
	return ""
}

// LayoutOptions filters the result of Layout.
type LayoutOptions struct {
	RootID string
	IDs    []string
}

// Layout resolves absolute boxes for every visible node (or a subtree / id filter).
func Layout(doc *Document, opts LayoutOptions) (map[string]LayoutBox, error) {
	if opts.RootID != "" && GetNode(doc, opts.RootID) == nil {
		return nil, fmt.Errorf(`node "%s" does not exist`, opts.RootID)
	}
	var placed []place
	pageID := ""
	if opts.RootID != "" {
		if n := GetNode(doc, opts.RootID); n != nil && n.Str("type") == "page" {
			pageID = opts.RootID
		} else {
			pageID = pageIdOf(doc, opts.RootID)
		}
	}
	if pageID == "" {
		if p := FirstPage(doc); p != nil {
			pageID = p.Str("id")
		}
	}
	roots, err := PageRoots(doc, pageID)
	if err != nil {
		return nil, err
	}
	for _, id := range roots {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" {
			continue
		}
		placeTree(doc, id, n.Num("x"), n.Num("y"), &placed, 0, 0, false)
	}

	var keep map[string]bool
	if opts.RootID != "" {
		keep = subtreeIds(doc, opts.RootID)
	}
	if len(opts.IDs) > 0 {
		ids := map[string]bool{}
		for _, id := range opts.IDs {
			ids[id] = true
		}
		if keep == nil {
			keep = ids
		} else {
			for id := range keep {
				if !ids[id] {
					delete(keep, id)
				}
			}
		}
	}

	out := map[string]LayoutBox{}
	for _, p := range placed {
		if keep != nil && !keep[p.id] {
			continue
		}
		out[p.id] = boxAt(p.x, p.y, p.w, p.h, p.rot)
	}
	return out, nil
}

// LayoutBoxJSON is the MCP / golden JSON shape of a LayoutBox.
func LayoutBoxJSON(b LayoutBox) *jsonv.Object {
	corners := make([]any, 4)
	for i, c := range b.Corners {
		corners[i] = jsonv.NewObject("x", c.X, "y", c.Y)
	}
	return jsonv.NewObject(
		"x", b.X, "y", b.Y, "width", b.Width, "height", b.Height,
		"origin", jsonv.NewObject("x", b.Origin.X, "y", b.Origin.Y),
		"corners", corners,
	)
}
