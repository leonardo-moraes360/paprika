package core

import (
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/style.ts. The TypeScript nodeStyle stays the single reference
// (the canvas uses it); this port is locked to it by the golden fixtures.

// CSS is an ordered camelCase style object (values are string or float64).
type CSS = jsonv.Object

// ResolveValue resolves `$token` against doc.tokens (tokens may chain, up to 8 levels).
func ResolveValue(doc *Document, v any) any {
	cur := v
	for depth := 0; depth < 8; depth++ {
		s, ok := cur.(string)
		if !ok || !strings.HasPrefix(s, "$") {
			break
		}
		next, has := Tokens(doc).Get(s[1:])
		if !has {
			return cur
		}
		cur = next
	}
	return cur
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
	parent := parentOf(doc, node)
	parentMode := ""
	if parent != nil && parent.Str("type") == "frame" {
		if l := parent.Obj("layout"); l != nil && l.Str("mode") != "none" {
			parentMode = l.Str("mode")
		}
	}
	css := jsonv.NewObject("boxSizing", "border-box")
	if parentMode != "" && !asRoot {
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
			css.Set("filter", "drop-shadow("+px(s.Num("x"))+" "+px(s.Num("y"))+" "+px(s.Num("blur"))+" "+jsString(ResolveValue(doc, s.Str("color")))+")")
		}
		return css
	}
	if fill, ok := node.Get("fill"); ok {
		css.Set("background", jsString(ResolveValue(doc, fill)))
	}
	if st := node.Obj("stroke"); st != nil {
		css.Set("border", px(st.Num("width"))+" solid "+jsString(ResolveValue(doc, st.Str("color"))))
	}
	if typ == "ellipse" {
		css.Set("borderRadius", "50%")
	} else if r := node.Num("radius"); r != 0 {
		css.Set("borderRadius", px(r))
	}
	if s := node.Obj("shadow"); s != nil {
		css.Set("boxShadow", px(s.Num("x"))+" "+px(s.Num("y"))+" "+px(s.Num("blur"))+" "+px(s.Num("spread"))+" "+jsString(ResolveValue(doc, s.Str("color"))))
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
		color, _ := node.Get("color")
		css.Set("color", jsString(ResolveValue(doc, color)))
		css.Set("fontFamily", node.Str("fontFamily"))
		fsv, _ := node.Get("fontSize")
		fs := ResolveValue(doc, fsv)
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

// Attr is one SVG attribute (value string or float64).
type Attr struct {
	Key   string
	Value any
}

// PathAttrs returns the attributes of the <svg> and <path> of a path node.
func PathAttrs(doc *Document, node *Node) (svg, path []Attr) {
	if vb := node.Arr("viewBox"); node.Has("viewBox") {
		parts := make([]string, len(vb))
		for i, v := range vb {
			parts[i] = jsonv.FormatNumber(round2(v.(float64)))
		}
		svg = append(svg, Attr{"viewBox", strings.Join(parts, " ")}, Attr{"preserveAspectRatio", "xMidYMid meet"})
	}
	fill := "none"
	if f, ok := node.Get("fill"); ok {
		fill = jsString(ResolveValue(doc, f))
	}
	path = []Attr{
		{"d", node.Str("d")},
		{"fill", fill},
		{"fillRule", node.Str("fillRule")},
		{"strokeLinecap", node.Str("strokeCap")},
		{"strokeLinejoin", node.Str("strokeJoin")},
	}
	if st := node.Obj("stroke"); st != nil && st.Num("width") > 0 {
		path = append(path, Attr{"stroke", jsString(ResolveValue(doc, st.Str("color")))}, Attr{"strokeWidth", st.Num("width")})
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
