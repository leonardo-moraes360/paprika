package core

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

type classSheet struct {
	rules  []string
	used   map[string]bool
	shared map[string]string
}

func (s *classSheet) unique(label string) string {
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

func (s *classSheet) emit(css *CSS, node *Node, label string) string {
	var name string
	if node == nil {
		if known, ok := s.shared[label]; ok {
			return ` class="` + known + `"`
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
	return ` class="` + name + `"`
}

func (s *classSheet) sheet() string { return strings.Join(s.rules, "\n") }

func newClassSheet() *classSheet {
	return &classSheet{used: map[string]bool{}, shared: map[string]string{}}
}

func kebabName(pascal string) string {
	re1 := regexp.MustCompile(`([a-z0-9])([A-Z])`)
	re2 := regexp.MustCompile(`([A-Z]+)([A-Z][a-z])`)
	k := strings.ToLower(re2.ReplaceAllString(re1.ReplaceAllString(pascal, "${1}-${2}"), "${1}-${2}"))
	if k == "" {
		return "design"
	}
	return k
}

type frameworkClassExport struct {
	body       string
	css        string
	name       string
	bounds     Bounds
	background string
	bodyMode   string
}

func classExport(doc *Document, rootID string, cssVariables bool) (frameworkClassExport, error) {
	node, err := exportRoot(doc, rootID)
	if err != nil {
		return frameworkClassExport{}, err
	}
	sheet := newClassSheet()
	p, err := buildExportParts(doc, RenderOptions{RootID: rootID, CSSVariables: cssVariables}, sheet.emit)
	if err != nil {
		return frameworkClassExport{}, err
	}
	tokens := ""
	if cssVariables {
		tokens = TokenStylesheet(doc) + "\n"
	}
	return frameworkClassExport{
		body: p.body, css: tokens + sheet.sheet() + "\n", name: exportName(node),
		bounds: p.bounds, background: p.background, bodyMode: p.bodyMode,
	}, nil
}

type AngularExport struct {
	Typescript string
	Template   string
	Styles     string
	ClassName  string
	Selector   string
	FileBase   string
}

func ExportAngular(doc *Document, rootID string, cssVariables bool) (AngularExport, error) {
	out, err := classExport(doc, rootID, cssVariables)
	if err != nil {
		return AngularExport{}, err
	}
	fileBase := out.name
	selector := "app-" + kebabName(out.name)
	return AngularExport{
		ClassName: out.name,
		Selector:  selector,
		FileBase:  fileBase,
		Typescript: "import { Component } from \"@angular/core\";\n\n@Component({\n  selector: " + jsonv.Quote(selector) +
			",\n  standalone: true,\n  templateUrl: \"./" + fileBase + ".component.html\",\n  styleUrl: \"./" + fileBase +
			".component.css\",\n})\nexport class " + out.name + " {}\n",
		Template: out.body + "\n",
		Styles:   out.css,
	}, nil
}

type SvelteExport struct {
	Source   string
	FileName string
}

var reSvelteGlobal = regexp.MustCompile(`(:root|\[data-paprika-mode="[^"]*"\])\{`)

func svelteGlobalCSS(css string) string {
	return reSvelteGlobal.ReplaceAllString(css, ":global($1){")
}

func ExportSvelte(doc *Document, rootID string, cssVariables bool) (SvelteExport, error) {
	out, err := classExport(doc, rootID, cssVariables)
	if err != nil {
		return SvelteExport{}, err
	}
	styles := out.css
	if cssVariables {
		styles = svelteGlobalCSS(out.css)
	}
	return SvelteExport{
		FileName: out.name + ".svelte",
		Source:   out.body + "\n\n<style>\n" + strings.TrimRight(styles, "\n") + "\n</style>\n",
	}, nil
}

func RenderFrameworkHTML(doc *Document, opts RenderOptions) (string, Bounds, error) {
	sheet := newClassSheet()
	p, err := buildExportParts(doc, opts, sheet.emit)
	if err != nil {
		return "", Bounds{}, err
	}
	css := sheet.sheet() + "\n"
	if p.vars {
		css = TokenStylesheet(doc) + "\n" + css
	}
	html := "<!doctype html>\n<html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><title>" + EscapeHTML(doc.Str("name")) + "</title>\n" +
		"<style>html,body{margin:0;padding:0}body{position:relative;width:" + jsonv.FormatNumber(p.bounds.Width) + "px;height:" +
		jsonv.FormatNumber(p.bounds.Height) + "px;background:" + EscapeHTML(p.background) +
		";font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" + strings.TrimRight(css, "\n") +
		"</style>\n</head><body" + p.bodyMode + ">" + p.body + "</body></html>"
	return html, p.bounds, nil
}
