package core

import (
	"math"
	"math/big"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type RGBA struct{ R, G, B, A float64 }

var named = map[string]RGBA{
	"white":       {255, 255, 255, 1},
	"black":       {0, 0, 0, 1},
	"transparent": {0, 0, 0, 0},
	"silver":      {192, 192, 192, 1},
	"gray":        {128, 128, 128, 1},
	"grey":        {128, 128, 128, 1},
	"maroon":      {128, 0, 0, 1},
	"red":         {255, 0, 0, 1},
	"purple":      {128, 0, 128, 1},
	"fuchsia":     {255, 0, 255, 1},
	"magenta":     {255, 0, 255, 1},
	"green":       {0, 128, 0, 1},
	"lime":        {0, 255, 0, 1},
	"olive":       {128, 128, 0, 1},
	"yellow":      {255, 255, 0, 1},
	"navy":        {0, 0, 128, 1},
	"blue":        {0, 0, 255, 1},
	"teal":        {0, 128, 128, 1},
	"aqua":        {0, 255, 255, 1},
	"cyan":        {0, 255, 255, 1},
	"orange":      {255, 165, 0, 1},
}

const jsWS = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var (
	reHex = regexp.MustCompile(`^#([0-9a-f]{3,8})$`)
	reRGB = regexp.MustCompile(`^rgba?\([` + jsWS + `]*([\d.]+)[` + jsWS + `,]+([\d.]+)[` + jsWS + `,]+([\d.]+)(?:[` + jsWS + `,/]+([\d.]+%?))?[` + jsWS + `]*\)$`)
)

func ParseColor(input string) (RGBA, bool) {
	s := strings.ToLower(jsonv.Trim(input))
	if c, ok := named[s]; ok {
		return c, true
	}
	if m := reHex.FindStringSubmatch(s); m != nil {
		h := m[1]
		if len(h) == 3 || len(h) == 4 {
			var b strings.Builder
			for _, c := range h {
				b.WriteRune(c)
				b.WriteRune(c)
			}
			h = b.String()
		}
		if len(h) != 6 && len(h) != 8 {
			return RGBA{}, false
		}
		n := func(i int) float64 {
			v, _ := strconv.ParseUint(h[i:i+2], 16, 8)
			return float64(v)
		}
		a := 1.0
		if len(h) == 8 {
			a = n(6) / 255
		}
		return RGBA{n(0), n(2), n(4), a}, true
	}
	if m := reRGB.FindStringSubmatch(s); m != nil {
		a := 1.0
		if m[4] != "" {
			if strings.HasSuffix(m[4], "%") {
				a = jsonv.ParseFloat(m[4]) / 100
			} else {
				a = jsonv.ParseFloat(m[4])
			}
		}
		return RGBA{jsonv.ToNumber(m[1]), jsonv.ToNumber(m[2]), jsonv.ToNumber(m[3]), a}, true
	}
	if c, ok := parseModernColor(s, ParseColor); ok {
		return c, true
	}
	return RGBA{}, false
}

func blend(top, bottom RGBA) RGBA {
	a := top.A
	return RGBA{top.R*a + bottom.R*(1-a), top.G*a + bottom.G*(1-a), top.B*a + bottom.B*(1-a), 1}
}

func luminance(c RGBA) float64 {
	ch := func(v float64) float64 {
		s := v / 255
		if s <= 0.03928 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(c.R) + 0.7152*ch(c.G) + 0.0722*ch(c.B)
}

func ContrastRatio(a, b RGBA) float64 {
	l := []float64{luminance(a), luminance(b)}
	sort.Slice(l, func(i, j int) bool { return l[i] > l[j] })
	return (l[0] + 0.05) / (l[1] + 0.05)
}

func EffectiveBackground(doc *Document, node *Node) (RGBA, bool) {
	var layers []RGBA
	var cur *Node
	if t := node.Str("type"); t == "text" || t == "shape" {
		cur = node
	} else {
		cur = parentOf(doc, node)
	}
	for cur != nil {
		if nodeGradient(cur) != nil {
			return RGBA{}, false
		}
		if fill, ok := cur.Get("fill"); ok {
			c, ok := ParseColor(jsString(ResolveValue(doc, fill, ModeOf(doc, cur))))
			if !ok {
				return RGBA{}, false
			}
			layers = append(layers, c)
			if c.A >= 1 {
				break
			}
		}
		cur = parentOf(doc, cur)
	}
	bg := named["white"]
	for _, layer := range slices.Backward(layers) {
		bg = blend(layer, bg)
	}
	return bg, true
}

type LintIssue struct {
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	NodeID   string `json:"nodeId"`
	Message  string `json:"message"`
}

func tokenRefs(n *Node) []string {
	var refs []string
	check := func(v any) {
		if s, ok := v.(string); ok && strings.HasPrefix(s, "$") {
			refs = append(refs, s[1:])
		}
	}
	if v, ok := n.Get("fill"); ok {
		check(v)
	}
	if st := n.Obj("stroke"); st != nil {
		check(st.Str("color"))
		w, _ := st.Get("width")
		check(w)
	}
	for _, sh := range shadowNodes(n) {
		check(sh.Str("color"))
		for _, k := range []string{"x", "y", "blur", "spread"} {
			v, _ := sh.Get(k)
			check(v)
		}
	}
	if ol := n.Obj("outline"); ol != nil {
		check(ol.Str("color"))
		w, _ := ol.Get("width")
		check(w)
		if off, ok := ol.Get("offset"); ok {
			check(off)
		}
	}
	if f := n.Obj("filter"); f != nil {
		if b, ok := f.Get("blur"); ok {
			check(b)
		}
	}
	if f := n.Obj("backdropFilter"); f != nil {
		if b, ok := f.Get("blur"); ok {
			check(b)
		}
	}
	if r, ok := n.Get("radius"); ok {
		if arr, isArr := r.([]any); isArr {
			for _, v := range arr {
				check(v)
			}
		} else {
			check(r)
		}
	}
	if n.Str("type") == "frame" {
		if l := n.Obj("layout"); l != nil {
			g, _ := l.Get("gap")
			check(g)
			p, _ := l.Get("padding")
			if arr, ok := p.([]any); ok {
				for _, v := range arr {
					check(v)
				}
			} else {
				check(p)
			}
		}
	}
	if t := n.Str("type"); t == "text" || t == "shape" {
		c, _ := n.Get("color")
		check(c)
		fs, _ := n.Get("fontSize")
		check(fs)
		lh, _ := n.Get("lineHeight")
		check(lh)
	}
	if n.Str("type") == "text" {
		ls, _ := n.Get("letterSpacing")
		check(ls)
		for _, item := range n.Arr("runs") {
			o, ok := item.(*jsonv.Object)
			if !ok {
				continue
			}
			c, _ := o.Get("color")
			check(c)
			fs, _ := o.Get("fontSize")
			check(fs)
		}
	}
	if g := nodeGradient(n); g != nil {
		for _, s := range gradientStops(g) {
			c, _ := s.Get("color")
			check(c)
		}
	}
	return refs
}

func toFixed(x float64, digits int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.IsInf(x, 0) || math.Abs(x) >= 1e21 {
		return jsonv.FormatNumber(x)
	}
	neg := x < 0
	exact := new(big.Float).SetPrec(2000).SetFloat64(math.Abs(x)).Text('f', 1100)
	intPart, frac, _ := strings.Cut(exact, ".")
	frac += strings.Repeat("0", digits+1)
	keep := intPart + frac[:digits]
	rest := frac[digits:]
	n := new(big.Int)
	n.SetString(keep, 10)
	if rest[0] >= '5' {
		n.Add(n, big.NewInt(1))
	}
	s := n.String()
	for len(s) <= digits {
		s = "0" + s
	}
	out := s
	if digits > 0 {
		out = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	if neg && strings.Trim(out, "0.") != "" {
		out = "-" + out
	}
	return out
}

type LintOpts struct {
	RootID      string
	RootIDs     []string
	MinSeverity string
	MinFontSize float64
}

type LintGroup struct {
	Rule     string   `json:"rule"`
	Severity string   `json:"severity"`
	Count    int      `json:"count"`
	NodeIDs  []string `json:"nodeIds"`
	Message  string   `json:"message"`
}

func LintDocument(doc *Document, rootID string) []LintIssue {
	return LintDocumentOpts(doc, LintOpts{RootID: rootID})
}

func LintDocumentOpts(doc *Document, opts LintOpts) []LintIssue {
	issues := []LintIssue{}
	ids := lintIDs(doc, opts)
	minFont := opts.MinFontSize
	if minFont == 0 {
		minFont = 12
	}
	tokens := Tokens(doc)
	hasColorTokens := false
	for _, k := range tokens.Keys() {
		v, _ := tokens.Get(k)
		if s, ok := v.(string); ok {
			if _, isColor := ParseColor(s); isColor {
				hasColorTokens = true
				break
			}
		}
	}
	add := func(rule, sev, id, msg string) {
		issues = append(issues, LintIssue{rule, sev, id, msg})
	}

	for _, id := range ids {
		node := GetNode(doc, id)
		if node == nil {
			continue
		}
		typ := node.Str("type")
		themeMode := ModeOf(doc, node)
		if m := node.Str("mode"); (typ == "frame" || typ == "page") && m != "" && (Modes(doc) == nil || !Modes(doc).Has(m)) {
			add("unknown-mode", "warning", id, `mode "`+m+`" has no tokens (set_tokens with mode); the base tokens apply`)
		}
		for _, ref := range tokenRefs(node) {
			if _, ok := TokenValue(doc, ref, themeMode); !ok {
				add("unknown-token", "error", id, `token "$`+ref+`" does not exist`)
			}
		}

		if typ == "text" || typ == "shape" {
			if typ == "text" && jsonv.Trim(node.Str("text")) == "" {
				add("empty-text", "warning", id, "empty text")
			}
			fsv, _ := node.Get("fontSize")
			fs := ResolveValue(doc, fsv, themeMode)
			size, isNum := fs.(float64)
			if !isNum {
				size = jsonv.ParseFloat(jsString(fs))
			}
			if size < minFont && !inScaledMock(doc, node) {
				add("small-text", "warning", id, "font size "+jsString(size)+"px (< "+jsString(minFont)+"px)")
			}
			colorV, _ := node.Get("color")
			fg, fgOK := ParseColor(jsString(ResolveValue(doc, colorV, themeMode)))
			bg, bgOK := EffectiveBackground(doc, node)
			if fgOK && bgOK {
				ratio := ContrastRatio(blend(fg, bg), bg)
				fw, _ := node.Get("fontWeight")
				large := size >= 24 || (size >= 18.66 && ResolvedFontWeight(doc, fw, themeMode) >= 700)
				min := 4.5
				if large {
					min = 3
				}
				if ratio < min {
					extra := ""
					if large {
						extra = ", large text"
					}
					add("contrast", "error", id, "contrast "+toFixed(ratio, 2)+":1 below "+jsString(min)+":1 (WCAG AA"+extra+")")
				}
			}
			if hasColorTokens && !strings.HasPrefix(node.Str("color"), "$") {
				add("raw-color", "info", id, `literal color "`+node.Str("color")+`"; prefer a token`)
			}
		}

		if typ == "path" {
			_, hasFill := node.Get("fill")
			st := node.Obj("stroke")
			sw := 0.0
			if st != nil {
				w, _ := st.Get("width")
				sw, _ = ResolveLength(doc, w, ModeOf(doc, node))
			}
			if !hasFill && nodeGradient(node) == nil && !(sw > 0) {
				add("invisible-path", "warning", id, "a path without fill or stroke is invisible; set fill or stroke {color,width}")
			}
		}

		if typ == "image" && !node.Bool("decorative") && jsonv.Trim(node.Str("alt")) == "" {
			add("missing-alt", "warning", id, "image without alternative text (alt)")
		}

		if fill, ok := node.Get("fill"); ok && hasColorTokens {
			fs := fill.(string)
			if !strings.HasPrefix(fs, "$") && fs != "transparent" {
				add("raw-color", "info", id, `literal fill "`+fs+`"; prefer a token`)
			}
		}
		if g := nodeGradient(node); g != nil && hasColorTokens && typ != "group" && typ != "connector" {
			for _, s := range gradientStops(g) {
				c, _ := s.Get("color")
				if cs, ok := c.(string); ok && !strings.HasPrefix(cs, "$") {
					add("raw-color", "info", id, `literal gradient stop "`+cs+`"; prefer a token`)
				}
			}
		}

		if typ == "page" {
			continue
		}
		if typ == "group" && len(node.Arr("children")) == 0 {
			add("empty-group", "info", id, "empty group; delete it or move nodes into it")
		}

		if typ == "frame" && (node.Obj("layout") == nil || node.Obj("layout").Str("mode") == "none") && len(node.Arr("children")) > 0 {
			var axes []string
			for _, k := range []string{"width", "height"} {
				if v, _ := node.Get(k); v == "hug" {
					axes = append(axes, k)
				}
			}
			if len(axes) > 0 {
				add("hug-without-layout", "warning", id, strings.Join(axes, " and ")+` "hug" on a frame without layout is 0 px (its children are placed absolutely, so nothing is hugged); set layout {mode: "column"} or a number`)
			}
		}

		parent := parentOf(doc, node)
		absolute := parent != nil && parent.Str("type") == "frame" && (parent.Obj("layout") == nil || parent.Obj("layout").Str("mode") == "none")
		if absolute && node.Bool("visible") {
			pw, pwOK := mustNum(parent, "width")
			ph, phOK := mustNum(parent, "height")
			nw, nwOK := mustNum(node, "width")
			nh, nhOK := mustNum(node, "height")
			if pwOK && phOK && nwOK && nhOK {
				x, y := node.Num("x"), node.Num("y")
				if x < 0 || y < 0 || x+nw > pw || y+nh > ph {
					label := parent.Str("name")
					if label == "" {
						label = parent.Str("id")
					}
					cut := ""
					if parent.Bool("clip") {
						cut = " and will be clipped"
					}
					add("overflow", "warning", id, `goes outside "`+label+`" (`+jsString(pw)+"×"+jsString(ph)+")"+cut)
				}
			}
		}

		if typ == "frame" && node.Str("name") == "" && (parent == nil || parent.Str("type") == "page") {
			add("unnamed-frame", "info", id, "top-level frame without a name")
		}
	}
	issues = append(issues, PlacementLint(doc, ids)...)
	issues = append(issues, layoutLint(doc, ids)...)
	issues = append(issues, geometryLint(doc, ids)...)
	return finishLint(doc, issues, opts)
}

func mustNum(n *Node, k string) (float64, bool) {
	v, _ := n.Get(k)
	f, ok := v.(float64)
	return f, ok
}

func lintIDs(doc *Document, opts LintOpts) []string {
	roots := []string{}
	if opts.RootID != "" {
		roots = append(roots, opts.RootID)
	}
	roots = append(roots, opts.RootIDs...)
	if len(roots) == 0 {
		return Nodes(doc).Keys()
	}
	seen := map[string]bool{}
	out := []string{}
	for _, root := range roots {
		for _, id := range SubtreeIDs(doc, root) {
			if seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func sevRank(s string) int {
	switch s {
	case "error":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func finishLint(doc *Document, issues []LintIssue, opts LintOpts) []LintIssue {
	floor := 2
	if opts.MinSeverity != "" {
		floor = sevRank(opts.MinSeverity)
	}
	out := make([]LintIssue, 0, len(issues))
	for _, issue := range issues {
		if ignoredRule(GetNode(doc, issue.NodeID), issue.Rule) {
			continue
		}
		if sevRank(issue.Severity) > floor {
			continue
		}
		out = append(out, issue)
	}
	return out
}

func ignoredRule(n *Node, rule string) bool {
	if n == nil {
		return false
	}
	return slices.Contains(n.Strings("lintIgnore"), rule)
}

func inScaledMock(doc *Document, node *Node) bool {
	cur := node
	for cur != nil {
		if cur.Str("type") == "frame" && cur.Bool("scaledMock") {
			return true
		}
		pid := cur.Str("parentId")
		if pid == "" {
			return false
		}
		cur = GetNode(doc, pid)
	}
	return false
}

func GroupLint(issues []LintIssue, maxIDs int) []LintGroup {
	if maxIDs < 1 {
		maxIDs = 8
	}
	order := []string{}
	groups := map[string]*LintGroup{}
	for _, issue := range issues {
		g := groups[issue.Rule]
		if g == nil {
			g = &LintGroup{Rule: issue.Rule, Severity: issue.Severity, Message: issue.Message, NodeIDs: []string{}}
			groups[issue.Rule] = g
			order = append(order, issue.Rule)
		}
		g.Count++
		if len(g.NodeIDs) < maxIDs && !slices.Contains(g.NodeIDs, issue.NodeID) {
			g.NodeIDs = append(g.NodeIDs, issue.NodeID)
		}
	}
	out := make([]LintGroup, 0, len(order))
	for _, rule := range order {
		out = append(out, *groups[rule])
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := sevRank(out[i].Severity), sevRank(out[j].Severity)
		if ri != rj {
			return ri < rj
		}
		return out[i].Rule < out[j].Rule
	})
	return out
}

type lintBox struct{ x, y, w, h float64 }

const (
	lintTouch = 0.5
	lintNear  = 4
)

func lintGap(a, b lintBox) float64 {
	sepX := math.Max(0, math.Max(a.x-(b.x+b.w), b.x-(a.x+a.w)))
	sepY := math.Max(0, math.Max(a.y-(b.y+b.h), b.y-(a.y+a.h)))
	raw := 0.0
	switch {
	case sepX == 0 && sepY == 0:
		raw = 0
	case sepX == 0:
		raw = sepY
	case sepY == 0:
		raw = sepX
	default:
		raw = math.Hypot(sepX, sepY)
	}
	return Round4(raw)
}

func containsBox(outer, inner lintBox) bool {
	return inner.w > 0 && inner.h > 0 &&
		inner.x >= outer.x-lintTouch &&
		inner.y >= outer.y-lintTouch &&
		inner.x+inner.w <= outer.x+outer.w+lintTouch &&
		inner.y+inner.h <= outer.y+outer.h+lintTouch
}

func laidOut(doc *Document) map[string]lintBox {
	out := map[string]lintBox{}
	add := func(boxes map[string]LayoutBox) {
		for id, b := range boxes {
			out[id] = lintBox{b.X, b.Y, b.Width, b.Height}
		}
	}
	var pages []string
	for _, id := range doc.Strings("rootIds") {
		if n := GetNode(doc, id); n != nil && n.Str("type") == "page" {
			pages = append(pages, id)
		}
	}
	if len(pages) == 0 {
		if boxes, err := Layout(doc, LayoutOptions{}); err == nil {
			add(boxes)
		}
		return out
	}
	for _, id := range pages {
		if boxes, err := Layout(doc, LayoutOptions{RootID: id}); err == nil {
			add(boxes)
		}
	}
	return out
}

func isFlowFrame(n *Node) bool {
	if n == nil || n.Str("type") != "frame" {
		return false
	}
	lay := n.Obj("layout")
	return lay != nil && lay.Str("mode") != "" && lay.Str("mode") != "none"
}

func isCopy(n *Node) bool {
	return n != nil && n.Str("sourceId") != ""
}

func geomType(typ string) bool {
	switch typ {
	case "rect", "ellipse", "path", "shape", "image":
		return true
	default:
		return false
	}
}

func opaqueNode(doc *Document, n *Node) bool {
	if n == nil || !n.Bool("visible") {
		return false
	}
	typ := n.Str("type")
	switch typ {
	case "frame", "rect", "ellipse", "path", "shape", "image":
	default:
		return false
	}
	if n.Num("opacity") < 0.99 {
		return false
	}
	if nodeGradient(n) != nil {
		return false
	}
	fill, ok := n.Get("fill")
	if !ok {
		return false
	}
	if s, ok := fill.(string); !ok || s == "" {
		return false
	}
	c, ok := ParseColor(jsString(ResolveValue(doc, fill, ModeOf(doc, n))))
	return ok && c.A >= 0.99
}

func indexOfStr(list []string, id string) int {
	for i, s := range list {
		if s == id {
			return i
		}
	}
	return -1
}

func layoutLint(doc *Document, ids []string) []LintIssue {
	boxes := laidOut(doc)
	issues := []LintIssue{}
	for _, id := range ids {
		node := GetNode(doc, id)
		if node == nil || node.Str("type") != "frame" {
			continue
		}
		lay := node.Obj("layout")
		if lay == nil || lay.Str("mode") == "" || lay.Str("mode") == "none" {
			continue
		}
		frame, ok := boxes[id]
		if !ok {
			continue
		}
		mode := lay.Str("mode")
		var kids []string
		width, height := false, false
		for _, cid := range node.Strings("children") {
			child := GetNode(doc, cid)
			box, has := boxes[cid]
			if child == nil || !has || !child.Bool("visible") || child.Str("type") == "connector" {
				continue
			}
			overW := box.x < frame.x-lintTouch || box.x+box.w > frame.x+frame.w+lintTouch
			overH := box.y < frame.y-lintTouch || box.y+box.h > frame.y+frame.h+lintTouch
			if !overW && !overH {
				continue
			}
			kids = append(kids, cid)
			width = width || overW
			height = height || overH
		}
		if len(kids) == 0 {
			continue
		}
		w, wok := mustNum(node, "width")
		h, hok := mustNum(node, "height")
		if wok && hok && w == 100 && h == 100 {
			issues = append(issues, LintIssue{
				Rule: "hug-was-meant", Severity: "warning", NodeID: id,
				Message: "default 100×100 " + mode + " frame; children leave the box, so hug was meant (set width and height to \"hug\")",
			})
			continue
		}
		axes := "height"
		if width && height {
			axes = "width and height"
		} else if width {
			axes = "width"
		}
		labels := make([]string, len(kids))
		for i, cid := range kids {
			labels[i] = nodeLabel(GetNode(doc, cid), "")
		}
		shown := strings.Join(labels[:min(len(labels), 3)], ", ")
		if len(labels) > 3 {
			shown += " +" + jsString(float64(len(labels)-3))
		}
		issues = append(issues, LintIssue{
			Rule: "layout-overflow", Severity: "warning", NodeID: id,
			Message: mode + " children leave \"" + nodeLabel(node, "") + "\" (" + placeNum(frame.w) + "×" + placeNum(frame.h) + ") on " + axes + ": " + shown,
		})
	}
	return issues
}

func geometryLint(doc *Document, ids []string) []LintIssue {
	allow := map[string]bool{}
	for _, id := range ids {
		allow[id] = true
	}
	boxes := laidOut(doc)
	seen := map[string]bool{}
	issues := []LintIssue{}
	for _, id := range ids {
		node := GetNode(doc, id)
		if node == nil {
			continue
		}
		key := node.Str("parentId")
		if seen[key] {
			continue
		}
		seen[key] = true
		issues = append(issues, geometryParent(doc, key, allow, boxes)...)
	}
	return issues
}

func geometryParent(doc *Document, parentID string, allow map[string]bool, boxes map[string]lintBox) []LintIssue {
	if parentID != "" && isFlowFrame(GetNode(doc, parentID)) {
		return nil
	}
	children := siblingIDs(doc, parentID)
	var prims []string
	for _, id := range children {
		n := GetNode(doc, id)
		if n == nil || !n.Bool("visible") || isCopy(n) || !geomType(n.Str("type")) {
			continue
		}
		if _, ok := boxes[id]; ok {
			prims = append(prims, id)
		}
	}
	cluster := false
	for i := 0; i < len(prims) && !cluster; i++ {
		for j := i + 1; j < len(prims); j++ {
			if lintGap(boxes[prims[i]], boxes[prims[j]]) <= lintTouch {
				cluster = true
				break
			}
		}
	}
	parentLabel := "the canvas"
	if parentID != "" {
		parentLabel = nodeLabel(GetNode(doc, parentID), "")
	}
	issues := []LintIssue{}
	for _, id := range children {
		if !allow[id] {
			continue
		}
		n := GetNode(doc, id)
		box, has := boxes[id]
		if n == nil || !has || !n.Bool("visible") || isCopy(n) || !geomType(n.Str("type")) {
			continue
		}
		var others []string
		for _, oid := range children {
			if oid == id {
				continue
			}
			if _, ok := boxes[oid]; !ok {
				continue
			}
			o := GetNode(doc, oid)
			if o == nil || !o.Bool("visible") || o.Str("type") == "connector" || o.Str("type") == "page" {
				continue
			}
			others = append(others, oid)
		}
		nearest := math.Inf(1)
		for _, oid := range others {
			if g := lintGap(box, boxes[oid]); g < nearest {
				nearest = g
			}
		}
		if len(others) > 0 && cluster && nearest >= lintNear {
			issues = append(issues, LintIssue{
				Rule: "detached-sibling", Severity: "warning", NodeID: id,
				Message: "touches no sibling in \"" + parentLabel + "\" (nearest gap " + placeNum(nearest) + "px)",
			})
		}
		index := indexOfStr(children, id)
		for _, oid := range prims {
			if indexOfStr(children, oid) >= index {
				continue
			}
			g := lintGap(box, boxes[oid])
			if g > lintTouch && g < lintNear {
				issues = append(issues, LintIssue{
					Rule: "near-gap", Severity: "warning", NodeID: id,
					Message: placeNum(g) + "px from \"" + nodeLabel(GetNode(doc, oid), "") + "\" (under 4px)",
				})
			}
		}
		var cover *Node
		for _, oid := range children {
			if indexOfStr(children, oid) <= index {
				continue
			}
			o := GetNode(doc, oid)
			ob, ok := boxes[oid]
			if o == nil || !ok || !opaqueNode(doc, o) || !containsBox(ob, box) {
				continue
			}
			cover = o
		}
		if cover != nil {
			issues = append(issues, LintIssue{
				Rule: "fully-hidden", Severity: "warning", NodeID: id,
				Message: "fully hidden behind opaque \"" + nodeLabel(cover, "") + "\"",
			})
		}
	}
	return issues
}
