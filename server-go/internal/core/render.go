package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"golang.org/x/text/unicode/norm"
)

// Port of packages/core/src/render.ts (HTML for export and screenshot, React/TSX export).

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

// EscapeHTML escapes & < > " '.
func EscapeHTML(s string) string { return htmlEscaper.Replace(s) }

func svgAttrs(attrs []Attr) string {
	var b strings.Builder
	for _, a := range attrs {
		k := a.Key
		if k != "viewBox" && k != "preserveAspectRatio" {
			k = kebab(k)
		}
		fmt.Fprintf(&b, ` %s="%s"`, k, EscapeHTML(jsString(a.Value)))
	}
	return b.String()
}

// RootBounds is the approximate box of a top-level node ("hug"/"fill" fall back to 1px).
func RootBounds(doc *Document, id string) (Bounds, error) {
	n := GetNode(doc, id)
	if n == nil {
		return Bounds{}, fmt.Errorf(`nó "%s" não existe`, id)
	}
	w, h := 1.0, 1.0
	if v, ok := n.Get("width"); ok {
		if f, isNum := v.(float64); isNum {
			w = f
		}
	}
	if v, ok := n.Get("height"); ok {
		if f, isNum := v.(float64); isNum {
			h = f
		}
	}
	return Bounds{n.Num("x"), n.Num("y"), math.Max(1, w), math.Max(1, h)}, nil
}

