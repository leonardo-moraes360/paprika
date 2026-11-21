package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/htmlImport.ts: HTML with inline styles → nodes (the inverse of nodeStyle).

type textStyle struct {
	color, fontFamily, textAlign                       string
	fontSize, fontWeight, lineHeight, letterSpacing *float64
	pre                                                *bool
}

type htmlCtx struct {
	mode string // "row", "column" or "" (no layout)
	text textStyle
	warn func(string)
}

var (
	paprikaTypes = map[string]bool{"frame": true, "rect": true, "ellipse": true, "text": true, "image": true, "path": true, "group": true}
	htmlSkip     = map[string]bool{"head": true, "script": true, "style": true, "template": true, "noscript": true, "meta": true, "link": true, "title": true, "iframe": true, "object": true, "embed": true, "video": true, "audio": true, "canvas": true, "input": true, "select": true, "textarea": true}
	htmlInline   = map[string]bool{"span": true, "b": true, "strong": true, "i": true, "em": true, "a": true, "u": true, "small": true, "code": true, "label": true, "br": true, "sup": true, "sub": true, "mark": true, "abbr": true, "s": true, "font": true}
	headingSize  = map[string]float64{"h1": 32, "h2": 24, "h3": 18.72, "h4": 16, "h5": 13.28, "h6": 10.72}
	htmlAlign     = map[string]string{"flex-start": "start", "start": "start", "center": "center", "flex-end": "end", "end": "end", "stretch": "stretch", "normal": "stretch"}
	htmlJustify   = map[string]string{"flex-start": "start", "start": "start", "center": "center", "flex-end": "end", "end": "end", "space-between": "between", "normal": "start"}

	pxRe        = regexp.MustCompile(`^(-?(?:\d+\.?\d*|\.\d+))(px)?$`)
	wsRunRe     = regexp.MustCompile(`[` + jsWS + `]+`)
	wsCommaRe   = regexp.MustCompile(`[` + jsWS + `,]+`)
	collapseRe  = regexp.MustCompile(`[ \t\r\n\f]+`)
	edgeSpaceRe = regexp.MustCompile(`^ +| +$`)
	edgeNLRe    = regexp.MustCompile(`^\n+|\n+$`)
	fontBadRe   = regexp.MustCompile(`[;{}<>()]`)
	flexFillRe  = regexp.MustCompile(`^1(?:[` + jsWS + `]+1[` + jsWS + `]+0(?:px|%)?)?$`)
	rotateRe    = regexp.MustCompile(`rotate\((-?[\d.]+)deg\)`)
	borderRe    = regexp.MustCompile(`^(\d+(?:\.\d+)?)px[` + jsWS + `]+(?:solid|dashed|dotted|double)[` + jsWS + `]+(.+)$`)
	shadowRe    = regexp.MustCompile(`^(-?[\d.]+)px[` + jsWS + `]+(-?[\d.]+)px[` + jsWS + `]+([\d.]+)px(?:[` + jsWS + `]+(-?[\d.]+)px)?[` + jsWS + `]+(.+)$`)
	dropShRe    = regexp.MustCompile(`drop-shadow\((-?[\d.]+)px[` + jsWS + `]+(-?[\d.]+)px[` + jsWS + `]+([\d.]+)px[` + jsWS + `]+(.+)\)$`)
	imgSrcRe    = regexp.MustCompile(`^(?:https?:|data:image/)`)
)

func fptr(v float64) *float64 { return &v }

// px is "12px" or "0" → 12/0; anything else → nil.
func cssPxValue(v string, ok bool) *float64 {
	if !ok {
		return nil
	}
	m := pxRe.FindStringSubmatch(jsonv.Trim(v))
	if m == nil {
		return nil
	}
	n := jsonv.ToNumber(m[1])
	if m[2] == "" && n != 0 {
		return nil
	}
	return fptr(n)
}

