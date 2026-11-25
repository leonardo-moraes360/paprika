package core

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
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

type styleEmitter func(css *CSS, node *Node, label string) string

func htmlStyleAttr(css *CSS, _ *Node, _ string) string {
	return ` style="` + EscapeHTML(CSSToString(css)) + `"`
}

func jsxStyleAttr(css *CSS, _ *Node, _ string) string {
	return " style=" + jsxStyle(css)
}

func renderNode(doc *Document, node *Node, asRoot, vars bool, emit styleEmitter, offset *Point) string {
	css := NodeStyleVars(doc, node, asRoot, vars)
	if offset != nil && !asRoot && node.Str("type") != "page" {
		css.Set("left", jsonv.FormatNumber(node.Num("x")-offset.X)+"px")
		css.Set("top", jsonv.FormatNumber(node.Num("y")-offset.Y)+"px")
	}
	fluid := useFluid(doc, node, asRoot)
	if fluid {
		applyFluid(css, node)
	}
	name := ""
	if n := node.Str("name"); n != "" {
		name = ` data-name="` + EscapeHTML(n) + `"`
	}
	extra := ""
	if fluid {
		extra = fluidData(node)
	}
	typ := node.Str("type")
	attrs := fmt.Sprintf(`data-paprika-id="%s" data-paprika-type="%s"%s%s%s%s`, EscapeHTML(node.Str("id")), typ, name, extra, modeAttr(node), emit(css, node, ""))
	switch typ {
	case "frame", "group", "page":
		var kids strings.Builder
		for _, c := range childNodes(doc, node) {
			kids.WriteString(renderNode(doc, c, false, vars, emit, nil))
		}
		tag := "div"
		href := ""
		if typ == "frame" && node.Str("href") != "" {
			tag = "a"
			href = ` href="` + EscapeHTML(node.Str("href")) + `"`
		}
		return "<" + tag + " " + attrs + href + ">" + kids.String() + "</" + tag + ">"
	case "text":
		if node.Str("href") != "" {
			return `<a ` + attrs + ` href="` + EscapeHTML(node.Str("href")) + `">` + richText(doc, node, vars, false) + "</a>"
		}
		return "<div " + attrs + ">" + richText(doc, node, vars, false) + "</div>"
	case "image":
		src := EscapeHTML(ResolveAsset(doc, node.Str("src")))
		if node.Bool("decorative") {
			return "<img " + attrs + ` src="` + src + `" alt="" aria-hidden="true" data-paprika-decorative="true">`
		}
		return "<img " + attrs + ` src="` + src + `" alt="` + EscapeHTML(node.Str("alt")) + `">`
	case "path":
		svg, path, inner := PathAttrsVars(doc, node, vars)
		return "<svg " + attrs + ` xmlns="http://www.w3.org/2000/svg"` + svgAttrs(svg) + ">" + inner + "<path" + svgAttrs(path) + "/></svg>"
	case "connector":
		text := ""
		if label := ConnectorLabelAttrs(doc, node, vars); label != nil {
			text = "<text" + svgAttrs(label) + ">" + EscapeHTML(node.Str("label")) + "</text>"
		}
		return "<svg " + attrs + ` xmlns="http://www.w3.org/2000/svg"><path` + svgAttrs(ConnectorAttrs(doc, node, vars)) + "/>" + text + "</svg>"
	case "shape":
		svg, path, fold, inner := ShapeAttrs(doc, node, vars)
		f := ""
		if fold != nil {
			f = "<path" + svgAttrs(fold) + "/>"
		}
		return "<div " + attrs + `><svg xmlns="http://www.w3.org/2000/svg"` + svgAttrs(svg) + emit(ShapeSVGCSS(), nil, "shapeSvg") + ">" + inner + `<path` + svgAttrs(path) + "/>" + f +
			`</svg><div` + emit(ShapeTextCSS(), nil, "shapeText") + `>` + EscapeHTML(node.Str("text")) + "</div></div>"
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

type fluidBox struct{ Min, Max float64 }

type exportParts struct {
	body       string
	bounds     Bounds
	background string
	bodyMode   string
	vars       bool
	fluid      *fluidBox
	autoW      bool
	autoH      bool
}

func buildExportParts(doc *Document, opts RenderOptions, emit styleEmitter) (exportParts, error) {
	var body string
	var bounds Bounds
	var node, page *Node
	if opts.RootID != "" {
		node = GetNode(doc, opts.RootID)
		if node == nil {
			return exportParts{}, fmt.Errorf(`node "%s" does not exist`, opts.RootID)
		}
		if node.Str("type") == "page" {
			page = node
		}
	} else {
		page = FirstPage(doc)
	}
	if node != nil && page == nil {
		bounds, _ = RootBounds(doc, opts.RootID)
		body = renderNode(doc, node, true, opts.CSSVariables, emit, nil)
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
				b.WriteString(renderNode(doc, n, false, opts.CSSVariables, emit, &Point{bounds.X, bounds.Y}))
			}
		}
		body = b.String()
	}
	bg := opts.Background
	if bg == "" {
		bg = "#ffffff"
		if page != nil {
			if g := nodeGradient(page); g != nil {
				bg = gradientCSS(doc, g, page.Str("mode"), opts.CSSVariables)
			} else if f, ok := page.Get("fill"); ok && f != "" {
				bg = jsString(ResolveValue(doc, f, page.Str("mode")))
			}
		}
	}
	inherited := ""
	if node != nil && page == nil {
		if modeAttr(node) == "" {
			inherited = ModeOf(doc, node)
		}
	} else if page != nil {
		inherited = page.Str("mode")
	}
	bodyMode := ""
	if opts.CSSVariables && inherited != "" {
		bodyMode = ` data-paprika-mode="` + EscapeHTML(inherited) + `"`
	}
	autoW, autoH := false, false
	if node != nil && page == nil && node.Str("type") != "connector" {
		w, _ := node.Get("width")
		h, _ := node.Get("height")
		_, wNum := w.(float64)
		_, hNum := h.(float64)
		autoW, autoH = !wNum, !hNum
	}
	return exportParts{body, bounds, bg, bodyMode, opts.CSSVariables, exportFluid(doc, node, page), autoW, autoH}, nil
}