// CanvasBounds contains every top-level node.
func CanvasBounds(doc *Document) Bounds {
	roots := doc.Strings("rootIds")
	if len(roots) == 0 {
		return Bounds{0, 0, 800, 600}
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, id := range roots {
		b, err := RootBounds(doc, id)
		if err != nil {
			continue
		}
		minX = math.Min(minX, b.X)
		minY = math.Min(minY, b.Y)
		maxX = math.Max(maxX, b.X+b.Width)
		maxY = math.Max(maxY, b.Y+b.Height)
	}
	return Bounds{minX, minY, maxX - minX, maxY - minY}
}

func childNodes(doc *Document, n *Node) []*Node {
	var out []*Node
	for _, c := range n.Strings("children") {
		if cn := GetNode(doc, c); cn != nil {
			out = append(out, cn)
		}
	}
	return out
}

func renderNode(doc *Document, node *Node, asRoot bool, offset *Point) string {
	css := NodeStyle(doc, node, asRoot)
	if offset != nil && !asRoot {
		css.Set("left", jsonv.FormatNumber(node.Num("x")-offset.X)+"px")
		css.Set("top", jsonv.FormatNumber(node.Num("y")-offset.Y)+"px")
	}
	name := ""
	if n := node.Str("name"); n != "" {
		name = ` data-name="` + EscapeHTML(n) + `"`
	}
	typ := node.Str("type")
	attrs := fmt.Sprintf(`data-paprika-id="%s" data-paprika-type="%s"%s style="%s"`, EscapeHTML(node.Str("id")), typ, name, EscapeHTML(CSSToString(css)))
	switch typ {
	case "frame":
		var kids strings.Builder
		for _, c := range childNodes(doc, node) {
			kids.WriteString(renderNode(doc, c, false, nil))
		}
		return "<div " + attrs + ">" + kids.String() + "</div>"
	case "text":
		return "<div " + attrs + ">" + EscapeHTML(node.Str("text")) + "</div>"
	case "image":
		return "<img " + attrs + ` src="` + EscapeHTML(node.Str("src")) + `" alt="` + EscapeHTML(node.Str("alt")) + `">`
	case "path":
		svg, path := PathAttrs(doc, node)
		return "<svg " + attrs + ` xmlns="http://www.w3.org/2000/svg"` + svgAttrs(svg) + "><path" + svgAttrs(path) + "/></svg>"
	}
	return "<div " + attrs + "></div>"
}

// RenderOptions: RootID renders a single node at 0,0; Background is the page color.
type RenderOptions struct {
	RootID     string
	Background string
}

// RenderHTML builds a self-contained HTML document (export and screenshot).
func RenderHTML(doc *Document, opts RenderOptions) (string, Bounds, error) {
	var body string
	var bounds Bounds
	if opts.RootID != "" {
		node := GetNode(doc, opts.RootID)
		if node == nil {
			return "", Bounds{}, fmt.Errorf(`nó "%s" não existe`, opts.RootID)
		}
		bounds, _ = RootBounds(doc, opts.RootID)
		body = renderNode(doc, node, true, nil)
	} else {
		bounds = CanvasBounds(doc)
		var b strings.Builder
		for _, id := range doc.Strings("rootIds") {
			if n := GetNode(doc, id); n != nil {
				b.WriteString(renderNode(doc, n, false, &Point{bounds.X, bounds.Y}))
			}
		}
		body = b.String()
	}
	bg := opts.Background
	if bg == "" {
		bg = "#ffffff"
	}
	html := "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + EscapeHTML(doc.Str("name")) + "</title>\n" +
		"<style>html,body{margin:0;padding:0}body{position:relative;width:" + jsonv.FormatNumber(bounds.Width) + "px;height:" + jsonv.FormatNumber(bounds.Height) +
		"px;background:" + EscapeHTML(bg) + ";font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}</style>\n" +
		"</head><body>" + body + "</body></html>"
	return html, bounds, nil
}

func jsxStyle(css *CSS) string {
	parts := make([]string, 0, css.Len())
	for _, k := range css.Keys() {
		v, _ := css.Get(k)
		if n, ok := v.(float64); ok {
			parts = append(parts, k+": "+jsonv.FormatNumber(n))
		} else {
			parts = append(parts, k+": "+jsonv.Quote(jsString(v)))
		}
	}
	return "{{ " + strings.Join(parts, ", ") + " }}"
}

var jsxSpecial = regexp.MustCompile(`[{}<>]`)

func jsxText(s string) string {
	s = jsxSpecial.ReplaceAllStringFunc(s, func(c string) string { return "{" + jsonv.Quote(c) + "}" })
	return strings.ReplaceAll(s, "\n", `{'\n'}`)
}

func jsxAttrs(attrs []Attr) string {
	var b strings.Builder
	for _, a := range attrs {
		if n, ok := a.Value.(float64); ok {
			fmt.Fprintf(&b, " %s={%s}", a.Key, jsonv.FormatNumber(n))
		} else {
			fmt.Fprintf(&b, " %s=%s", a.Key, jsonv.Quote(jsString(a.Value)))
		}
	}
	return b.String()
}

func jsxNode(doc *Document, node *Node, asRoot bool, indent string) string {
	style := jsxStyle(NodeStyle(doc, node, asRoot))
	name := ""
	if n := node.Str("name"); n != "" {
		name = " data-name=" + jsonv.Quote(n)
	}
	switch node.Str("type") {
	case "frame":
		kids := []string{}
		for _, c := range childNodes(doc, node) {
			kids = append(kids, jsxNode(doc, c, false, indent+"  "))
		}
		if len(kids) > 0 {
			return indent + "<div" + name + " style=" + style + ">\n" + strings.Join(kids, "\n") + "\n" + indent + "</div>"
		}
		return indent + "<div" + name + " style=" + style + " />"
	case "text":
		return indent + "<div" + name + " style=" + style + ">" + jsxText(node.Str("text")) + "</div>"
	case "image":
		return indent + "<img" + name + " style=" + style + " src=" + jsonv.Quote(node.Str("src")) + " alt=" + jsonv.Quote(node.Str("alt")) + " />"
	case "path":
		svg, path := PathAttrs(doc, node)
		return indent + "<svg" + name + " style=" + style + jsxAttrs(svg) + ">\n" + indent + "  <path" + jsxAttrs(path) + " />\n" + indent + "</svg>"
	}
	return indent + "<div" + name + " style=" + style + " />"
}

func isASCIIAlnum(r rune) bool {
	return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isASCIIAlpha(r rune) bool { return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') }

// jsUpper is String#toUpperCase for one UTF-16 unit worth of text.
func jsUpper(s string) string { return strings.ToUpperSpecial(unicode.SpecialCase{}, s) }

func componentName(s string) string {
	s = norm.NFD.String(s)
	var stripped []rune
	for _, r := range s {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		stripped = append(stripped, r)
	}
	// /[^A-Za-z0-9]+(.)?/g → uppercase the char after a run of non-alphanumerics.
	var out []rune
	for i := 0; i < len(stripped); {
		if isASCIIAlnum(stripped[i]) {
			out = append(out, stripped[i])
			i++
			continue
		}
		for i < len(stripped) && !isASCIIAlnum(stripped[i]) {
			i++
		}
		if i < len(stripped) {
			out = append(out, []rune(jsUpper(string(stripped[i])))...)
			i++
		}
	}
	// /^[^A-Za-z]+/
	k := 0
	for k < len(out) && !isASCIIAlpha(out[k]) {
		k++
	}
	out = out[k:]
	if len(out) == 0 {
		return "Design"
	}
	return jsUpper(string(out[0])) + string(out[1:])
}

// ExportReact exports a node as a React (TSX) component with inline styles.
func ExportReact(doc *Document, rootID string) (string, error) {
	node := GetNode(doc, rootID)
	if node == nil {
		return "", fmt.Errorf(`nó "%s" não existe`, rootID)
	}
	n := node.Str("name")
	if n == "" {
		n = node.Str("id")
	}
	return "export function " + componentName(n) + "() {\n  return (\n" + jsxNode(doc, node, true, "    ") + "\n  );\n}\n", nil
}
