package core

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

const tailwindCDN = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"

var (
	reWS         = regexp.MustCompile(`[` + jsWS + `]+`)
	reUnsafe     = regexp.MustCompile(`[\[\]{};]`)
	reBorder     = regexp.MustCompile(`^(\d+(?:\.\d+)?px)[` + jsWS + `]+(solid|dashed|dotted|none)[` + jsWS + `]+(.+)$`)
	reRotate     = regexp.MustCompile(`^rotate\((-?[\d.]+)deg\)$`)
	reDropShadow = regexp.MustCompile(`^drop-shadow\(((?:[^()]|\([^()]*\))*)\)$`)
)

var (
	twPosition   = map[string]bool{"static": true, "fixed": true, "absolute": true, "relative": true, "sticky": true}
	twDisplay    = map[string]string{"block": "block", "inline-block": "inline-block", "inline": "inline", "flex": "flex", "inline-flex": "inline-flex", "grid": "grid", "none": "hidden"}
	twAlignItems = map[string]string{"flex-start": "items-start", "flex-end": "items-end", "center": "items-center", "stretch": "items-stretch", "baseline": "items-baseline"}
	twAlignSelf  = map[string]string{"auto": "self-auto", "flex-start": "self-start", "flex-end": "self-end", "center": "self-center", "stretch": "self-stretch", "baseline": "self-baseline"}
	twJustify    = map[string]string{"flex-start": "justify-start", "flex-end": "justify-end", "center": "justify-center", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly"}
	twDirection  = map[string]string{"row": "flex-row", "row-reverse": "flex-row-reverse", "column": "flex-col", "column-reverse": "flex-col-reverse"}
	twOverflow   = map[string]string{"visible": "overflow-visible", "hidden": "overflow-hidden", "scroll": "overflow-scroll", "auto": "overflow-auto"}
	twObjectFit  = map[string]string{"cover": "object-cover", "contain": "object-contain", "fill": "object-fill", "none": "object-none", "scale-down": "object-scale-down"}
	twTextAlign  = map[string]string{"left": "text-left", "right": "text-right", "center": "text-center", "justify": "text-justify", "start": "text-start", "end": "text-end"}
	twWhiteSpace = map[string]string{"normal": "whitespace-normal", "nowrap": "whitespace-nowrap", "pre": "whitespace-pre", "pre-line": "whitespace-pre-line", "pre-wrap": "whitespace-pre-wrap"}
	twSizeValue  = map[string]string{"auto": "auto", "max-content": "max", "min-content": "min", "fit-content": "fit", "100%": "full"}
	twBorderLine = map[string]string{"solid": "border-solid", "dashed": "border-dashed", "dotted": "border-dotted", "none": "border-none"}
)

func twUnsafe(v string) bool { return reUnsafe.MatchString(v) }

func twArb(v string) string {
	return reWS.ReplaceAllString(strings.ReplaceAll(v, "_", `\_`), "_")
}

func twLookup(m map[string]string, v string) ([]string, bool) {
	if c, ok := m[v]; ok {
		return []string{c}, true
	}
	return nil, false
}

func twBorder(v string) ([]string, bool) {
	m := reBorder.FindStringSubmatch(v)
	if m == nil {
		return nil, false
	}
	style, ok := twBorderLine[m[2]]
	if !ok {
		return nil, false
	}
	return []string{"border-[length:" + twArb(m[1]) + "]", style, "border-[color:" + twArb(m[3]) + "]"}, true
}

func twPadding(v string) ([]string, bool) {
	parts := reWS.Split(jsonv.Trim(v), -1)
	switch len(parts) {
	case 1:
		return []string{"p-[" + parts[0] + "]"}, true
	case 2:
		return []string{"py-[" + parts[0] + "]", "px-[" + parts[1] + "]"}, true
	case 4:
		return []string{"pt-[" + parts[0] + "]", "pr-[" + parts[1] + "]", "pb-[" + parts[2] + "]", "pl-[" + parts[3] + "]"}, true
	}
	return nil, false
}

func tailwindClassesFor(key string, value any) ([]string, bool) {
	v := jsString(value)
	if reUnsafe.MatchString(v) {
		return nil, false
	}
	switch key {
	case "boxSizing":
		switch v {
		case "border-box":
			return []string{"box-border"}, true
		case "content-box":
			return []string{"box-content"}, true
		}
		return nil, false
	case "position":
		if twPosition[v] {
			return []string{v}, true
		}
		return nil, false
	case "left", "top", "right", "bottom":
		return []string{key + "-[" + twArb(v) + "]"}, true
	case "width", "height":
		prefix := "w"
		if key == "height" {
			prefix = "h"
		}
		if named, ok := twSizeValue[v]; ok {
			return []string{prefix + "-" + named}, true
		}
		return []string{prefix + "-[" + twArb(v) + "]"}, true
	case "minWidth", "minHeight":
		prefix := "min-w"
		if key == "minHeight" {
			prefix = "min-h"
		}
		if v == "0" || v == "0px" {
			return []string{prefix + "-0"}, true
		}
		return []string{prefix + "-[" + twArb(v) + "]"}, true
	case "maxWidth", "maxHeight":
		prefix := "max-w"
		if key == "maxHeight" {
			prefix = "max-h"
		}
		return []string{prefix + "-[" + twArb(v) + "]"}, true
	case "flex":
		return []string{"flex-[" + twArb(v) + "]"}, true
	case "flexShrink":
		if v == "0" {
			return []string{"shrink-0"}, true
		}
		return []string{"shrink-[" + v + "]"}, true
	case "flexGrow":
		if v == "1" {
			return []string{"grow"}, true
		}
		return []string{"grow-[" + v + "]"}, true
	case "alignItems":
		return twLookup(twAlignItems, v)
	case "alignSelf":
		return twLookup(twAlignSelf, v)
	case "justifyContent":
		return twLookup(twJustify, v)
	case "flexDirection":
		return twLookup(twDirection, v)
	case "flexWrap":
		switch v {
		case "wrap":
			return []string{"flex-wrap"}, true
		case "nowrap":
			return []string{"flex-nowrap"}, true
		}
		return nil, false
	case "gap":
		return []string{"gap-[" + twArb(v) + "]"}, true
	case "padding":
		return twPadding(v)
	case "margin":
		if v == "0" {
			return []string{"m-0"}, true
		}
		return []string{"m-[" + twArb(v) + "]"}, true
	case "display":
		return twLookup(twDisplay, v)
	case "opacity":
		return []string{"opacity-[" + v + "]"}, true
	case "transform":
		if m := reRotate.FindStringSubmatch(v); m != nil {
			return []string{"rotate-[" + m[1] + "deg]"}, true
		}
		return nil, false
	case "background", "backgroundColor":
		return []string{"bg-[color:" + twArb(v) + "]"}, true
	case "border":
		return twBorder(v)
	case "borderRadius":
		return []string{"rounded-[" + twArb(v) + "]"}, true
	case "boxShadow":
		return []string{"shadow-[" + twArb(v) + "]"}, true
	case "filter":
		if m := reDropShadow.FindStringSubmatch(v); m != nil {
			return []string{"drop-shadow-[" + twArb(m[1]) + "]"}, true
		}
		if twUnsafe(v) {
			return nil, false
		}
		return []string{"filter-[" + twArb(v) + "]"}, true
	case "backdropFilter":
		if twUnsafe(v) {
			return nil, false
		}
		return []string{"backdrop-filter-[" + twArb(v) + "]"}, true
	case "outline":
		if twUnsafe(v) {
			return nil, false
		}
		return []string{"outline-[" + twArb(v) + "]"}, true
	case "outlineOffset":
		return []string{"outline-offset-[" + twArb(v) + "]"}, true
	case "overflow":
		return twLookup(twOverflow, v)
	case "color":
		return []string{"text-[color:" + twArb(v) + "]"}, true
	case "fontFamily":
		return []string{"font-[family-name:" + twArb(v) + "]"}, true
	case "fontSize":
		return []string{"text-[length:" + twArb(v) + "]"}, true
	case "fontWeight":
		switch v {
		case "normal":
			return []string{"font-normal"}, true
		case "bold":
			return []string{"font-bold"}, true
		}
		return []string{"font-[" + v + "]"}, true
	case "lineHeight":
		return []string{"leading-[" + v + "]"}, true
	case "letterSpacing":
		return []string{"tracking-[" + twArb(v) + "]"}, true
	case "textAlign":
		return twLookup(twTextAlign, v)
	case "whiteSpace":
		return twLookup(twWhiteSpace, v)
	case "overflowWrap":
		switch v {
		case "anywhere":
			return []string{"[overflow-wrap:anywhere]"}, true
		case "break-word":
			return []string{"break-words"}, true
		}
		return nil, false
	case "objectFit":
		return twLookup(twObjectFit, v)
	}
	return nil, false
}

func tailwindClasses(css *CSS) ([]string, *CSS) {
	var classes []string
	fallback := jsonv.NewObject()
	for _, k := range css.Keys() {
		v, _ := css.Get(k)
		if mapped, ok := tailwindClassesFor(k, v); ok && len(mapped) > 0 {
			classes = append(classes, mapped...)
		} else {
			fallback.Set(k, v)
		}
	}
	return classes, fallback
}

func tailwindClassAttr(css *CSS, _ *Node, _ string) string {
	classes, fallback := tailwindClasses(css)
	out := ""
	if len(classes) > 0 {
		out += ` class="` + EscapeHTML(strings.Join(classes, " ")) + `"`
	}
	if fallback.Len() > 0 {
		out += ` style="` + EscapeHTML(CSSToString(fallback)) + `"`
	}
	return out
}

func tailwindClassNameAttr(css *CSS, node *Node, label string) string {
	classes, fallback := tailwindClasses(css)
	out := ""
	if len(classes) > 0 {
		out += " className=" + jsonv.Quote(strings.Join(classes, " "))
	}
	if fallback.Len() > 0 {
		out += jsxStyleAttr(fallback, node, label)
	}
	return out
}

func twBodyClasses(b Bounds, background string, fluid *fluidBox) string {
	size := []string{"w-[" + jsonv.FormatNumber(b.Width) + "px]", "h-[" + jsonv.FormatNumber(b.Height) + "px]"}
	if fluid != nil {
		size = []string{
			"w-full",
			"min-w-[" + jsonv.FormatNumber(fluid.Min) + "px]",
			"max-w-[" + jsonv.FormatNumber(fluid.Max) + "px]",
			"mx-auto",
			"h-[" + jsonv.FormatNumber(b.Height) + "px]",
		}
	}
	parts := []string{"relative"}
	parts = append(parts, size...)
	parts = append(parts,
		"bg-[color:"+twArb(background)+"]",
		"font-[family-name:Inter,system-ui,sans-serif]",
		"antialiased",
	)
	return strings.Join(parts, " ")
}

func RenderTailwindHTML(doc *Document, opts RenderOptions) (string, Bounds, error) {
	p, err := buildExportParts(doc, opts, tailwindClassAttr)
	if err != nil {
		return "", Bounds{}, err
	}
	tokens := ""
	if p.vars {
		tokens = "\n<style>" + TokenStylesheet(doc) + "</style>"
	}
	html := "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + EscapeHTML(doc.Str("name")) + "</title>\n" +
		`<script src="` + tailwindCDN + `"></script>` + tokens + "\n" +
		"</head><body" + p.bodyMode + ` class="` + EscapeHTML(twBodyClasses(p.bounds, p.background, p.fluid)) + `">` + p.body + "</body></html>"
	return html, p.bounds, nil
}

func exportRoot(doc *Document, rootID string) (*Node, error) {
	node := GetNode(doc, rootID)
	if node == nil {
		return nil, fmt.Errorf(`node "%s" does not exist`, rootID)
	}
	if node.Str("type") == "page" {
		return nil, fmt.Errorf(`"%s" is a page; export one of its frames (export_code with the frame id)`, rootID)
	}
	return node, nil
}

func exportName(node *Node) string {
	n := node.Str("name")
	if n == "" {
		n = node.Str("id")
	}
	return componentName(n)
}

func ExportTailwind(doc *Document, rootID string, cssVariables bool) (string, error) {
	node, err := exportRoot(doc, rootID)
	if err != nil {
		return "", err
	}
	tokens := ""
	if cssVariables {
		tokens = "export const tokensCss = " + jsonv.Quote(TokenStylesheet(doc)) + ";\n\n"
	}
	return tokens + "export function " + exportName(node) + "() {\n  return (\n" + jsxNode(doc, node, true, "    ", cssVariables, tailwindClassNameAttr) + "\n  );\n}\n", nil
}

type CSSModuleExport struct {
	Component string
	CSS       string
	FileName  string
}

type cssModuleSheet struct {
	rules  []string
	used   map[string]bool
	shared map[string]string
}

func (s *cssModuleSheet) unique(label string) string {
	base := "node"
	if p := pascalName(label); p != "" {
		base = strings.ToLower(p[:1]) + p[1:]
	}
	name := base
	for i := 2; s.used[name]; i++ {
		name = fmt.Sprintf("%s%d", base, i)
	}
	s.used[name] = true
	return name
}

func (s *cssModuleSheet) emit(css *CSS, node *Node, label string) string {
	var name string
	if node == nil {
		if known, ok := s.shared[label]; ok {
			return " className={styles." + known + "}"
		}
		name = s.unique(label)
		s.shared[label] = name
	} else {
		owner := node.Str("name")
		if owner == "" {
			owner = node.Str("id")
		}
		name = s.unique(owner)
	}
	s.rules = append(s.rules, "."+name+"{"+CSSToString(css)+"}")
	return " className={styles." + name + "}"
}

func ExportCSSModules(doc *Document, rootID string, cssVariables bool) (CSSModuleExport, error) {
	node, err := exportRoot(doc, rootID)
	if err != nil {
		return CSSModuleExport{}, err
	}
	name := exportName(node)
	sheet := &cssModuleSheet{used: map[string]bool{}, shared: map[string]string{}}
	body := jsxNode(doc, node, true, "    ", cssVariables, sheet.emit)
	tokens := ""
	if cssVariables {
		tokens = TokenStylesheet(doc) + "\n"
	}
	return CSSModuleExport{
		Component: "import styles from \"./" + name + ".module.css\";\n\nexport function " + name + "() {\n  return (\n" + body + "\n  );\n}\n",
		CSS:       tokens + strings.Join(sheet.rules, "\n") + "\n",
		FileName:  name + ".module.css",
	}, nil
}
