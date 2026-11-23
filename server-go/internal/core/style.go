package core

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/style.ts. The TypeScript nodeStyle stays the single reference
// (the canvas uses it); this port is locked to it by the golden fixtures.

// CSS is an ordered camelCase style object (values are string or float64).
type CSS = jsonv.Object

// StrokeStyleOf returns solid|dashed|dotted (default solid).
func StrokeStyleOf(stroke *jsonv.Object) string {
	if stroke == nil {
		return "solid"
	}
	if s := stroke.Str("style"); s != "" {
		return s
	}
	return "solid"
}

// StrokePositionOf returns inside|center|outside. Paths default to center; boxes to inside.
func StrokePositionOf(node *Node) string {
	if st := node.Obj("stroke"); st != nil {
		if p := st.Str("position"); p != "" {
			return p
		}
	}
	if node.Str("type") == "path" {
		return "center"
	}
	return "inside"
}

// StrokeDasharray is the dash pattern derived from width (same scale as connector dashes).
func strokeDashValue(doc *Document, raw any, vars bool, width float64, style string) string {
	if ref, ok := lengthVar(doc, raw, vars); ok {
		switch style {
		case "dashed":
			return "calc(" + ref + " * 3) calc(" + ref + " * 2.5)"
		case "dotted":
			return "calc(" + ref + " * 1) calc(" + ref + " * 1.5)"
		default:
			return ""
		}
	}
	return StrokeDasharray(width, style)
}

func StrokeDasharray(width float64, style string) string {
	switch style {
	case "dashed":
		return jsonv.FormatNumber(round2(width*3)) + " " + jsonv.FormatNumber(round2(width*2.5))
	case "dotted":
		return jsonv.FormatNumber(round2(width)) + " " + jsonv.FormatNumber(round2(width*1.5))
	default:
		return ""
	}
}

// ModeOf is the theme mode in effect for a node: its own or the nearest frame/page ancestor's.
func ModeOf(doc *Document, node *Node) string {
	for n, depth := node, 0; n != nil && depth < 1000; n, depth = parentOf(doc, n), depth+1 {
		if t := n.Str("type"); (t == "frame" || t == "page") && n.Str("mode") != "" {
			return n.Str("mode")
		}
	}
	return ""
}

// TokenValue is a token's value in the mode (when the mode defines it) or its base value.
func TokenValue(doc *Document, name, mode string) (any, bool) {
	if mode != "" {
		if modes := Modes(doc); modes != nil {
			if m := modes.Obj(mode); m != nil {
				if v, ok := m.Get(name); ok {
					return v, true
				}
			}
		}
	}
	return Tokens(doc).Get(name)
}

// ResolveValue resolves `$token` against doc.tokens, or doc.modes[mode] first when a mode is
// given (tokens may chain, up to 8 levels).
func ResolveValue(doc *Document, v any, mode string) any {
	cur := v
	for range 8 {
		s, ok := cur.(string)
		if !ok || !strings.HasPrefix(s, "$") {
			break
		}
		next, has := TokenValue(doc, s[1:], mode)
		if !has {
			return cur
		}
		cur = next
	}
	return cur
}