func useFluid(doc *Document, n *Node, asRoot bool) bool {
	if _, _, ok := frameFluid(n); !ok {
		return false
	}
	return asRoot || IsRootFrame(doc, n)
}

func applyFluid(css *CSS, n *Node) {
	min, max, ok := frameFluid(n)
	if !ok {
		return
	}
	css.Set("width", "100%")
	css.Set("minWidth", jsonv.FormatNumber(min)+"px")
	css.Set("maxWidth", jsonv.FormatNumber(max)+"px")
	css.Delete("flexShrink")
}

func fluidJsx(n *Node) string {
	min, max, ok := frameFluid(n)
	if !ok || n.Str("type") != "frame" {
		return ""
	}
	w, has := n.Get("width")
	wf, isNum := w.(float64)
	if !has || !isNum {
		return ""
	}
	return " data-paprika-width={" + jsonv.FormatNumber(wf) + "} data-paprika-min-width={" + jsonv.FormatNumber(min) + "} data-paprika-max-width={" + jsonv.FormatNumber(max) + "}"
}

func fluidData(n *Node) string {
	min, max, ok := frameFluid(n)
	if !ok || n.Str("type") != "frame" {
		return ""
	}
	w, has := n.Get("width")
	wf, isNum := w.(float64)
	if !has || !isNum {
		return ""
	}
	return ` data-paprika-width="` + jsonv.FormatNumber(wf) + `" data-paprika-min-width="` + jsonv.FormatNumber(min) + `" data-paprika-max-width="` + jsonv.FormatNumber(max) + `"`
}

func aggregateFluid(nodes []*Node) *fluidBox {
	var box *fluidBox
	for _, n := range nodes {
		min, max, ok := frameFluid(n)
		if !ok {
			continue
		}
		if box == nil {
			box = &fluidBox{min, max}
			continue
		}
		if min < box.Min {
			box.Min = min
		}
		if max > box.Max {
			box.Max = max
		}
	}
	return box
}

func exportFluid(doc *Document, node, page *Node) *fluidBox {
	var nodes []*Node
	if node != nil && page == nil {
		nodes = []*Node{node}
	} else {
		pageID := ""
		if page != nil {
			pageID = page.Str("id")
		}
		roots, _ := PageRoots(doc, pageID)
		for _, id := range roots {
			if n := GetNode(doc, id); n != nil {
				nodes = append(nodes, n)
			}
		}
	}
	return aggregateFluid(nodes)
}

// BodySizeCSS sizes the exported <body>. autoW/autoH: the root is sized "hug"/"fill" on that axis (its
// box is 1px in b): the body follows the root, which stays in the flow.
func BodySizeCSS(b Bounds, fluid *fluidBox, autoW, autoH bool) string {
	height := "height:" + jsonv.FormatNumber(b.Height) + "px"
	if autoH {
		height = "min-height:1px"
	}
	if fluid == nil {
		width := "width:" + jsonv.FormatNumber(b.Width) + "px;"
		if autoW {
			width = ""
		}
		return width + height
	}
	return "width:100%;min-width:" + jsonv.FormatNumber(fluid.Min) + "px;max-width:" + jsonv.FormatNumber(fluid.Max) + "px;margin-left:auto;margin-right:auto;" + height
}