func cssPx(css map[string]string, k string) *float64 {
	v, ok := css[k]
	return cssPxValue(v, ok)
}

func pxList(v string) []float64 {
	if v == "" {
		return nil
	}
	raw := wsRunRe.Split(jsonv.Trim(v), -1)
	if len(raw) > 4 {
		return nil
	}
	p := make([]float64, len(raw))
	for i, s := range raw {
		n := cssPxValue(s, true)
		if n == nil {
			return nil
		}
		p[i] = *n
	}
	switch len(p) {
	case 2:
		return []float64{p[0], p[1], p[0], p[1]}
	case 3:
		return []float64{p[0], p[1], p[2], p[1]}
	}
	return p
}

func padValue(pad []float64, single bool) any {
	same := true
	for _, v := range pad {
		if v != pad[0] {
			same = false
		}
	}
	if single || same {
		return pad[0]
	}
	out := make([]any, len(pad))
	for i, v := range pad {
		out[i] = v
	}
	return out
}

func htmlColor(v string, ctx *htmlCtx) string {
	if v == "" {
		return ""
	}
	s := jsonv.Trim(v)
	if svgURLRe.MatchString(s) {
		ctx.warn("imagens de fundo (url()) não são importadas")
		return ""
	}
	if strings.ContainsAny(s, ";{}<>") || jsonv.Len16(s) > 200 {
		return ""
	}
	return s
}

func isTextual(e *MarkupElement) bool {
	for _, c := range e.Children {
		if el, ok := c.(*MarkupElement); ok {
			if !htmlInline[el.Tag] || !isTextual(el) {
				return false
			}
		}
	}
	return true
}

// visibleText is the text as a browser shows it (collapsed spaces, <br> as a line break), or raw if pre.
func visibleText(e *MarkupElement, pre bool) string {
	var b strings.Builder
	var walk func(*MarkupElement)
	walk = func(x *MarkupElement) {
		for _, c := range x.Children {
			switch v := c.(type) {
			case string:
				if pre {
					b.WriteString(v)
				} else {
					b.WriteString(collapseRe.ReplaceAllString(v, " "))
				}
			case *MarkupElement:
				if v.Tag == "br" {
					b.WriteString("\n")
				} else {
					walk(v)
				}
			}
		}
	}
	walk(e)
	out := b.String()
	if pre {
		return out
	}
	lines := strings.Split(out, "\n")
	for i, l := range lines {
		lines[i] = edgeSpaceRe.ReplaceAllString(l, "")
	}
	return edgeNLRe.ReplaceAllString(strings.Join(lines, "\n"), "")
}

func isInteger(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) }

func textStyleOf(css map[string]string, tag string, parent textStyle, ctx *htmlCtx) textStyle {
	t := parent
	if c := htmlColor(css["color"], ctx); c != "" {
		t.color = c
	}
	if ff := css["font-family"]; ff != "" {
		if f := jsonv.Slice16(fontBadRe.ReplaceAllString(ff, ""), 200); f != "" {
			t.fontFamily = f
		}
	}
	h, isHeading := headingSize[tag]
	if fs := cssPx(css, "font-size"); fs != nil && *fs >= 1 {
		t.fontSize = fptr(math.Min(1000, *fs))
	} else if css["font-size"] != "" {
		ctx.warn(fmt.Sprintf("font-size \"%s\" não é px; ignorado", css["font-size"]))
	} else if isHeading {
		t.fontSize = fptr(h)
	}
	if fw := css["font-weight"]; fw != "" {
		var n float64
		switch fw {
		case "bold", "bolder":
			n = 700
		case "normal", "lighter":
			n = 400
		default:
			n = jsonv.ToNumber(fw)
		}
		if isInteger(n) && n >= 100 && n <= 900 {
			t.fontWeight = fptr(n)
		}
	} else if isHeading || tag == "b" || tag == "strong" {
		t.fontWeight = fptr(700)
	}
	if lh := css["line-height"]; lh != "" {
		p := cssPxValue(lh, true)
		if strings.HasSuffix(jsonv.Trim(lh), "px") && p != nil {
			base := 16.0
			if t.fontSize != nil {
				base = *t.fontSize
			}
			t.lineHeight = fptr(Round4(*p / base))
		} else if lh == "normal" {
			t.lineHeight = fptr(1.2)
		} else if n := jsonv.ToNumber(lh); !math.IsNaN(n) && !math.IsInf(n, 0) {
			t.lineHeight = fptr(n)
		}
	}
	if ls := cssPx(css, "letter-spacing"); ls != nil {
		t.letterSpacing = ls
	}
	switch css["text-align"] {
	case "left", "start":
		t.textAlign = "left"
	case "center":
		t.textAlign = "center"
	case "right", "end":
		t.textAlign = "right"
	}
	if ws := css["white-space"]; ws != "" {
		pre := ws == "pre" || ws == "pre-wrap" || ws == "pre-line" || ws == "break-spaces"
		t.pre = &pre
	}
	return t
}