// CSSVarName is the CSS custom property of a token (`brand.dark` → `--brand\.dark`).
func CSSVarName(token string) string {
	return "--" + strings.NewReplacer(`\`, `\\`, ".", `\.`).Replace(token)
}

func isKnownToken(doc *Document, name string) bool {
	if Tokens(doc).Has(name) {
		return true
	}
	if modes := Modes(doc); modes != nil {
		for _, k := range modes.Keys() {
			if modes.Obj(k).Has(name) {
				return true
			}
		}
	}
	return false
}

// ResolveLength resolves a length literal or a numeric `$token`. ok is false when it is missing or not a number.
func ResolveLength(doc *Document, v any, mode string) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case string:
		r := ResolveValue(doc, t, mode)
		if f, ok := r.(float64); ok && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return f, true
		}
	}
	return 0, false
}

func lengthVar(doc *Document, v any, vars bool) (string, bool) {
	s, ok := v.(string)
	if vars && ok && strings.HasPrefix(s, "$") && isKnownToken(doc, s[1:]) {
		return "var(" + CSSVarName(s[1:]) + ")", true
	}
	return "", false
}

func cssLen(doc *Document, v any, mode string, vars bool) string {
	if ref, ok := lengthVar(doc, v, vars); ok {
		return ref
	}
	if n, ok := ResolveLength(doc, v, mode); ok {
		return px(n)
	}
	if s, ok := v.(string); ok {
		return s
	}
	return px(0)
}

func cssNum(doc *Document, v any, mode string, vars bool) any {
	if ref, ok := lengthVar(doc, v, vars); ok {
		return "calc(" + ref + " / 1px)"
	}
	if n, ok := ResolveLength(doc, v, mode); ok {
		return n
	}
	if s, ok := v.(string); ok {
		return s
	}
	return 0.0
}

func strokeWidthAttr(doc *Document, v any, vars bool, resolved float64) any {
	if ref, ok := lengthVar(doc, v, vars); ok {
		return ref
	}
	return resolved
}

// paintValue resolves a paint value in the node's mode, or gives `var(--token)` when vars.
func paintValue(doc *Document, v any, mode string, vars bool) any {
	if s, ok := v.(string); vars && ok && strings.HasPrefix(s, "$") && isKnownToken(doc, s[1:]) {
		return "var(" + CSSVarName(s[1:]) + ")"
	}
	return ResolveValue(doc, v, mode)
}

// cssVarValue escapes what would end the value or the rule (`;`, `{`, `}`, `<`…).
func cssVarValue(v string) string {
	var b strings.Builder
	for _, c := range v {
		switch c {
		case '<', '>', '{', '}', ';', '\\':
			fmt.Fprintf(&b, "\\%x ", c)
		default:
			b.WriteRune(c)
		}
	}
	return b.String()
}

func tokenDecls(doc *Document, tokens *jsonv.Object) string {
	parts := make([]string, 0, tokens.Len())
	for _, k := range tokens.Keys() {
		v, _ := tokens.Get(k)
		var value string
		switch t := v.(type) {
		case float64:
			value = px(t)
		case string:
			if strings.HasPrefix(t, "$") && isKnownToken(doc, t[1:]) {
				value = "var(" + CSSVarName(t[1:]) + ")"
			} else {
				value = cssVarValue(t)
			}
		}
		parts = append(parts, CSSVarName(k)+":"+value)
	}
	return strings.Join(parts, ";")
}

// TokenStylesheet is the tokens as CSS variables: base values on :root and one rule per mode.
func TokenStylesheet(doc *Document) string {
	var out strings.Builder
	out.WriteString(":root{" + tokenDecls(doc, Tokens(doc)) + "}")
	if modes := Modes(doc); modes != nil {
		for _, k := range modes.Keys() {
			out.WriteString(`[data-paprika-mode="` + k + `"]{` + tokenDecls(doc, modes.Obj(k)) + "}")
		}
	}
	return out.String()
}

// jsString is String(v) for JSON scalars.
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return "null"
	case string:
		return t
	case float64:
		return jsonv.FormatNumber(t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	return "[object Object]"
}

func round2(n float64) float64 { return jsonv.Round(n*100) / 100 }

func px(n float64) string { return jsonv.FormatNumber(round2(n)) + "px" }

func paddingCSS(doc *Document, p any, mode string, vars bool) string {
	one := func(v any) string { return cssLen(doc, v, mode, vars) }
	if arr, ok := p.([]any); ok {
		parts := make([]string, len(arr))
		for i, v := range arr {
			parts[i] = one(v)
		}
		return strings.Join(parts, " ")
	}
	return one(p)
}

func ResolveCorners(doc *Document, radius any, mode string) (out [4]float64) {
	if arr, ok := radius.([]any); ok {
		for i := 0; i < 4 && i < len(arr); i++ {
			if f, ok := ResolveLength(doc, arr[i], mode); ok {
				out[i] = f
			}
		}
		return
	}
	if f, ok := ResolveLength(doc, radius, mode); ok {
		return [4]float64{f, f, f, f}
	}
	return
}

func UsedCornerRadii(w, h float64, radii [4]float64) [4]float64 {
	for i := range radii {
		if radii[i] < 0 {
			radii[i] = 0
		}
	}
	fit := func(sum, limit float64) float64 {
		if sum > limit && limit > 0 {
			return limit / sum
		}
		return 1
	}
	factor := math.Min(math.Min(fit(radii[0]+radii[1], w), fit(radii[3]+radii[2], w)), math.Min(fit(radii[0]+radii[3], h), fit(radii[1]+radii[2], h)))
	for i := range radii {
		radii[i] *= factor
	}
	return radii
}

func radiusCSS(doc *Document, radius any, mode string, vars bool) (string, bool) {
	if arr, ok := radius.([]any); ok {
		parts := make([]string, len(arr))
		nonzero := false
		for i, v := range arr {
			parts[i] = cssLen(doc, v, mode, vars)
			if parts[i] != "0px" {
				nonzero = true
			}
		}
		if !nonzero {
			return "", false
		}
		return strings.Join(parts, " "), true
	}
	if f, isNum := radius.(float64); isNum && f == 0 {
		return "", false
	}
	return cssLen(doc, radius, mode, vars), true
}

func sizeProps(css *CSS, axis string, size any, parentMode string) {
	if n, ok := size.(float64); ok {
		css.Set(axis, px(n))
		css.Set("flexShrink", 0.0)
		return
	}
	if size == "hug" {
		css.Set(axis, "max-content")
		return
	}
	if parentMode == "row" || parentMode == "column" {
		main := (parentMode == "row" && axis == "width") || (parentMode == "column" && axis == "height")
		if main {
			css.Set("flex", "1 1 0")
			if axis == "width" {
				css.Set("minWidth", 0.0)
			} else {
				css.Set("minHeight", 0.0)
			}
		} else {
			css.Set("alignSelf", "stretch")
		}
		return
	}
	css.Set(axis, "100%")
}

var (
	justifyMap = map[string]string{"start": "flex-start", "center": "center", "end": "flex-end", "between": "space-between"}
	alignMap   = map[string]string{"start": "flex-start", "center": "center", "end": "flex-end", "stretch": "stretch"}
)

// parentOf returns the node's parent (nil at top level; an empty parentId counts as none, like JavaScript truthiness).
func parentOf(doc *Document, n *Node) *Node {
	pid, ok := ParentID(n)
	if !ok || pid == "" {
		return nil
	}
	return GetNode(doc, pid)
}

// NodeStyle is the CSS of a node.
func NodeStyle(doc *Document, node *Node, asRoot bool) *CSS {
	return NodeStyleVars(doc, node, asRoot, false)
}

// NodeStyleVars is NodeStyle with tokens as CSS variables when vars.
func NodeStyleVars(doc *Document, node *Node, asRoot, vars bool) *CSS {
	if node.Str("type") == "page" {
		return jsonv.NewObject() // pages are not drawn: their children use canvas coordinates
	}
	themeMode := ModeOf(doc, node)
	paint := func(v any) any { return paintValue(doc, v, themeMode, vars) }
	parent := parentOf(doc, node)
	parentMode := ""
	if parent != nil && parent.Str("type") == "frame" {
		if l := parent.Obj("layout"); l != nil && l.Str("mode") != "none" {
			parentMode = l.Str("mode")
		}
	}
	absoluteChild := parentMode != "" && !asRoot && node.Str("layoutPositioning") == "absolute"
	css := jsonv.NewObject("boxSizing", "border-box")
	// Connectors never join the auto layout flow: their geometry comes from their ends.
	if parentMode != "" && !asRoot && node.Str("type") != "connector" && !absoluteChild {
		css.Set("position", "relative")
	} else {
		css.Set("position", "absolute")
		x, y := node.Num("x"), node.Num("y")
		if asRoot {
			x, y = 0, 0
		}
		css.Set("left", px(x))
		css.Set("top", px(y))
	}
	mode := parentMode
	if asRoot || absoluteChild {
		mode = ""
	}
	w, _ := node.Get("width")
	h, _ := node.Get("height")
	sizeProps(css, "width", w, mode)
	sizeProps(css, "height", h, mode)

	if node.Str("type") == "group" {
		// A group only groups: no paint, no clipping.
		if o := node.Num("opacity"); o != 1 {
			css.Set("opacity", o)
		}
		if !node.Bool("visible") {
			css.Set("display", "none")
		}
		return css
	}
	if node.Str("type") == "connector" {
		// The stroke goes on the <path> (see ConnectorAttrs); the arrowheads may leave the box.
		if o := node.Num("opacity"); o != 1 {
			css.Set("opacity", o)
		}
		css.Set("overflow", "visible")
		if node.Bool("visible") {
			css.Set("display", "block")
		} else {
			css.Set("display", "none")
		}
		return css
	}
	if r := node.Num("rotation"); r != 0 {
		css.Set("transform", "rotate("+jsonv.FormatNumber(round2(r))+"deg)")
	}
	if o := node.Num("opacity"); o != 1 {
		css.Set("opacity", o)
	}
	visible := node.Bool("visible")
	if !visible {
		css.Set("display", "none")
	}
	typ := node.Str("type")
	if typ == "path" {
		css.Set("overflow", "visible")
		if visible {
			css.Set("display", "block")
		} else {
			css.Set("display", "none")
		}
		applyShapeEffects(css, doc, node, themeMode, vars, paint)
		return css
	}
	if typ == "shape" {
		// The outline (fill/stroke) is an <svg> behind the text (see ShapeAttrs); here, box and text.
		if visible {
			css.Set("display", "flex")
		} else {
			css.Set("display", "none")
		}
		if node.Str("shape") == "note" {
			css.Set("alignItems", "flex-start")
		} else {
			css.Set("alignItems", "center")
		}
		css.Set("justifyContent", "center")
		pv, ph := ShapePadding(node)
		css.Set("padding", px(pv)+" "+px(ph))
		applyShapeEffects(css, doc, node, themeMode, vars, paint)
		textCSS(css, doc, node, themeMode, vars, paint)
		return css
	}
	if fill, ok := node.Get("fill"); ok {
		css.Set("background", jsString(paint(fill)))
	}
	if st := node.Obj("stroke"); st != nil {
		wRaw, _ := st.Get("width")
		w := cssLen(doc, wRaw, themeMode, vars)
		c := jsString(paint(st.Str("color")))
		style := StrokeStyleOf(st)
		pos := StrokePositionOf(node)
		if pos == "inside" {
			css.Set("border", w+" "+style+" "+c)
		} else {
			css.Set("outline", w+" "+style+" "+c)
			if pos == "center" {
				if ref, ok := lengthVar(doc, wRaw, vars); ok {
					css.Set("outlineOffset", "calc("+ref+" / -2)")
				} else {
					n, _ := ResolveLength(doc, wRaw, themeMode)
					css.Set("outlineOffset", "-"+jsonv.FormatNumber(round2(n/2))+"px")
				}
			} else {
				css.Set("outlineOffset", "0px")
			}
		}
	}
	if typ == "ellipse" {
		css.Set("borderRadius", "50%")
	} else if rv, ok := node.Get("radius"); ok {
		if cssR, ok := radiusCSS(doc, rv, themeMode, vars); ok {
			css.Set("borderRadius", cssR)
		}
	}
	if boxes := shadowBoxesCSS(doc, node, themeMode, vars, paint); boxes != "" {
		css.Set("boxShadow", boxes)
	}
	applyOutline(css, doc, node, themeMode, vars, paint)
	applyLayerFilter(css, doc, node, themeMode, vars)
	applyBackdrop(css, doc, node, themeMode, vars)

	switch typ {
	case "frame":
		if node.Bool("clip") {
			css.Set("overflow", "hidden")
		}
		if l := node.Obj("layout"); l != nil && l.Str("mode") != "none" {
			if visible {
				css.Set("display", "flex")
			} else {
				css.Set("display", "none")
			}
			css.Set("flexDirection", l.Str("mode"))
			gap, _ := l.Get("gap")
			css.Set("gap", cssLen(doc, gap, themeMode, vars))
			pad, _ := l.Get("padding")
			css.Set("padding", paddingCSS(doc, pad, themeMode, vars))
			css.Set("alignItems", alignMap[l.Str("align")])
			css.Set("justifyContent", justifyMap[l.Str("justify")])
			if l.Bool("wrap") {
				css.Set("flexWrap", "wrap")
			}
		}
	case "text":
		textCSS(css, doc, node, themeMode, vars, paint)
		css.Set("margin", 0.0)
	case "image":
		css.Set("objectFit", node.Str("fit"))
		if visible {
			css.Set("display", "block")
		} else {
			css.Set("display", "none")
		}
	}
	return css
}

// textCSS: typography of text and shape nodes (same property order in both).
func shadowNodes(n *Node) []*jsonv.Object {
	if n == nil {
		return nil
	}
	if s := n.Obj("shadow"); s != nil {
		return []*jsonv.Object{s}
	}
	arr := n.Arr("shadow")
	out := make([]*jsonv.Object, 0, len(arr))
	for _, v := range arr {
		if o, ok := v.(*jsonv.Object); ok {
			out = append(out, o)
		}
	}
	return out
}

func shadowFilter(doc *Document, s *Node, mode string, vars bool, paint func(any) any) string {
	x, _ := s.Get("x")
	y, _ := s.Get("y")
	b, _ := s.Get("blur")
	return "drop-shadow(" + cssLen(doc, x, mode, vars) + " " + cssLen(doc, y, mode, vars) + " " + cssLen(doc, b, mode, vars) + " " + jsString(paint(s.Str("color"))) + ")"
}

func shadowBoxCSS(doc *Document, s *jsonv.Object, mode string, vars bool, paint func(any) any) string {
	x, _ := s.Get("x")
	y, _ := s.Get("y")
	b, _ := s.Get("blur")
	sp, _ := s.Get("spread")
	inset := ""
	if s.Bool("inner") {
		inset = "inset "
	}
	return inset + cssLen(doc, x, mode, vars) + " " + cssLen(doc, y, mode, vars) + " " + cssLen(doc, b, mode, vars) + " " + cssLen(doc, sp, mode, vars) + " " + jsString(paint(s.Str("color")))
}

func shadowBoxesCSS(doc *Document, node *Node, mode string, vars bool, paint func(any) any) string {
	parts := []string{}
	for _, s := range shadowNodes(node) {
		parts = append(parts, shadowBoxCSS(doc, s, mode, vars, paint))
	}
	return strings.Join(parts, ", ")
}

func effectNum(n float64) string { return jsonv.FormatNumber(round2(n)) }

func filterCSS(doc *Document, f *jsonv.Object, mode string, vars bool) string {
	if f == nil {
		return ""
	}
	parts := []string{}
	if v, ok := f.Get("blur"); ok {
		parts = append(parts, "blur("+cssLen(doc, v, mode, vars)+")")
	}
	add := func(key, name string, deg bool) {
		v, ok := f.Get(key)
		if !ok {
			return
		}
		n, _ := v.(float64)
		num := effectNum(n)
		if deg {
			parts = append(parts, name+"("+num+"deg)")
			return
		}
		parts = append(parts, name+"("+num+")")
	}
	add("saturate", "saturate", false)
	add("grayscale", "grayscale", false)
	add("brightness", "brightness", false)
	add("sepia", "sepia", false)
	add("invert", "invert", false)
	add("hueRotate", "hue-rotate", true)
	return strings.Join(parts, " ")
}

func applyLayerFilter(css *CSS, doc *Document, node *Node, mode string, vars bool) {
	fx := filterCSS(doc, node.Obj("filter"), mode, vars)
	if fx == "" {
		return
	}
	if cur := css.Str("filter"); cur != "" {
		css.Set("filter", cur+" "+fx)
		return
	}
	css.Set("filter", fx)
}

func applyBackdrop(css *CSS, doc *Document, node *Node, mode string, vars bool) {
	if fx := filterCSS(doc, node.Obj("backdropFilter"), mode, vars); fx != "" {
		css.Set("backdropFilter", fx)
	}
}

func applyOutline(css *CSS, doc *Document, node *Node, mode string, vars bool, paint func(any) any) {
	o := node.Obj("outline")
	if o == nil {
		return
	}
	wRaw, _ := o.Get("width")
	w := cssLen(doc, wRaw, mode, vars)
	style := "solid"
	if s := o.Str("style"); s != "" {
		style = s
	}
	decl := w + " " + style + " " + jsString(paint(o.Str("color")))
	if _, ok := css.Get("outline"); !ok {
		css.Set("outline", decl)
		if off, ok := o.Get("offset"); ok {
			css.Set("outlineOffset", cssLen(doc, off, mode, vars))
		}
		return
	}
	ring := "0px 0px 0px " + w + " " + jsString(paint(o.Str("color")))
	if cur, ok := css.Get("boxShadow"); ok {
		css.Set("boxShadow", fmt.Sprint(cur)+", "+ring)
		return
	}
	css.Set("boxShadow", ring)
}

func applyShapeEffects(css *CSS, doc *Document, node *Node, mode string, vars bool, paint func(any) any) {
	var drops, inners []string
	for _, s := range shadowNodes(node) {
		if s.Bool("inner") {
			inners = append(inners, shadowBoxCSS(doc, s, mode, vars, paint))
			continue
		}
		drops = append(drops, shadowFilter(doc, s, mode, vars, paint))
	}
	if len(drops) > 0 {
		css.Set("filter", strings.Join(drops, " "))
	}
	if len(inners) > 0 {
		css.Set("boxShadow", strings.Join(inners, ", "))
	}
	applyLayerFilter(css, doc, node, mode, vars)
	applyOutline(css, doc, node, mode, vars, paint)
	applyBackdrop(css, doc, node, mode, vars)
}

func textCSS(css *CSS, doc *Document, node *Node, mode string, vars bool, paint func(any) any) {
	color, _ := node.Get("color")
	css.Set("color", jsString(paint(color)))
	css.Set("fontFamily", node.Str("fontFamily"))
	fsv, _ := node.Get("fontSize")
	css.Set("fontSize", cssLen(doc, fsv, mode, vars))
	css.Set("fontWeight", node.Num("fontWeight"))
	lh, _ := node.Get("lineHeight")
	css.Set("lineHeight", cssNum(doc, lh, mode, vars))
	if ls, ok := node.Get("letterSpacing"); ok {
		if f, isNum := ls.(float64); !isNum || f != 0 {
			css.Set("letterSpacing", cssLen(doc, ls, mode, vars))
		}
	}
	css.Set("textAlign", node.Str("textAlign"))
	css.Set("whiteSpace", "pre-wrap")
	css.Set("overflowWrap", "anywhere")
}

// ShapeSVGCSS and ShapeTextCSS style a shape's outline <svg> and its text block.
func ShapeSVGCSS() *CSS {
	return jsonv.NewObject("position", "absolute", "left", 0.0, "top", 0.0, "overflow", "visible")
}

func ShapeTextCSS() *CSS { return jsonv.NewObject("position", "relative", "width", "100%") }

// ShapeAttrs: the outline <svg> size, the outline <path> and, on a sticky note, the fold.
func ShapeAttrs(doc *Document, node *Node, vars bool) (svg, path, fold []Attr) {
	themeMode := ModeOf(doc, node)
	d, f := ShapeOutline(lengthsResolved(doc, node))
	fill := "none"
	if fv, ok := node.Get("fill"); ok {
		fill = jsString(paintValue(doc, fv, themeMode, vars))
	}
	path = []Attr{{"d", d}, {"fill", fill}, {"strokeLinejoin", "round"}}
	if st := node.Obj("stroke"); st != nil {
		w, _ := st.Get("width")
		if sw, ok := ResolveLength(doc, w, themeMode); ok && sw > 0 {
			path = append(path, Attr{"stroke", jsString(paintValue(doc, st.Str("color"), themeMode, vars))}, Attr{"strokeWidth", strokeWidthAttr(doc, w, vars, sw)})
			if dash := strokeDashValue(doc, w, vars, sw, StrokeStyleOf(st)); dash != "" {
				path = append(path, Attr{"strokeDasharray", dash})
			}
		}
	}
	svg = []Attr{{"width", node.Num("width")}, {"height", node.Num("height")}}
	if f != "" {
		fold = []Attr{{"d", f}, {"fill", NoteFoldFill}}
	}
	return svg, path, fold
}

// ConnectorAttrs: the <path> of a connector (line and arrowheads, no fill).
func ConnectorAttrs(doc *Document, node *Node, vars bool) []Attr {
	st := node.Obj("stroke")
	mode := ModeOf(doc, node)
	w, _ := st.Get("width")
	sw, _ := ResolveLength(doc, w, mode)
	a := []Attr{
		{"d", node.Str("d")},
		{"fill", "none"},
		{"stroke", jsString(paintValue(doc, st.Str("color"), mode, vars))},
		{"strokeWidth", strokeWidthAttr(doc, w, vars, sw)},
		{"strokeLinecap", "round"},
		{"strokeLinejoin", "round"},
	}
	if node.Bool("dashed") {
		if dash := strokeDashValue(doc, w, vars, sw, "dashed"); dash != "" {
			a = append(a, Attr{"strokeDasharray", dash})
		}
	}
	return a
}

var connectorPoint = regexp.MustCompile(`[ML](-?[\d.]+)[ ,](-?[\d.]+)`)

// ConnectorMidpoint is the point halfway (by length) along a connector's line: the first subpath of
// d (the arrowheads come after it). ok is false when d has no points.
func ConnectorMidpoint(d string) (x, y float64, ok bool) {
	line, _, _ := strings.Cut(d, " M")
	var pts [][2]float64
	for _, m := range connectorPoint.FindAllStringSubmatch(line, -1) {
		px, _ := strconv.ParseFloat(m[1], 64)
		py, _ := strconv.ParseFloat(m[2], 64)
		pts = append(pts, [2]float64{px, py})
	}
	if len(pts) == 0 {
		return 0, 0, false
	}
	seg := func(k int) float64 {
		dx, dy := pts[k+1][0]-pts[k][0], pts[k+1][1]-pts[k][1]
		return math.Sqrt(dx*dx + dy*dy)
	}
	total := 0.0
	for k := 0; k < len(pts)-1; k++ {
		total += seg(k)
	}
	left := total / 2
	for k := 0; k < len(pts)-1; k++ {
		l := seg(k)
		if left <= l && l > 0 {
			t := left / l
			return round2(pts[k][0] + (pts[k+1][0]-pts[k][0])*t), round2(pts[k][1] + (pts[k+1][1]-pts[k][1])*t), true
		}
		left -= l
	}
	return pts[0][0], pts[0][1], true
}

var connectorHaloSkip = regexp.MustCompile(`(?i)gradient|url\(`)

// connectorHalo is the background behind a connector: the nearest ancestor's fill (no gradient), or white.
func connectorHalo(doc *Document, node *Node, vars bool) string {
	cur := parentOf(doc, node)
	for cur != nil {
		switch cur.Str("type") {
		case "frame", "page", "rect", "ellipse":
			if f := cur.Str("fill"); f != "" && f != "transparent" && !connectorHaloSkip.MatchString(f) {
				return jsString(paintValue(doc, f, ModeOf(doc, cur), vars))
			}
		}
		cur = parentOf(doc, cur)
	}
	return "#ffffff"
}

// ConnectorLabelAttrs returns the attributes of a connector's label <text> (nil without a label):
// halfway along the route, in the stroke color, with a halo of the background color.
func ConnectorLabelAttrs(doc *Document, node *Node, vars bool) []Attr {
	if node.Str("label") == "" {
		return nil
	}
	x, y, ok := ConnectorMidpoint(node.Str("d"))
	if !ok {
		return nil
	}
	return []Attr{
		{"x", x}, {"y", y},
		{"fill", jsString(paintValue(doc, node.Obj("stroke").Str("color"), ModeOf(doc, node), vars))},
		{"stroke", connectorHalo(doc, node, vars)},
		{"strokeWidth", 6.0},
		{"strokeLinejoin", "round"},
		{"paintOrder", "stroke"},
		{"fontFamily", "Inter, system-ui, sans-serif"},
		{"fontSize", 12.0},
		{"fontWeight", 600.0},
		{"textAnchor", "middle"},
		{"dominantBaseline", "central"},
	}
}

// Attr is one SVG attribute (value string or float64).
type Attr struct {
	Key   string
	Value any
}

// PathAttrs returns the attributes of the <svg> and <path> of a path node.
func PathAttrs(doc *Document, node *Node) (svg, path []Attr) { return PathAttrsVars(doc, node, false) }

// PathAttrsVars is PathAttrs with tokens as CSS variables when vars.
func PathAttrsVars(doc *Document, node *Node, vars bool) (svg, path []Attr) {
	themeMode := ModeOf(doc, node)
	if vb := node.Arr("viewBox"); node.Has("viewBox") {
		parts := make([]string, len(vb))
		for i, v := range vb {
			parts[i] = jsonv.FormatNumber(round2(v.(float64)))
		}
		svg = append(svg, Attr{"viewBox", strings.Join(parts, " ")}, Attr{"preserveAspectRatio", "xMidYMid meet"})
	}
	fill := "none"
	if f, ok := node.Get("fill"); ok {
		fill = jsString(paintValue(doc, f, themeMode, vars))
	}
	path = []Attr{
		{"d", node.Str("d")},
		{"fill", fill},
		{"fillRule", node.Str("fillRule")},
		{"strokeLinecap", node.Str("strokeCap")},
		{"strokeLinejoin", node.Str("strokeJoin")},
	}
	if st := node.Obj("stroke"); st != nil {
		w, _ := st.Get("width")
		if sw, ok := ResolveLength(doc, w, themeMode); ok && sw > 0 {
			pos := StrokePositionOf(node)
			path = append(path, Attr{"stroke", jsString(paintValue(doc, st.Str("color"), themeMode, vars))})
			if pos == "outside" && fill != "none" {
				if ref, ok := lengthVar(doc, w, vars); ok {
					path = append(path, Attr{"strokeWidth", "calc(" + ref + " * 2)"}, Attr{"paintOrder", "stroke fill"})
				} else {
					path = append(path, Attr{"strokeWidth", sw * 2}, Attr{"paintOrder", "stroke fill"})
				}
			} else {
				path = append(path, Attr{"strokeWidth", strokeWidthAttr(doc, w, vars, sw)})
			}
			if dash := strokeDashValue(doc, w, vars, sw, StrokeStyleOf(st)); dash != "" {
				path = append(path, Attr{"strokeDasharray", dash})
			}
		}
	}
	return svg, path
}

var unitless = map[string]bool{"opacity": true, "fontWeight": true, "lineHeight": true, "flexShrink": true, "zIndex": true}

var upperRe = regexp.MustCompile(`[A-Z]`)

func kebab(k string) string {
	return upperRe.ReplaceAllStringFunc(k, func(m string) string { return "-" + strings.ToLower(m) })
}

// CSSToString serializes a camelCase CSS object as an inline declaration.
func CSSToString(css *CSS) string {
	parts := make([]string, 0, css.Len())
	for _, k := range css.Keys() {
		v, _ := css.Get(k)
		val := jsString(v)
		if n, ok := v.(float64); ok && !unitless[k] && n != 0 {
			val = jsonv.FormatNumber(n) + "px"
		}
		parts = append(parts, kebab(k)+":"+val)
	}
	return strings.Join(parts, ";")
}

func lengthsResolved(doc *Document, n *Node) *Node {
	mode := ModeOf(doc, n)
	c := jsonv.Clone(n).(*Node)
	if v, ok := n.Get("radius"); ok {
		if f, ok := ResolveLength(doc, v, mode); ok {
			c.Set("radius", f)
		}
	}
	if st := n.Obj("stroke"); st != nil {
		if w, ok := st.Get("width"); ok {
			if f, ok := ResolveLength(doc, w, mode); ok && c.Obj("stroke") != nil {
				c.Obj("stroke").Set("width", f)
			}
		}
	}
	return c
}

func jsonNum(n float64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func lengthProblem(doc *Document, id, field string, value any, min, max *float64, mode string) string {
	s, ok := value.(string)
	if !ok || !strings.HasPrefix(s, "$") {
		return ""
	}
	resolved := ResolveValue(doc, s, mode)
	if t, ok := resolved.(string); ok && strings.HasPrefix(t, "$") {
		return ""
	}
	n, isNum := resolved.(float64)
	if !isNum || math.IsNaN(n) || math.IsInf(n, 0) {
		shown, _ := json.Marshal(resolved)
		return fmt.Sprintf("node %q %s: token %q resolved to %s, expected a length", id, field, s, shown)
	}
	shown := jsonNum(n)
	if min != nil && max != nil && (n < *min || n > *max) {
		return fmt.Sprintf("node %q %s: token %q is %s, expected a number >= %s and <= %s", id, field, s, shown, jsonNum(*min), jsonNum(*max))
	}
	if min != nil && n < *min {
		return fmt.Sprintf("node %q %s: token %q is %s, expected a number >= %s", id, field, s, shown, jsonNum(*min))
	}
	if max != nil && n > *max {
		return fmt.Sprintf("node %q %s: token %q is %s, expected a number <= %s", id, field, s, shown, jsonNum(*max))
	}
	return ""
}

func LengthTokenError(doc *Document) string {
	seen := map[string]bool{}
	var walk func(id string) string
	walk = func(id string) string {
		if seen[id] {
			return ""
		}
		seen[id] = true
		n := GetNode(doc, id)
		if n == nil {
			return ""
		}
		typ := n.Str("type")
		if typ == "page" || typ == "group" {
			for _, c := range n.Strings("children") {
				if m := walk(c); m != "" {
					return m
				}
			}
			return ""
		}
		mode := ModeOf(doc, n)
		check := func(field string, value any, min, max *float64) string {
			return lengthProblem(doc, n.Str("id"), field, value, min, max, mode)
		}
		var msg string
		if typ == "connector" {
			if st := n.Obj("stroke"); st != nil {
				w, _ := st.Get("width")
				msg = check("stroke.width", w, new(float64(0)), new(float64(1000)))
			}
		} else {
			if v, ok := n.Get("radius"); ok {
				if arr, isArr := v.([]any); isArr {
					for i, item := range arr {
						if msg == "" {
							msg = check(fmt.Sprintf("radius.%d", i), item, new(float64(0)), nil)
						}
					}
				} else {
					msg = check("radius", v, new(float64(0)), nil)
				}
			}
			if st := n.Obj("stroke"); st != nil && msg == "" {
				w, _ := st.Get("width")
				msg = check("stroke.width", w, new(float64(0)), new(float64(1000)))
			}
			if msg == "" {
				list := shadowNodes(n)
				indexed := n.Obj("shadow") == nil && n.Arr("shadow") != nil
				for i, sh := range list {
					p := "shadow"
					if indexed {
						p = fmt.Sprintf("shadow.%d", i)
					}
					x, _ := sh.Get("x")
					y, _ := sh.Get("y")
					b, _ := sh.Get("blur")
					sp, _ := sh.Get("spread")
					msg = check(p+".x", x, nil, nil)
					if msg == "" {
						msg = check(p+".y", y, nil, nil)
					}
					if msg == "" {
						msg = check(p+".blur", b, new(float64(0)), nil)
					}
					if msg == "" {
						msg = check(p+".spread", sp, nil, nil)
					}
					if msg != "" {
						break
					}
				}
			}
			if o := n.Obj("outline"); o != nil && msg == "" {
				w, _ := o.Get("width")
				msg = check("outline.width", w, new(float64(0)), new(float64(1000)))
				if msg == "" {
					if off, ok := o.Get("offset"); ok {
						msg = check("outline.offset", off, new(float64(-1000)), new(float64(1000)))
					}
				}
			}
			if f := n.Obj("filter"); f != nil && msg == "" {
				if b, ok := f.Get("blur"); ok {
					msg = check("filter.blur", b, new(float64(0)), new(float64(1000)))
				}
			}
			if f := n.Obj("backdropFilter"); f != nil && msg == "" {
				if b, ok := f.Get("blur"); ok {
					msg = check("backdropFilter.blur", b, new(float64(0)), new(float64(1000)))
				}
			}
			if typ == "frame" && msg == "" {
				if l := n.Obj("layout"); l != nil {
					g, _ := l.Get("gap")
					msg = check("layout.gap", g, new(float64(0)), nil)
					if msg == "" {
						p, _ := l.Get("padding")
						if arr, ok := p.([]any); ok {
							for i, v := range arr {
								if msg = check(fmt.Sprintf("layout.padding.%d", i), v, new(float64(0)), nil); msg != "" {
									break
								}
							}
						} else {
							msg = check("layout.padding", p, new(float64(0)), nil)
						}
					}
				}
			}
			if (typ == "text" || typ == "shape") && msg == "" {
				fs, _ := n.Get("fontSize")
				msg = check("fontSize", fs, new(float64(1)), new(float64(1000)))
				if msg == "" {
					lh, _ := n.Get("lineHeight")
					msg = check("lineHeight", lh, new(float64(0)), new(float64(10)))
				}
			}
			if typ == "text" && msg == "" {
				ls, _ := n.Get("letterSpacing")
				msg = check("letterSpacing", ls, nil, nil)
			}
		}
		if msg != "" {
			return msg
		}
		if typ == "frame" {
			for _, c := range n.Strings("children") {
				if m := walk(c); m != "" {
					return m
				}
			}
		}
		return ""
	}
	for _, id := range doc.Strings("rootIds") {
		if m := walk(id); m != "" {
			return m
		}
	}
	return ""
}
