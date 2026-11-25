package core

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type LayoutPt struct{ X, Y float64 }

type LayoutBox struct {
	X, Y, Width, Height float64
	Origin              LayoutPt
	Corners             [4]LayoutPt
}

const FontAvg = 0.552

type TextMetrics struct {
	Width, Height float64
	Lines         int
}

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

type RichSpan struct {
	Start, End           int
	FontSize, FontWeight float64
}

func MeasureRich(text string, fontSize, fontWeight, lineHeight, letterSpacing, maxW float64, hasMax bool, runs []RichSpan) TextMetrics {
	if len(runs) == 0 {
		return MeasureText(text, fontSize, fontWeight, lineHeight, letterSpacing, maxW, hasMax)
	}
	if fontWeight == 0 {
		fontWeight = 400
	}
	if lineHeight == 0 {
		lineHeight = 1.4
	}
	at := func(i int) (float64, float64) {
		for _, r := range runs {
			if i >= r.Start && i < r.End {
				return r.FontSize, r.FontWeight
			}
		}
		return fontSize, fontWeight
	}
	advOf := func(size, weight float64) float64 {
		return FontAvg * size * (1 + (weight-400)/4000)
	}
	width, height := 0.0, 0.0
	lines := 0
	abs := 0
	for para := range strings.SplitSeq(text, "\n") {
		units := utf16.Encode([]rune(para))
		curUnits := 0
		curW := 0.0
		curMax := fontSize
		flush := func() {
			if curW > width {
				width = curW
			}
			height += curMax * lineHeight
			lines++
			curUnits = 0
			curW = 0
			curMax = fontSize
		}
		if len(units) == 0 {
			flush()
		} else {
			for i := 0; i < len(units); {
				n := 1
				if i+1 < len(units) && units[i] >= 0xD800 && units[i] <= 0xDBFF {
					n = 2
				}
				size, weight := at(abs + i)
				adv := advOf(size, weight)
				gap := n
				if curUnits == 0 {
					gap = max(0, n-1)
				}
				add := adv*float64(n) + letterSpacing*float64(gap)
				if hasMax && maxW > 0 && curUnits > 0 && curW+add > maxW {
					if curW > width {
						width = curW
					}
					height += curMax * lineHeight
					lines++
					curUnits = n
					curW = adv*float64(n) + letterSpacing*float64(max(0, n-1))
					curMax = math.Max(fontSize, size)
				} else {
					curUnits += n
					curW += add
					curMax = math.Max(curMax, size)
				}
				i += n
			}
			flush()
		}
		abs += len(units) + 1
	}
	if lines == 0 {
		return TextMetrics{0, Round4(fontSize * lineHeight), 1}
	}
	return TextMetrics{Round4(width), Round4(height), lines}
}