func (t textStyle) isPre() bool { return t.pre != nil && *t.pre }

func applyText(node *jsonv.Object, t textStyle) {
	if t.color != "" {
		node.Set("color", t.color)
	}
	if t.fontFamily != "" {
		node.Set("fontFamily", t.fontFamily)
	}
	if t.fontSize != nil {
		node.Set("fontSize", *t.fontSize)
	}
	if t.fontWeight != nil {
		node.Set("fontWeight", *t.fontWeight)
	}
	if t.lineHeight != nil {
		node.Set("lineHeight", math.Min(10, math.Max(0, *t.lineHeight)))
	}
	if t.letterSpacing != nil && *t.letterSpacing != 0 {
		node.Set("letterSpacing", *t.letterSpacing)
	}
	if t.textAlign != "" {
		node.Set("textAlign", t.textAlign)
	}
}

// boxProps sets position, size and paint (the inverse of nodeStyle).
func boxProps(node *jsonv.Object, css map[string]string, ctx *htmlCtx, foreign bool) {
	pos := css["position"]
	absolute := pos == "absolute" || pos == "fixed" || ctx.mode == ""
	if pos == "fixed" || pos == "sticky" {
		ctx.warn(fmt.Sprintf("position: %s tratado como absolute", pos))
	}
	if absolute {
		if x := cssPx(css, "left"); x != nil {
			node.Set("x", *x)
		}
		if y := cssPx(css, "top"); y != nil {
			node.Set("y", *y)
		}
	}
	size := func(axis string) any {
		v, has := css[axis]
		if n := cssPxValue(v, has); n != nil {
			return math.Max(0, *n)
		}
		if v == "max-content" || v == "fit-content" || v == "min-content" {
			return "hug"
		}
		if v == "100%" {
			return "fill"
		}
		if v != "" && v != "auto" {
			ctx.warn(fmt.Sprintf("%s \"%s\" não é suportado; usando hug", axis, v))
		}
		main := (ctx.mode == "row" && axis == "width") || (ctx.mode == "column" && axis == "height")
		if ctx.mode != "" && main && flexFillRe.MatchString(css["flex"]) {
			return "fill"
		}
		if ctx.mode != "" && !main && css["align-self"] == "stretch" {
			return "fill"
		}
		if v != "" {
			return "hug"
		}
		if foreign && ctx.mode == "column" && axis == "width" {
			return "fill"
		}
		return "hug"
	}
	isGroup := node.Str("type") == "group"
	if !isGroup {
		node.Set("width", size("width"))
		node.Set("height", size("height"))
	}
	if rot := rotateRe.FindStringSubmatch(css["transform"]); rot != nil && !isGroup {
		node.Set("rotation", jsonv.ToNumber(rot[1]))
	}
	op := 1.0
	if v, ok := css["opacity"]; ok {
		op = jsonv.ToNumber(v)
	}
	if !math.IsNaN(op) && !math.IsInf(op, 0) && op != 1 {
		node.Set("opacity", math.Min(1, math.Max(0, op)))
	}
	if css["display"] == "none" {
		node.Set("visible", false)
	}
	if isGroup {
		return
	}
	bg, ok := css["background-color"]
	if !ok {
		bg = css["background"]
	}
	if fill := htmlColor(bg, ctx); fill != "" && (!foreign || (fill != "transparent" && fill != "none")) {
		node.Set("fill", fill)
	}
	if m := borderRe.FindStringSubmatch(jsonv.Trim(css["border"])); m != nil {
		if c := htmlColor(m[2], ctx); c != "" {
			node.Set("stroke", jsonv.NewObject("color", c, "width", jsonv.ToNumber(m[1])))
		}
	}
	if r := cssPx(css, "border-radius"); r != nil && *r > 0 && node.Str("type") != "ellipse" {
		node.Set("radius", *r)
	}
	if m := shadowRe.FindStringSubmatch(jsonv.Trim(css["box-shadow"])); m != nil {
		if c := htmlColor(m[5], ctx); c != "" {
			spread := 0.0
			if m[4] != "" {
				spread = jsonv.ToNumber(m[4])
			}
			node.Set("shadow", jsonv.NewObject("x", jsonv.ToNumber(m[1]), "y", jsonv.ToNumber(m[2]), "blur", jsonv.ToNumber(m[3]), "spread", spread, "color", c))
		}
	}
}

