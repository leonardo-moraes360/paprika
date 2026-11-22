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
		return Bounds{}, fmt.Errorf(`node "%s" does not exist`, id)
	}
	if n.Str("type") == "page" {
		return CanvasBounds(doc, id), nil
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

// CanvasBounds contains every top-level node of a page ("" = the first page, or the document without pages).
func CanvasBounds(doc *Document, pageID string) Bounds {
	roots, _ := PageRoots(doc, pageID)
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

// modeAttr is data-paprika-mode on a frame/page with a theme mode: the selector of its CSS variables.
func modeAttr(node *Node) string {
	if t := node.Str("type"); (t == "frame" || t == "page") && node.Str("mode") != "" {
		return ` data-paprika-mode="` + EscapeHTML(node.Str("mode")) + `"`
	}
	return ""
}

func renderNode(doc *Document, node *Node, asRoot, vars bool, offset *Point) string {
	css := NodeStyleVars(doc, node, asRoot, vars)
	if offset != nil && !asRoot && node.Str("type") != "page" {
		css.Set("left", jsonv.FormatNumber(node.Num("x")-offset.X)+"px")
		css.Set("top", jsonv.FormatNumber(node.Num("y")-offset.Y)+"px")
	}
	name := ""
	if n := node.Str("name"); n != "" {
		name = ` data-name="` + EscapeHTML(n) + `"`
	}
	typ := node.Str("type")
	attrs := fmt.Sprintf(`data-paprika-id="%s" data-paprika-type="%s"%s%s style="%s"`, EscapeHTML(node.Str("id")), typ, name, modeAttr(node), EscapeHTML(CSSToString(css)))
	switch typ {
	case "frame", "group", "page":
		var kids strings.Builder
		for _, c := range childNodes(doc, node) {
			kids.WriteString(renderNode(doc, c, false, vars, nil))
		}
		return "<div " + attrs + ">" + kids.String() + "</div>"
	case "text":
		return "<div " + attrs + ">" + EscapeHTML(node.Str("text")) + "</div>"
	case "image":
		return "<img " + attrs + ` src="` + EscapeHTML(node.Str("src")) + `" alt="` + EscapeHTML(node.Str("alt")) + `">`
	case "path":
		svg, path := PathAttrsVars(doc, node, vars)
		return "<svg " + attrs + ` xmlns="http://www.w3.org/2000/svg"` + svgAttrs(svg) + "><path" + svgAttrs(path) + "/></svg>"
	case "connector":
		text := ""
		if label := ConnectorLabelAttrs(doc, node, vars); label != nil {
			text = "<text" + svgAttrs(label) + ">" + EscapeHTML(node.Str("label")) + "</text>"
		}
		return "<svg " + attrs + ` xmlns="http://www.w3.org/2000/svg"><path` + svgAttrs(ConnectorAttrs(doc, node, vars)) + "/>" + text + "</svg>"
	case "shape":
		svg, path, fold := ShapeAttrs(doc, node, vars)
		f := ""
		if fold != nil {
			f = "<path" + svgAttrs(fold) + "/>"
		}
		return "<div " + attrs + `><svg xmlns="http://www.w3.org/2000/svg"` + svgAttrs(svg) + ` style="` + CSSToString(ShapeSVGCSS()) + `"><path` + svgAttrs(path) + "/>" + f +
			`</svg><div style="` + CSSToString(ShapeTextCSS()) + `">` + EscapeHTML(node.Str("text")) + "</div></div>"
	}
	return "<div " + attrs + "></div>"
}

// RenderOptions: RootID renders a single node at 0,0; Background is the page color;
// CSSVariables writes tokens as var(--name) with a stylesheet per theme mode.
type RenderOptions struct {
	RootID       string
	Background   string
	CSSVariables bool
}

// RenderHTML builds a self-contained HTML document (export and screenshot).
func RenderHTML(doc *Document, opts RenderOptions) (string, Bounds, error) {
	var body string
	var bounds Bounds
	var node, page *Node
	if opts.RootID != "" {
		node = GetNode(doc, opts.RootID)
		if node == nil {
			return "", Bounds{}, fmt.Errorf(`node "%s" does not exist`, opts.RootID)
		}
		if node.Str("type") == "page" {
			page = node
		}
	} else {
		page = FirstPage(doc)
	}
	if node != nil && page == nil {
		bounds, _ = RootBounds(doc, opts.RootID)
		body = renderNode(doc, node, true, opts.CSSVariables, nil)
	} else {
		pageID := ""
		if page != nil {
			pageID = page.Str("id")
		}
		bounds = CanvasBounds(doc, pageID)
		roots, _ := PageRoots(doc, pageID)
		var b strings.Builder
		for _, id := range roots {
			if n := GetNode(doc, id); n != nil {
				b.WriteString(renderNode(doc, n, false, opts.CSSVariables, &Point{bounds.X, bounds.Y}))
			}
		}
		body = b.String()
	}
	bg := opts.Background
	if bg == "" {
		bg = "#ffffff"
		if page != nil {
			if f, ok := page.Get("fill"); ok && f != "" {
				bg = jsString(ResolveValue(doc, f, page.Str("mode")))
			}
		}
	}
	// A loose node inherits its ancestors' mode: in the export it sits in <body>, the new top.
	inherited := ""
	if node != nil && page == nil {
		if modeAttr(node) == "" {
			inherited = ModeOf(doc, node)
		}
	} else if page != nil {
		inherited = page.Str("mode")
	}
	bodyMode, sheet := "", ""
	if opts.CSSVariables {
		sheet = TokenStylesheet(doc)
		if inherited != "" {
			bodyMode = ` data-paprika-mode="` + EscapeHTML(inherited) + `"`
		}
	}
	html := "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + EscapeHTML(doc.Str("name")) + "</title>\n" +
		"<style>html,body{margin:0;padding:0}body{position:relative;width:" + jsonv.FormatNumber(bounds.Width) + "px;height:" + jsonv.FormatNumber(bounds.Height) +
		"px;background:" + EscapeHTML(bg) + ";font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" + sheet + "</style>\n" +
		"</head><body" + bodyMode + ">" + body + "</body></html>"
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

func jsxNode(doc *Document, node *Node, asRoot bool, indent string, vars bool) string {
	style := jsxStyle(NodeStyleVars(doc, node, asRoot, vars))
	name := ""
	if n := node.Str("name"); n != "" {
		name = " data-name=" + jsonv.Quote(n)
	}
	mode := ""
	if t := node.Str("type"); (t == "frame" || t == "page") && node.Str("mode") != "" {
		mode = node.Str("mode")
	} else if asRoot && vars {
		mode = ModeOf(doc, node)
	}
	if mode != "" {
		name += " data-paprika-mode=" + jsonv.Quote(mode)
	}
	switch node.Str("type") {
	case "frame", "group", "page":
		kids := []string{}
		for _, c := range childNodes(doc, node) {
			kids = append(kids, jsxNode(doc, c, false, indent+"  ", vars))
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
		svg, path := PathAttrsVars(doc, node, vars)
		return indent + "<svg" + name + " style=" + style + jsxAttrs(svg) + ">\n" + indent + "  <path" + jsxAttrs(path) + " />\n" + indent + "</svg>"
	case "connector":
		text := ""
		if label := ConnectorLabelAttrs(doc, node, vars); label != nil {
			text = "\n" + indent + "  <text" + jsxAttrs(label) + ">{" + jsonv.Quote(node.Str("label")) + "}</text>"
		}
		return indent + "<svg" + name + " style=" + style + ">\n" + indent + "  <path" + jsxAttrs(ConnectorAttrs(doc, node, vars)) + " />" + text + "\n" + indent + "</svg>"
	case "shape":
		svg, path, fold := ShapeAttrs(doc, node, vars)
		f := ""
		if fold != nil {
			f = "\n" + indent + "    <path" + jsxAttrs(fold) + " />"
		}
		return indent + "<div" + name + " style=" + style + ">\n" + indent + "  <svg" + jsxAttrs(svg) + " style=" + jsxStyle(ShapeSVGCSS()) + ">\n" +
			indent + "    <path" + jsxAttrs(path) + " />" + f + "\n" + indent + "  </svg>\n" + indent + "  <div style=" + jsxStyle(ShapeTextCSS()) + ">" +
			jsxText(node.Str("text")) + "</div>\n" + indent + "</div>"
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
func ExportReact(doc *Document, rootID string, cssVariables bool) (string, error) {
	node := GetNode(doc, rootID)
	if node == nil {
		return "", fmt.Errorf(`node "%s" does not exist`, rootID)
	}
	if node.Str("type") == "page" {
		return "", fmt.Errorf(`"%s" is a page; export one of its frames (export_code with the frame id)`, rootID)
	}
	n := node.Str("name")
	if n == "" {
		n = node.Str("id")
	}
	css := ""
	if cssVariables {
		css = "export const tokensCss = " + jsonv.Quote(TokenStylesheet(doc)) + ";\n\n"
	}
	return css + "export function " + componentName(n) + "() {\n  return (\n" + jsxNode(doc, node, true, "    ", cssVariables) + "\n  );\n}\n", nil
}