func richSpans(doc *Document, n *Node, base, nodeWeight float64) []RichSpan {
	mode := ModeOf(doc, n)
	var out []RichSpan
	for _, item := range n.Arr("runs") {
		o, ok := item.(*jsonv.Object)
		if !ok {
			continue
		}
		size := base
		if fs, ok := o.Get("fontSize"); ok {
			if f, ok := ResolveLength(doc, fs, mode); ok {
				size = f
			}
		}
		weight := nodeWeight
		if fw, ok := o.Get("fontWeight"); ok {
			weight = ResolvedFontWeight(doc, fw, mode)
		}
		out = append(out, RichSpan{int(o.Num("start")), int(o.Num("end")), size, weight})
	}
	return out
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
		pts[i] = LayoutPt{Round4(cx + dx*cos - dy*sin), Round4(cy + dx*sin + dy*cos)}
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
	fw, _ := n.Get("fontWeight")
	weight := ResolvedFontWeight(doc, fw, mode)
	spans := richSpans(doc, n, fontSize, weight)
	var m TextMetrics
	if len(spans) > 0 {
		m = MeasureRich(n.Str("text"), fontSize, weight, lh, ls, maxW, hasMax, spans)
	} else {
		m = MeasureText(n.Str("text"), fontSize, weight, lh, ls, maxW, hasMax)
	}
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

const lineEps = 1e-9

func splitLines(mains []float64, avail float64, hasAvail bool, gap float64) [][]int {
	var lines [][]int
	var cur []int
	sum := 0.0
	for i, m := range mains {
		add := m
		if len(cur) > 0 {
			add += gap
		}
		if hasAvail && len(cur) > 0 && sum+add > avail+lineEps {
			lines = append(lines, cur)
			cur, sum, add = nil, 0, m
		}
		sum += add
		cur = append(cur, i)
	}
	if len(cur) > 0 {
		lines = append(lines, cur)
	}
	return lines
}

func hasWrap(doc *Document, n *Node) bool {
	if hasFlow(n) && n.Obj("layout").Bool("wrap") {
		return true
	}
	if !IsContainer(n.Str("type")) {
		return false
	}
	for _, id := range n.Strings("children") {
		if c := GetNode(doc, id); c != nil && hasWrap(doc, c) {
			return true
		}
	}
	return false
}

type pforce struct {
	w, h       float64
	hasW, hasH bool
}

func preferred(doc *Document, n *Node, hintW, hintH float64, hasHintW, hasHintH bool, fo pforce) wh {
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
				s := preferred(doc, c, 0, 0, false, false, pforce{})
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
		lay := n.Obj("layout")
		row := lay.Str("mode") == "row"
		wrap := lay.Bool("wrap")
		sizes := make([]wh, len(kids))
		for i, c := range kids {
			if row {
				sizes[i] = preferred(doc, c, 0, hintH, false, hasHintH, pforce{})
			} else {
				sizes[i] = preferred(doc, c, hintW, 0, hasHintW, false, pforce{})
			}
		}
		var baseW, baseH float64
		hasBaseW, hasBaseH := true, true
		switch {
		case fo.hasW:
			baseW = fo.w
		case hasFW:
			baseW = fw
		case sizeKind(n, "width") == "fill" && hasHintW:
			baseW = hintW
		default:
			hasBaseW = false
		}
		switch {
		case fo.hasH:
			baseH = fo.h
		case hasFH:
			baseH = fh
		case sizeKind(n, "height") == "fill" && hasHintH:
			baseH = hintH
		default:
			hasBaseH = false
		}
		availW, availH := math.Max(0, baseW-pl-pr), math.Max(0, baseH-pt-pb)
		mainsOf := func() []float64 {
			out := make([]float64, len(kids))
			for i, c := range kids {
				switch {
				case row && sizeKind(c, "width") == "fill", !row && sizeKind(c, "height") == "fill":
					out[i] = 0
				case row:
					out[i] = sizes[i].w
				default:
					out[i] = sizes[i].h
				}
			}
			return out
		}
		var rowLines [][]int
		if row {
			rowLines = splitLines(mainsOf(), availW, wrap && hasBaseW, gap)
		}
		for i, c := range kids {
			if !hasFlow(c) || sizeKind(c, "height") != "hug" || sizeKind(c, "width") != "fill" || !hasBaseW || !hasWrap(doc, c) {
				continue
			}
			w := availW
			if row {
				mains := mainsOf()
				var line []int
				for _, l := range rowLines {
					for _, k := range l {
						if k == i {
							line = l
						}
					}
				}
				fixed, fills := 0.0, 0
				for j, k := range line {
					fixed += mains[k]
					if j > 0 {
						fixed += gap
					}
					if sizeKind(kids[k], "width") == "fill" {
						fills++
					}
				}
				w = math.Max(0, availW-fixed) / float64(fills)
			} else if wrap {
				continue
			}
			sizes[i] = wh{sizes[i].w, preferred(doc, c, w, 0, true, false, pforce{w: w, hasW: true}).h}
		}
		main, cross := 0.0, 0.0
		for i, s := range sizes {
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
		if wrap && ((row && hasBaseW) || (!row && hasBaseH)) {
			avail := availH
			if row {
				avail = availW
			}
			cross = 0
			for li, line := range splitLines(mainsOf(), avail, true, gap) {
				m := 0.0
				for _, k := range line {
					if row {
						m = math.Max(m, sizes[k].h)
					} else {
						m = math.Max(m, sizes[k].w)
					}
				}
				cross += m
				if li > 0 {
					cross += gap
				}
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
		if fo.hasW {
			w = fo.w
		}
		if fo.hasH {
			h = fo.h
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
		prefW, prefH        float64
		baseW, baseH        float64
		fillMain, fillCross bool
		reflow              bool
	}
	bases := make([]base, len(kids))
	for i, c := range kids {
		var p wh
		if row {
			p = preferred(doc, c, 0, innerH, false, true, pforce{})
		} else {
			p = preferred(doc, c, innerW, 0, true, false, pforce{})
		}
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
			n: c, prefW: p.w, prefH: p.h, baseW: bw, baseH: bh,
			fillMain:  (row && sizeKind(c, "width") == "fill") || (!row && sizeKind(c, "height") == "fill"),
			fillCross: (row && sizeKind(c, "height") == "fill") || (!row && sizeKind(c, "width") == "fill"),
			reflow:    hasFlow(c) && hasWrap(doc, c),
		}
	}
	mainOf := func(b base) float64 {
		if row {
			return b.baseW
		}
		return b.baseH
	}
	mainInner, crossInner := innerH, innerW
	if row {
		mainInner, crossInner = innerW, innerH
	}
	wrap := lay.Bool("wrap")
	mains := make([]float64, len(bases))
	for i, b := range bases {
		mains[i] = mainOf(b)
	}
	lines := splitLines(mains, mainInner, wrap, gap)
	align := lay.Str("align")
	justify := lay.Str("justify")

	type item struct {
		n    *Node
		w, h float64
	}
	sizeItem := func(b base, fillEach, crossAvail float64, hasCross bool) item {
		w, h := b.baseW, b.baseH
		if b.fillMain {
			if row {
				w = fillEach
			} else {
				h = fillEach
			}
		}
		if b.fillCross {
			switch {
			case !hasCross && row:
				h = b.prefH
			case !hasCross:
				w = b.prefW
			case row:
				h = crossAvail
			default:
				w = crossAvail
			}
		} else if align == "stretch" && hasCross {
			crossHug := (row && sizeKind(b.n, "height") == "hug") || (!row && sizeKind(b.n, "width") == "hug")
			if crossHug {
			} else if row && !sizeNumOk(b.n, "height") {
				h = crossAvail
			} else if !row && !sizeNumOk(b.n, "width") {
				w = crossAvail
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
		if b.reflow {
			if sizeKind(b.n, "height") == "hug" {
				h = preferred(doc, b.n, w, 0, true, false, pforce{w: w, hasW: true}).h
			}
			if sizeKind(b.n, "width") == "hug" && hasFlow(b.n) && b.n.Obj("layout").Str("mode") == "column" {
				w = preferred(doc, b.n, 0, h, false, true, pforce{h: h, hasH: true}).w
			}
		}
		return item{b.n, math.Max(0, w), math.Max(0, h)}
	}

	type lineT struct {
		members  []base
		fillEach float64
	}
	lineItems := make([]lineT, len(lines))
	for li, idx := range lines {
		members := make([]base, len(idx))
		fixed := 0.0
		fills := 0
		for j, i := range idx {
			members[j] = bases[i]
			fixed += mainOf(bases[i])
			if j > 0 {
				fixed += gap
			}
			if bases[i].fillMain {
				fills++
			}
		}
		fillEach := 0.0
		if fills > 0 {
			fillEach = math.Max(0, mainInner-fixed) / float64(fills)
		}
		lineItems[li] = lineT{members, fillEach}
	}

	lineCross := make([]float64, len(lineItems))
	for li := range lineCross {
		lineCross[li] = crossInner
	}
	if wrap {
		sum := 0.0
		for li, l := range lineItems {
			m := 0.0
			for _, b := range l.members {
				it := sizeItem(b, l.fillEach, 0, false)
				if row {
					m = math.Max(m, it.h)
				} else {
					m = math.Max(m, it.w)
				}
			}
			lineCross[li] = m
			sum += m
		}
		if len(lineCross) > 0 {
			extra := crossInner - (sum + gap*float64(len(lineCross)-1))
			if extra > 0 {
				for li := range lineCross {
					lineCross[li] += extra / float64(len(lineCross))
				}
			}
		}
	}

	crossCursor := 0.0
	for li, l := range lineItems {
		placed := make([]item, len(l.members))
		totalMain := 0.0
		for i, b := range l.members {
			placed[i] = sizeItem(b, l.fillEach, lineCross[li], true)
			if row {
				totalMain += placed[i].w
			} else {
				totalMain += placed[i].h
			}
			if i > 0 {
				totalMain += gap
			}
		}
		spare := mainInner - totalMain
		main0 := 0.0
		if justify == "center" {
			main0 = spare / 2
		} else if justify == "end" {
			main0 = spare
		}
		betweenGap := gap
		if justify == "between" && len(placed) > 1 {
			betweenGap = gap + math.Max(0, spare)/float64(len(placed)-1)
		}
		cursor := main0
		for _, p := range placed {
			cross := 0.0
			crossSpare := lineCross[li] - p.w
			if row {
				crossSpare = lineCross[li] - p.h
			}
			if align == "center" {
				cross = crossSpare / 2
			} else if align == "end" {
				cross = crossSpare
			}
			cross += crossCursor
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
		}
		crossCursor += lineCross[li] + gap
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
		pref := preferred(doc, n, parentW, parentH, hasParent, hasParent, pforce{})
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
	pref := preferred(doc, n, parentW, parentH, hasParent, hasParent, pforce{})
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

type LayoutOptions struct {
	RootID string
	IDs    []string
}

func Layout(doc *Document, opts LayoutOptions) (map[string]LayoutBox, error) {
	if opts.RootID != "" && GetNode(doc, opts.RootID) == nil {
		return nil, fmt.Errorf(`node "%s" does not exist`, opts.RootID)
	}
	var placed []place
	var pageIDs []string
	seen := map[string]bool{}
	addPage := func(id string) {
		if !seen[id] {
			seen[id] = true
			pageIDs = append(pageIDs, id)
		}
	}
	pageOf := func(id string) string {
		if n := GetNode(doc, id); n != nil && n.Str("type") == "page" {
			return id
		}
		return pageIdOf(doc, id)
	}
	if opts.RootID != "" {
		addPage(pageOf(opts.RootID))
	} else {
		for _, id := range opts.IDs {
			if GetNode(doc, id) != nil {
				addPage(pageOf(id))
			}
		}
	}
	if len(pageIDs) == 0 {
		first := ""
		if p := FirstPage(doc); p != nil {
			first = p.Str("id")
		}
		addPage(first)
	}
	for _, pageID := range pageIDs {
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