func layoutOf(css map[string]string, foreignFlow bool) *jsonv.Object {
	display := css["display"]
	flex := display == "flex" || display == "inline-flex"
	if !flex && !foreignFlow {
		return nil
	}
	mode := "column"
	if flex {
		if dir := css["flex-direction"]; dir != "column" && dir != "column-reverse" {
			mode = "row"
		}
	}
	layout := jsonv.NewObject("mode", mode)
	if gap := cssPx(css, "gap"); gap != nil && *gap != 0 {
		layout.Set("gap", *gap)
	}
	if pad := pxList(css["padding"]); pad != nil {
		layout.Set("padding", padValue(pad, len(pad) == 1))
	}
	if flex {
		ai, ok := css["align-items"]
		if !ok {
			ai = "normal"
		}
		a, ok := htmlAlign[ai]
		if !ok {
			a = "stretch"
		}
		layout.Set("align", a)
		jc, ok := css["justify-content"]
		if !ok {
			jc = "normal"
		}
		j, ok := htmlJustify[jc]
		if !ok {
			j = "start"
		}
		layout.Set("justify", j)
		if css["flex-wrap"] == "wrap" {
			layout.Set("wrap", true)
		}
	} else {
		layout.Set("align", "stretch")
	}
	return layout
}

func pathNode(e *MarkupElement, css map[string]string, ctx *htmlCtx) *jsonv.Object {
	p := FindElement(e, "path")
	if p == nil || p.Attrs["d"] == "" {
		return nil
	}
	node := jsonv.NewObject("type", "path", "d", p.Attrs["d"])
	boxProps(node, css, ctx, false)
	node.Delete("fill")
	node.Delete("stroke")
	node.Delete("shadow")
	parts := wsCommaRe.Split(jsonv.Trim(e.Attrs["viewbox"]), -1)
	if len(parts) == 4 {
		vb := make([]any, 4)
		okAll := true
		nums := make([]float64, 4)
		for i, s := range parts {
			n := jsonv.ToNumber(s)
			if math.IsNaN(n) || math.IsInf(n, 0) {
				okAll = false
			}
			nums[i] = n
			vb[i] = n
		}
		if okAll && nums[2] > 0 && nums[3] > 0 {
			node.Set("viewBox", vb)
		}
	}
	if fill := p.Attrs["fill"]; fill != "" && fill != "none" {
		node.Set("fill", fill)
	}
	if p.Attrs["fill-rule"] == "evenodd" {
		node.Set("fillRule", "evenodd")
	}
	if st := p.Attrs["stroke"]; st != "" && st != "none" {
		w := 1.0
		if v, ok := p.Attrs["stroke-width"]; ok {
			w = jsonv.ToNumber(v)
		}
		node.Set("stroke", jsonv.NewObject("color", st, "width", w))
	}
	if c := p.Attrs["stroke-linecap"]; c != "" && c != "round" {
		node.Set("strokeCap", c)
	}
	if j := p.Attrs["stroke-linejoin"]; j != "" && j != "round" {
		node.Set("strokeJoin", j)
	}
	if m := dropShRe.FindStringSubmatch(jsonv.Trim(css["filter"])); m != nil {
		node.Set("shadow", jsonv.NewObject("x", jsonv.ToNumber(m[1]), "y", jsonv.ToNumber(m[2]), "blur", jsonv.ToNumber(m[3]), "spread", 0.0, "color", m[4]))
	}
	return node
}