// RenderHTML builds a self-contained HTML document (export and screenshot).
func RenderHTML(doc *Document, opts RenderOptions) (string, Bounds, error) {
	p, err := buildExportParts(doc, opts, htmlStyleAttr)
	if err != nil {
		return "", Bounds{}, err
	}
	sheet := ""
	if p.vars {
		sheet = TokenStylesheet(doc)
	}
	html := "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + EscapeHTML(doc.Str("name")) + "</title>\n" +
		"<style>html,body{margin:0;padding:0}body{position:relative;" + BodySizeCSS(p.bounds, p.fluid, p.autoW, p.autoH) +
		";background:" + EscapeHTML(p.background) + ";font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" + sheet + "</style>\n" +
		"</head><body" + p.bodyMode + ">" + p.body + "</body></html>"
	return html, p.bounds, nil
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

func richText(doc *Document, node *Node, vars, jsx bool) string {
	runs := node.Arr("runs")
	if len(runs) == 0 {
		if jsx {
			return jsxText(node.Str("text"))
		}
		return EscapeHTML(node.Str("text"))
	}
	var b strings.Builder
	for _, p := range TextPieces(node.Str("text"), runs) {
		body := EscapeHTML(p.Text)
		if jsx {
			body = jsxText(p.Text)
		}
		if p.Run == nil {
			b.WriteString(body)
			continue
		}
		css := TextRunCSS(doc, node, p.Run, vars)
		style := ` style="` + EscapeHTML(CSSToString(css)) + `"`
		if jsx {
			style = " style=" + jsxStyle(css)
		}
		if href, ok := p.Run.Get("href"); ok {
			if jsx {
				b.WriteString("<a href=" + jsonv.Quote(jsString(href)) + style + ">" + body + "</a>")
			} else {
				b.WriteString(`<a href="` + EscapeHTML(jsString(href)) + `"` + style + ">" + body + "</a>")
			}
			continue
		}
		b.WriteString("<span" + style + ">" + body + "</span>")
	}
	return b.String()
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

func jsxNode(doc *Document, node *Node, asRoot bool, indent string, vars bool, emit styleEmitter) string {
	css := NodeStyleVars(doc, node, asRoot, vars)
	fluid := useFluid(doc, node, asRoot)
	if fluid {
		applyFluid(css, node)
	}
	style := emit(css, node, "")
	name := ""
	if n := node.Str("name"); n != "" {
		name = " data-name=" + jsonv.Quote(n)
	}
	if fluid {
		name += fluidJsx(node)
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
			kids = append(kids, jsxNode(doc, c, false, indent+"  ", vars, emit))
		}
		tag := "div"
		href := ""
		if node.Str("type") == "frame" && node.Str("href") != "" {
			tag = "a"
			href = " href=" + jsonv.Quote(node.Str("href"))
		}
		if len(kids) > 0 {
			return indent + "<" + tag + name + href + style + ">\n" + strings.Join(kids, "\n") + "\n" + indent + "</" + tag + ">"
		}
		return indent + "<" + tag + name + href + style + " />"
	case "text":
		tag := "div"
		href := ""
		if node.Str("href") != "" {
			tag = "a"
			href = " href=" + jsonv.Quote(node.Str("href"))
		}
		return indent + "<" + tag + name + href + style + ">" + richText(doc, node, vars, true) + "</" + tag + ">"
	case "image":
		hidden := " alt=" + jsonv.Quote(node.Str("alt"))
		if node.Bool("decorative") {
			hidden = ` alt="" aria-hidden data-paprika-decorative="true"`
		}
		return indent + "<img" + name + style + " src=" + jsonv.Quote(ResolveAsset(doc, node.Str("src"))) + hidden + " />"
	case "path":
		svg, path, inner := PathAttrsVars(doc, node, vars)
		return indent + "<svg" + name + style + jsxAttrs(svg) + ">\n" + indent + "  " + inner + "<path" + jsxAttrs(path) + " />\n" + indent + "</svg>"
	case "connector":
		text := ""
		if label := ConnectorLabelAttrs(doc, node, vars); label != nil {
			text = "\n" + indent + "  <text" + jsxAttrs(label) + ">{" + jsonv.Quote(node.Str("label")) + "}</text>"
		}
		return indent + "<svg" + name + style + ">\n" + indent + "  <path" + jsxAttrs(ConnectorAttrs(doc, node, vars)) + " />" + text + "\n" + indent + "</svg>"
	case "shape":
		svg, path, fold, inner := ShapeAttrs(doc, node, vars)
		f := ""
		if fold != nil {
			f = "\n" + indent + "    <path" + jsxAttrs(fold) + " />"
		}
		return indent + "<div" + name + style + ">\n" + indent + "  <svg" + jsxAttrs(svg) + emit(ShapeSVGCSS(), nil, "shapeSvg") + ">\n" +
			indent + "    " + inner + "<path" + jsxAttrs(path) + " />" + f + "\n" + indent + "  </svg>\n" + indent + "  <div" + emit(ShapeTextCSS(), nil, "shapeText") + ">" +
			jsxText(node.Str("text")) + "</div>\n" + indent + "</div>"
	}
	return indent + "<div" + name + style + " />"
}

func isASCIIAlnum(r rune) bool {
	return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
}

func isASCIIAlpha(r rune) bool { return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') }

// jsUpper is String#toUpperCase for one UTF-16 unit worth of text.
func jsUpper(s string) string { return strings.ToUpperSpecial(unicode.SpecialCase{}, s) }

func pascalName(s string) string {
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
	return string(out[k:])
}

func componentName(s string) string {
	out := []rune(pascalName(s))
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
	return css + "export function " + componentName(n) + "() {\n  return (\n" + jsxNode(doc, node, true, "    ", cssVariables, jsxStyleAttr) + "\n  );\n}\n", nil
}
