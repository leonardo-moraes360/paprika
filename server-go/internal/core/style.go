package core

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/style.ts. The TypeScript nodeStyle stays the single reference
// (the canvas uses it); this port is locked to it by the golden fixtures.

// CSS is an ordered camelCase style object (values are string or float64).
type CSS = jsonv.Object

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
	for depth := 0; depth < 8; depth++ {
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
	out := ":root{" + tokenDecls(doc, Tokens(doc)) + "}"
	if modes := Modes(doc); modes != nil {
		for _, k := range modes.Keys() {
			out += `[data-paprika-mode="` + k + `"]{` + tokenDecls(doc, modes.Obj(k)) + "}"
		}
	}
	return out
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

func padding(p any) string {
	if arr, ok := p.([]any); ok {
		parts := make([]string, len(arr))
		for i, v := range arr {
			parts[i] = px(v.(float64))
		}
		return strings.Join(parts, " ")
	}
	f, _ := p.(float64)
	return px(f)
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
	css := jsonv.NewObject("boxSizing", "border-box")
	// Connectors never join the auto layout flow: their geometry comes from their ends.
	if parentMode != "" && !asRoot && node.Str("type") != "connector" {
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
	if asRoot {
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
		if s := node.Obj("shadow"); s != nil {
			css.Set("filter", "drop-shadow("+px(s.Num("x"))+" "+px(s.Num("y"))+" "+px(s.Num("blur"))+" "+jsString(paint(s.Str("color")))+")")
		}
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
		if s := node.Obj("shadow"); s != nil {
			css.Set("filter", "drop-shadow("+px(s.Num("x"))+" "+px(s.Num("y"))+" "+px(s.Num("blur"))+" "+jsString(paint(s.Str("color")))+")")
		}
		textCSS(css, node, paint)
		return css
	}
	if fill, ok := node.Get("fill"); ok {
		css.Set("background", jsString(paint(fill)))
	}
	if st := node.Obj("stroke"); st != nil {
		css.Set("border", px(st.Num("width"))+" solid "+jsString(paint(st.Str("color"))))
	}
	if typ == "ellipse" {
		css.Set("borderRadius", "50%")
	} else if r := node.Num("radius"); r != 0 {
		css.Set("borderRadius", px(r))
	}
	if s := node.Obj("shadow"); s != nil {
		css.Set("boxShadow", px(s.Num("x"))+" "+px(s.Num("y"))+" "+px(s.Num("blur"))+" "+px(s.Num("spread"))+" "+jsString(paint(s.Str("color"))))
	}

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
			css.Set("gap", px(l.Num("gap")))
			pad, _ := l.Get("padding")
			css.Set("padding", padding(pad))
			css.Set("alignItems", alignMap[l.Str("align")])
			css.Set("justifyContent", justifyMap[l.Str("justify")])
			if l.Bool("wrap") {
				css.Set("flexWrap", "wrap")
			}
		}
	case "text":
		textCSS(css, node, paint)
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
func textCSS(css *CSS, node *Node, paint func(any) any) {
	color, _ := node.Get("color")
	css.Set("color", jsString(paint(color)))
	css.Set("fontFamily", node.Str("fontFamily"))
	fsv, _ := node.Get("fontSize")
	fs := paint(fsv)
	if n, ok := fs.(float64); ok {
		css.Set("fontSize", px(n))
	} else {
		css.Set("fontSize", jsString(fs))
	}
	css.Set("fontWeight", node.Num("fontWeight"))
	css.Set("lineHeight", node.Num("lineHeight"))
	if ls := node.Num("letterSpacing"); ls != 0 {
		css.Set("letterSpacing", px(ls))
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
	d, f := ShapeOutline(node)
	fill := "none"
	if fv, ok := node.Get("fill"); ok {
		fill = jsString(paintValue(doc, fv, themeMode, vars))
	}
	path = []Attr{{"d", d}, {"fill", fill}, {"strokeLinejoin", "round"}}
	if st := node.Obj("stroke"); st != nil && st.Num("width") > 0 {
		path = append(path, Attr{"stroke", jsString(paintValue(doc, st.Str("color"), themeMode, vars))}, Attr{"strokeWidth", st.Num("width")})
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
	sw := st.Num("width")
	a := []Attr{
		{"d", node.Str("d")},
		{"fill", "none"},
		{"stroke", jsString(paintValue(doc, st.Str("color"), ModeOf(doc, node), vars))},
		{"strokeWidth", sw},
		{"strokeLinecap", "round"},
		{"strokeLinejoin", "round"},
	}
	if node.Bool("dashed") {
		a = append(a, Attr{"strokeDasharray", jsonv.FormatNumber(round2(sw*3)) + " " + jsonv.FormatNumber(round2(sw*2.5))})
	}
	return a
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
	if st := node.Obj("stroke"); st != nil && st.Num("width") > 0 {
		path = append(path, Attr{"stroke", jsString(paintValue(doc, st.Str("color"), themeMode, vars))}, Attr{"strokeWidth", st.Num("width")})
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