func convertChildren(e *MarkupElement, ctx *htmlCtx) []*jsonv.Object {
	var out []*jsonv.Object
	mixed := false
	for _, c := range e.Children {
		if s, ok := c.(string); ok && jsonv.Trim(s) != "" {
			mixed = true
			break
		}
	}
	for _, c := range e.Children {
		if s, ok := c.(string); ok {
			text := s
			if !ctx.text.isPre() {
				text = jsonv.Trim(collapseRe.ReplaceAllString(s, " "))
			}
			if !mixed || text == "" {
				continue
			}
			w := "hug"
			if ctx.mode == "column" {
				w = "fill"
			}
			node := jsonv.NewObject("type", "text", "text", text, "width", w, "height", "hug")
			applyText(node, ctx.text)
			out = append(out, node)
			continue
		}
		out = append(out, convertElement(c.(*MarkupElement), ctx)...)
	}
	return out
}

func convertElement(e *MarkupElement, ctx *htmlCtx) []*jsonv.Object {
	if htmlSkip[e.Tag] {
		return nil
	}
	if e.Attrs["class"] != "" {
		ctx.warn("classes CSS não são aplicadas; só estilos inline (style=\"\")")
	}
	css := ParseStyle(e.Attrs["style"])
	ptype := ""
	if d := e.Attrs["data-paprika-type"]; paprikaTypes[d] {
		ptype = d
	}
	name := jsonv.Slice16(e.Attrs["data-name"], 200)
	named := func(n *jsonv.Object) []*jsonv.Object {
		if name != "" {
			n.Set("name", name)
		}
		return []*jsonv.Object{n}
	}
	text := textStyleOf(css, e.Tag, ctx.text, ctx)

	if ptype == "path" {
		if n := pathNode(e, css, ctx); n != nil {
			return named(n)
		}
		return nil
	}
	if ptype == "" && e.Tag == "svg" {
		r, _ := ImportSVG(e, ImportOptions{})
		for _, w := range r.Warnings {
			ctx.warn(w)
		}
		return r.Nodes
	}
	if ptype == "image" || (ptype == "" && e.Tag == "img") {
		src := e.Attrs["src"]
		if !imgSrcRe.MatchString(src) {
			ctx.warn("<img> sem src http(s) ou data:image/ ignorado")
			return nil
		}
		n := jsonv.NewObject("type", "image", "src", src)
		boxProps(n, css, ctx, ptype == "")
		if ptype == "" {
			w, hasW := e.Attrs["width"]
			h, hasH := e.Attrs["height"]
			if pw := cssPxValue(w, hasW); pw != nil && isHug(n, "width") {
				n.Set("width", *pw)
			}
			if ph := cssPxValue(h, hasH); ph != nil && isHug(n, "height") {
				n.Set("height", *ph)
			}
		}
		if alt := e.Attrs["alt"]; alt != "" {
			n.Set("alt", alt)
		}
		if fit := css["object-fit"]; fit == "cover" || fit == "contain" || fit == "fill" {
			n.Set("fit", fit)
		}
		return named(n)
	}
	if ptype == "rect" || ptype == "ellipse" {
		n := jsonv.NewObject("type", ptype)
		boxProps(n, css, ctx, false)
		return named(n)
	}
	// A flex container lays out each child as an item, even when it only holds text.
	flex := css["display"] == "flex" || css["display"] == "inline-flex"
	if ptype == "text" || (ptype == "" && !flex && isTextual(e) && visibleText(e, text.isPre()) != "") {
		pre := ptype == "text" || text.isPre()
		n := jsonv.NewObject("type", "text", "text", visibleText(e, pre))
		boxProps(n, css, ctx, ptype == "")
		applyText(n, text)
		if ptype == "" && (n.Has("fill") || n.Has("stroke") || css["padding"] != "") {
			// A button or a tag: the background becomes a frame around the text.
			box := jsonv.NewObject("type", "frame", "children", []any{})
			boxProps(box, css, ctx, true)
			box.Set("clip", css["overflow"] == "hidden")
			layout := layoutOf(css, false)
			if layout == nil {
				layout = jsonv.NewObject("mode", "row")
			}
			layout.Set("align", "center")
			justify := "start"
			if text.textAlign == "center" {
				justify = "center"
			}
			layout.Set("justify", justify)
			box.Set("layout", layout)
			if pad := pxList(css["padding"]); pad != nil {
				layout.Set("padding", padValue(pad, false))
			}
			n.Set("width", "hug")
			n.Set("height", "hug")
			for _, k := range []string{"fill", "stroke", "radius", "shadow", "visible", "x", "y", "rotation", "opacity"} {
				n.Delete(k)
			}
			box.Set("children", []any{n})
			return named(box)
		}
		return named(n)
	}
	isGroup := ptype == "group"
	typ := "frame"
	if isGroup {
		typ = "group"
	}
	n := jsonv.NewObject("type", typ)
	boxProps(n, css, ctx, ptype == "")
	if !isGroup {
		n.Set("clip", css["overflow"] == "hidden")
	}
	hasBlocks := false
	for _, c := range e.Elements() {
		if !htmlSkip[c.Tag] && ParseStyle(c.Attrs["style"])["position"] != "absolute" {
			hasBlocks = true
			break
		}
	}
	var layout *jsonv.Object
	if !isGroup {
		layout = layoutOf(css, ptype == "" && hasBlocks)
	}
	mode := ""
	if layout != nil {
		n.Set("layout", layout)
		mode = layout.Str("mode")
	}
	kids := convertChildren(e, &htmlCtx{mode: mode, text: text, warn: ctx.warn})
	n.Set("children", nodesAny(kids))
	if isGroup && len(kids) == 0 {
		return nil
	}
	return named(n)
}

func isHug(n *jsonv.Object, k string) bool {
	v, _ := n.Get(k)
	s, ok := v.(string)
	return ok && s == "hug"
}

// ImportHTML converts HTML into nodes; X/Y shift the top-level nodes (absolutely positioned).
func ImportHTML(src string, opts ImportOptions) (ImportResult, error) {
	warnings, warn := newWarner()
	root, err := ParseMarkup(src)
	if err != nil {
		return ImportResult{}, err
	}
	body := FindElement(root, "body")
	if body == nil {
		body = root
	}
	nodes := convertChildren(body, &htmlCtx{warn: warn})
	for _, n := range nodes {
		if opts.X != 0 {
			n.Set("x", Round4(n.Num("x")+opts.X))
		}
		if opts.Y != 0 {
			n.Set("y", Round4(n.Num("y")+opts.Y))
		}
	}
	if len(nodes) == 0 {
		*warnings = append(*warnings, "o HTML não tem elementos para importar")
	}
	return ImportResult{Nodes: nodes, Warnings: *warnings}, nil
}
