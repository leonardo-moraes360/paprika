package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

// The fixtures come from the TypeScript reference (server-go/scripts/gen-golden.mjs).
// Every output must match byte for byte.

func loadGolden(t *testing.T) *jsonv.Object {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	v, err := jsonv.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*jsonv.Object)
}

func mustDoc(t *testing.T, text string) *Document {
	t.Helper()
	v, err := jsonv.Parse([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	d, err := ParseDocument(v)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func eq(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s\n--- got\n%s\n--- want\n%s", what, got, want)
	}
}

func baseDocs(t *testing.T, g *jsonv.Object) map[string]*Document {
	docs := map[string]*Document{}
	for _, v := range g.Arr("views") {
		o := v.(*jsonv.Object)
		switch name := o.Str("name"); name {
		case "empty", "card", "demo", "bezier", "free", "grouped", "paged", "comp", "themed", "diagram", "corners", "absflow", "grad", "rich", "wrapped":
			docs[name] = mustDoc(t, o.Str("doc"))
		}
	}
	return docs
}

func TestGoldenOps(t *testing.T) {
	g := loadGolden(t)
	docs := baseDocs(t, g)
	for i, v := range g.Arr("opResults") {
		c := v.(*jsonv.Object)
		before := jsonv.Stringify(docs[c.Str("doc")], "  ")
		r, err := ApplyOps(docs[c.Str("doc")], c.Arr("ops"))
		label := jsonv.Stringify(c.Arr("ops"), "")
		if after := jsonv.Stringify(docs[c.Str("doc")], "  "); after != before {
			t.Errorf("case %d mutated its input document", i)
		}
		if !c.Bool("ok") {
			if err == nil {
				t.Errorf("case %d %s: expected error %q", i, label, c.Str("error"))
				continue
			}
			eq(t, "case error "+label, err.Error(), c.Str("error"))
			continue
		}
		if err != nil {
			t.Errorf("case %d %s: unexpected error %v", i, label, err)
			continue
		}
		eq(t, "case doc "+label, jsonv.Stringify(r.Doc, "  "), c.Str("result"))
		eq(t, "case inverse "+label, jsonv.Stringify(r.Inverse, ""), c.Str("inverse"))
		eq(t, "case created "+label, strings.Join(r.Created, ","), strings.Join(c.Strings("created"), ","))
	}
}

func TestGoldenStructure(t *testing.T) {
	g := loadGolden(t)
	docs := baseDocs(t, g)
	for i, v := range g.Arr("structure") {
		c := v.(*jsonv.Object)
		d := docs[c.Str("doc")]
		args := c.Obj("args")
		where := "structure " + jsonv.FormatNumber(float64(i)) + " " + c.Str("kind") + " " + jsonv.Stringify(args, "")
		var ops []any
		var id string
		var released []string
		var dup *DuplicatePlan
		var err error
		switch c.Str("kind") {
		case "duplicate":
			dup, err = DuplicateOps(d, args.Strings("ids"), args)
			if dup != nil {
				ops = dup.Ops
			}
		case "group":
			ops, id, err = GroupOps(d, args.Strings("ids"), args.Str("id"), args.Str("name"))
		case "ungroup":
			ops, released, err = UngroupOps(d, args.Strings("ids"))
		case "combine":
			ops, id, err = CombinePathsOps(d, args.Strings("ids"), BooleanOperation(args.Str("operation")), args.Str("id"), args.Str("name"))
		case "align":
			ops, err = AlignOps(d, args.Strings("ids"), args.Str("edge"))
		case "distribute":
			ops, err = DistributeOps(d, args.Strings("ids"), args.Str("axis"))
		case "wrap":
			ops, id, err = WrapOps(d, args.Strings("ids"), args.Str("id"), args.Str("name"))
		case "reveal":
			ops, released, err = RevealOps(d, args.Str("kind"), args.Str("pageId"))
		default:
			ops, id = AddPageOps(d, args.Str("id"), args.Str("name"), args.Str("firstId"), "")
		}
		if !c.Bool("ok") {
			if err == nil {
				t.Errorf("%s: expected error %q", where, c.Str("error"))
				continue
			}
			eq(t, where+" error", err.Error(), c.Str("error"))
			continue
		}
		if err != nil {
			t.Errorf("%s: unexpected error %v", where, err)
			continue
		}
		r, aerr := ApplyOps(d, ops)
		stable := func(text string) string {
			if dup == nil {
				return text
			}
			var from []string
			var to []string
			if aerr == nil {
				for _, nid := range Nodes(r.Doc).Keys() {
					src := GetNode(r.Doc, nid).Str("sourceId")
					if src == "" {
						continue
					}
					for _, orig := range dup.Map.Keys() {
						copied, _ := dup.Map.Get(orig)
						if nid == CopyID(copied.(string), src) {
							from = append(from, nid)
							to = append(to, "@"+orig+"~"+src)
						}
					}
				}
			}
			for _, orig := range dup.Map.Keys() {
				copied, _ := dup.Map.Get(orig)
				from = append(from, copied.(string))
				to = append(to, "@"+orig)
			}
			for i := range from {
				text = strings.ReplaceAll(text, from[i], to[i])
			}
			return text
		}
		eq(t, where+" ops", stable(jsonv.Stringify(jsonv.FromGo(ops), "")), c.Str("ops"))
		if c.Has("id") {
			eq(t, where+" id", id, c.Str("id"))
		}
		if c.Has("released") {
			eq(t, where+" released", strings.Join(released, ","), strings.Join(c.Strings("released"), ","))
		}
		if c.Has("applyError") {
			if aerr == nil {
				t.Errorf("%s: expected apply error %q", where, c.Str("applyError"))
			} else {
				eq(t, where+" apply error", stable(aerr.Error()), c.Str("applyError"))
			}
			continue
		}
		if aerr != nil {
			t.Errorf("%s: apply error %v", where, aerr)
			continue
		}
		eq(t, where+" result", stable(jsonv.Stringify(r.Doc, "  ")), c.Str("result"))
	}
}

func TestGoldenZodMessages(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("zodResults") {
		c := v.(*jsonv.Object)
		input, _ := c.Get("input")
		_, err := z.Parse(OpSchema, input)
		got := ""
		if err != nil {
			got = err.Error()
		}
		eq(t, "zod "+jsonv.Stringify(input, ""), got, c.Str("error"))
	}
}

func TestGoldenHistory(t *testing.T) {
	g := loadGolden(t)
	h := NewHistory(baseDocs(t, g)["card"])
	steps := g.Arr("history")
	check := func(i int) {
		s := steps[i].(*jsonv.Object)
		eq(t, "history "+s.Str("label"), jsonv.Stringify(h.Doc(), "  "), s.Str("doc"))
		if h.CanUndo() != s.Bool("canUndo") || h.CanRedo() != s.Bool("canRedo") {
			t.Errorf("history %s: canUndo/canRedo differ", s.Str("label"))
		}
	}
	must := func(_ any, err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	upd := jsonv.NewObject("op", "update", "id", "title", "props", jsonv.NewObject("text", "A"))
	must(h.Apply([]any{upd}, "user", "a"))
	check(0)
	must(h.Apply([]any{jsonv.NewObject("op", "delete", "id", "bar"), jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject("ink", "#111"))}, "agent", "b"))
	check(1)
	h.Undo()
	check(2)
	h.Undo()
	check(3)
	h.Redo()
	check(4)
	must(h.Apply([]any{jsonv.NewObject("op", "move", "id", "title", "parentId", nil)}, "user", "c"))
	check(5)
	h.Undo()
	check(6)
}

func TestGoldenViews(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("views") {
		c := v.(*jsonv.Object)
		name := c.Str("name")
		doc := mustDoc(t, c.Str("doc"))
		eq(t, name+" doc roundtrip", jsonv.Stringify(doc, "  "), c.Str("doc"))
		eq(t, name+" outline", Outline(doc, "", -1), c.Str("outline"))
		eq(t, name+" outline depth 0", Outline(doc, "", 0), c.Str("outlineDepth0"))
		eq(t, name+" outline depth 1", Outline(doc, "", 1), c.Str("outlineDepth1"))
		eq(t, name+" lint", jsonv.Stringify(jsonv.FromGo(LintDocument(doc, "")), ""), c.Str("lint"))
		html, _, _ := RenderHTML(doc, RenderOptions{})
		eq(t, name+" html", html, c.Str("html"))
		for _, id := range c.Obj("lintRoots").Keys() {
			eq(t, name+" lint "+id, jsonv.Stringify(jsonv.FromGo(LintDocument(doc, id)), ""), c.Obj("lintRoots").Str(id))
			h, _, err := RenderHTML(doc, RenderOptions{RootID: id, Background: "transparent"})
			if err != nil {
				t.Fatal(err)
			}
			eq(t, name+" html "+id, h, c.Obj("htmlRoots").Str(id))
		}
		for _, id := range c.Obj("htmlPages").Keys() {
			h, _, err := RenderHTML(doc, RenderOptions{RootID: id})
			if err != nil {
				t.Fatal(err)
			}
			eq(t, name+" html page "+id, h, c.Obj("htmlPages").Str(id))
		}
		hv, _, err := RenderHTML(doc, RenderOptions{CSSVariables: true})
		if err != nil {
			t.Fatal(err)
		}
		eq(t, name+" html vars", hv, c.Str("htmlVars"))
		for _, id := range Nodes(doc).Keys() {
			h, _, err := RenderHTML(doc, RenderOptions{RootID: id, CSSVariables: true})
			if err != nil {
				t.Fatal(err)
			}
			eq(t, name+" html vars "+id, h, c.Obj("htmlVarsRoots").Str(id))
			rv, err := ExportReact(doc, id, true)
			if err != nil {
				rv = "ERROR: " + err.Error()
			}
			eq(t, name+" react vars "+id, rv, c.Obj("reactVars").Str(id))
			r, err := ExportReact(doc, id, false)
			if err != nil {
				r = "ERROR: " + err.Error()
			}
			eq(t, name+" react "+id, r, c.Obj("react").Str(id))
			tw, err := ExportTailwind(doc, id, false)
			if err != nil {
				tw = "ERROR: " + err.Error()
			}
			eq(t, name+" tailwind "+id, tw, c.Obj("tailwind").Str(id))
			eq(t, name+" describe "+id, DescribeNode(GetNode(doc, id)), c.Obj("describe").Str(id))
			eq(t, name+" style "+id, CSSToString(NodeStyle(doc, GetNode(doc, id), false)), c.Obj("style").Str(id))
		}
		twh, _, err := RenderTailwindHTML(doc, RenderOptions{})
		if err != nil {
			t.Fatal(err)
		}
		eq(t, name+" tailwind html", twh, c.Str("tailwindHtml"))
		twhv, _, err := RenderTailwindHTML(doc, RenderOptions{CSSVariables: true})
		if err != nil {
			t.Fatal(err)
		}
		eq(t, name+" tailwind html vars", twhv, c.Str("tailwindHtmlVars"))
		for _, id := range doc.Strings("rootIds") {
			h, _, err := RenderTailwindHTML(doc, RenderOptions{RootID: id, CSSVariables: true})
			if err != nil {
				t.Fatal(err)
			}
			eq(t, name+" tailwind html root "+id, h, c.Obj("tailwindHtmlRoots").Str(id))
			tv, err := ExportTailwind(doc, id, true)
			if err != nil {
				tv = "ERROR: " + err.Error()
			}
			eq(t, name+" tailwind vars "+id, tv, c.Obj("tailwindVars").Str(id))
			for _, vars := range []bool{false, true} {
				key := "cssModules"
				if vars {
					key = "cssModulesVars"
				}
				m, err := ExportCSSModules(doc, id, vars)
				got := "ERROR: "
				if err != nil {
					got += err.Error()
				} else {
					got = jsonv.Stringify(jsonv.NewObject("component", m.Component, "css", m.CSS, "fileName", m.FileName), "")
				}
				eq(t, name+" "+key+" "+id, got, c.Obj(key).Str(id))
			}
			for _, vars := range []bool{false, true} {
				key := "angular"
				if vars {
					key = "angularVars"
				}
				a, err := ExportAngular(doc, id, vars)
				got := "ERROR: "
				if err != nil {
					got += err.Error()
				} else {
					got = jsonv.Stringify(jsonv.NewObject(
						"typescript", a.Typescript, "template", a.Template, "styles", a.Styles,
						"className", a.ClassName, "selector", a.Selector, "fileBase", a.FileBase,
					), "")
				}
				eq(t, name+" "+key+" "+id, got, c.Obj(key).Str(id))
			}
			for _, vars := range []bool{false, true} {
				key := "svelte"
				if vars {
					key = "svelteVars"
				}
				s, err := ExportSvelte(doc, id, vars)
				got := "ERROR: "
				if err != nil {
					got += err.Error()
				} else {
					got = jsonv.Stringify(jsonv.NewObject("source", s.Source, "fileName", s.FileName), "")
				}
				eq(t, name+" "+key+" "+id, got, c.Obj(key).Str(id))
			}
		}
		fwh, _, err := RenderFrameworkHTML(doc, RenderOptions{})
		if err != nil {
			t.Fatal(err)
		}
		eq(t, name+" framework html", fwh, c.Str("frameworkHtml"))
		fwhv, _, err := RenderFrameworkHTML(doc, RenderOptions{CSSVariables: true})
		if err != nil {
			t.Fatal(err)
		}
		eq(t, name+" framework html vars", fwhv, c.Str("frameworkHtmlVars"))
		ids := func(ns []*Node) string {
			s := make([]string, len(ns))
			for i, n := range ns {
				s[i] = n.Str("id")
			}
			return strings.Join(s, ",")
		}
		f := c.Obj("find")
		within := ""
		if r := doc.Strings("rootIds"); len(r) > 0 {
			within = ids(QueryNodes(doc, NodeQuery{Within: r[0]}))
		}
		eq(t, name+" find text", ids(QueryNodes(doc, NodeQuery{Type: "text"})), strings.Join(f.Strings("text"), ","))
		eq(t, name+" find nameA", ids(QueryNodes(doc, NodeQuery{Name: "A", Limit: 3})), strings.Join(f.Strings("nameA"), ","))
		eq(t, name+" find textE", ids(QueryNodes(doc, NodeQuery{Text: "E"})), strings.Join(f.Strings("textE"), ","))
		eq(t, name+" find within", within, strings.Join(f.Strings("within"), ","))
	}
}

func TestGoldenTailwindMap(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("tailwindMapCases") {
		c := v.(*jsonv.Object)
		value, _ := c.Get("value")
		got := "null"
		if classes, ok := tailwindClassesFor(c.Str("key"), value); ok {
			got = jsonv.Stringify(jsonv.FromGo(classes), "")
		}
		want, _ := c.Get("classes")
		eq(t, "tailwind map "+c.Str("key")+" "+jsString(value), got, jsonv.Stringify(want, ""))
	}
}

func TestGoldenPathEdits(t *testing.T) {
	g := loadGolden(t)
	cases := g.Arr("pathEdits")
	if len(cases) == 0 {
		t.Fatal("pathEdits fixture missing — run pnpm go:golden")
	}
	for _, v := range cases {
		c := v.(*jsonv.Object)
		got := runPathEdit(t, c)
		want, _ := c.Get("result")
		eq(t, "path edit "+c.Str("name"), jsonv.Stringify(got, ""), jsonv.Stringify(want, ""))
	}
}

func runPathEdit(t *testing.T, c *jsonv.Object) any {
	t.Helper()
	segs, err := ParsePath(c.Str("d"))
	if err != nil {
		t.Fatalf("path edit %s: %v", c.Str("name"), err)
	}
	subs := PathToSubpaths(segs)
	ref := AnchorRef{Sub: int(c.Num("sub")), Index: int(c.Num("index"))}
	switch c.Str("op") {
	case "subpaths":
		return SerializePath(SubpathsToPath(subs))
	case "moveAnchor":
		return SerializePath(SubpathsToPath(MoveAnchor(subs, ref, Point{c.Num("x"), c.Num("y")})))
	case "moveHandle":
		moved := MoveHandle(subs, ref, c.Str("side"), Point{c.Num("x"), c.Num("y")}, c.Bool("mirror"))
		a := moved[ref.Sub].Anchors[ref.Index]
		o := jsonv.NewObject("x", a.X, "y", a.Y)
		if a.In != nil {
			o.Set("in", jsonv.NewObject("x", a.In.X, "y", a.In.Y))
		} else {
			o.Set("in", nil)
		}
		if a.Out != nil {
			o.Set("out", jsonv.NewObject("x", a.Out.X, "y", a.Out.Y))
		} else {
			o.Set("out", nil)
		}
		return o
	case "props":
		node := c.Obj("node")
		edited := subs
		if c.Has("to") {
			to := c.Obj("to")
			edited = MoveAnchor(subs, ref, Point{to.Num("x"), to.Num("y")})
		}
		p := PathEditProps(PathEditNode{X: node.Num("x"), Y: node.Num("y"), ViewBox: node.Has("viewBox")}, edited, c.Bool("moveBox"))
		if p == nil {
			return nil
		}
		if !p.HasSize {
			return jsonv.NewObject("d", p.D)
		}
		o := jsonv.NewObject("d", p.D, "width", p.Width, "height", p.Height)
		if p.HasXY {
			o.Set("x", p.X)
			o.Set("y", p.Y)
		}
		return o
	case "flat":
		at, ok := AnchorByFlatIndex(subs, int(c.Num("index")))
		if !ok {
			return nil
		}
		return jsonv.NewObject("sub", float64(at.Sub), "index", float64(at.Index))
	default:
		t.Fatalf("path edit %s: unknown op %q", c.Str("name"), c.Str("op"))
		return nil
	}
}

func TestGoldenPaths(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("paths") {
		c := v.(*jsonv.Object)
		d := c.Str("d")
		segs, err := ParsePath(d)
		if c.Has("error") {
			if err == nil {
				t.Errorf("path %q: expected error %q", d, c.Str("error"))
				continue
			}
			eq(t, "path error "+d, err.Error(), c.Str("error"))
			continue
		}
		if err != nil {
			t.Errorf("path %q: %v", d, err)
			continue
		}
		eq(t, "path normalized "+d, SerializePath(segs), c.Str("normalized"))
		cmds := make([]byte, len(segs))
		for i, s := range segs {
			cmds[i] = s.Cmd
		}
		eq(t, "path cmds "+d, string(cmds), c.Str("cmds"))
		b := PathBounds(segs)
		got := jsonv.Stringify(jsonv.NewObject("x", b.X, "y", b.Y, "width", b.Width, "height", b.Height), "")
		eq(t, "path bounds "+d, got, jsonv.Stringify(c.Obj("bounds"), ""))
	}
}

func TestGoldenColors(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("colors") {
		c := v.(*jsonv.Object)
		rgba, ok := ParseColor(c.Str("c"))
		got := "null"
		if ok {
			got = jsonv.Stringify(jsonv.NewObject("r", rgba.R, "g", rgba.G, "b", rgba.B, "a", rgba.A), "")
		}
		want, _ := c.Get("rgba")
		eq(t, "color "+c.Str("c"), got, jsonv.Stringify(want, ""))
	}
	for _, v := range g.Arr("contrast") {
		c := v.(*jsonv.Object)
		a, _ := ParseColor(c.Str("a"))
		b, _ := ParseColor(c.Str("b"))
		r := ContrastRatio(a, b)
		eq(t, "contrast "+c.Str("a"), jsonv.FormatNumber(r), jsonv.FormatNumber(c.Num("ratio")))
		eq(t, "toFixed "+c.Str("a"), toFixed(r, 2), c.Str("fixed"))
	}
}

func TestGoldenBadDocs(t *testing.T) {
	g := loadGolden(t)
	for _, v := range g.Arr("badDocs") {
		c := v.(*jsonv.Object)
		input, _ := c.Get("input")
		doc, err := ParseDocument(input)
		if c.Bool("ok") {
			if err != nil {
				t.Errorf("doc %s: %v", jsonv.Stringify(input, ""), err)
				continue
			}
			eq(t, "doc", jsonv.Stringify(doc, "  "), c.Str("doc"))
			continue
		}
		if err == nil {
			t.Errorf("doc %s: expected error", jsonv.Stringify(input, ""))
			continue
		}
		eq(t, "doc error "+jsonv.Stringify(input, ""), err.Error(), c.Str("error"))
	}
	eq(t, "createDocument", jsonv.Stringify(CreateDocument("Untitled", "abc"), ""), jsonv.Stringify(g.Obj("created"), ""))
}

func TestToFixedTies(t *testing.T) {
	// JavaScript picks the larger n on exact ties (0.125 → "0.13"); Go's strconv would round to even.
	for in, want := range map[float64]string{0.125: "0.13", 2.375: "2.38", 4.5: "4.50", 21: "21.00", 1.005: "1.00"} {
		if got := toFixed(in, 2); got != want {
			t.Errorf("toFixed(%v) = %s, want %s", in, got, want)
		}
	}
}

// TestGoldenRandomRuns replays seeded random transactions (valid and invalid), undos and redos.
func TestGoldenRandomRuns(t *testing.T) {
	g := loadGolden(t)
	docs := baseDocs(t, g)
	for r, v := range g.Arr("randomRuns") {
		run := v.(*jsonv.Object)
		h := NewHistory(docs[run.Str("base")])
		for k, sv := range run.Arr("steps") {
			s := sv.(*jsonv.Object)
			var err error
			switch s.Str("kind") {
			case "undo":
				_, _, err = h.Undo()
			case "redo":
				_, _, err = h.Redo()
			default:
				_, err = h.Apply(s.Arr("ops"), "fuzz", "")
			}
			where := "run " + jsonv.FormatNumber(float64(r)) + " step " + jsonv.FormatNumber(float64(k))
			if s.Has("error") != (err != nil) {
				t.Fatalf("%s: error mismatch: got %v, want %q", where, err, s.Str("error"))
			}
			if err != nil {
				eq(t, where+" error", err.Error(), s.Str("error"))
			}
			sum := sha256.Sum256([]byte(jsonv.Stringify(h.Doc(), "  ")))
			eq(t, where+" doc sha256", hex.EncodeToString(sum[:]), s.Str("sha256"))
			if h.CanUndo() != s.Bool("canUndo") || h.CanRedo() != s.Bool("canRedo") {
				t.Fatalf("%s: canUndo/canRedo differ", where)
			}
		}
	}
}

func importJSON(r ImportResult) string {
	ws := make([]any, len(r.Warnings))
	for i, w := range r.Warnings {
		ws[i] = w
	}
	nodes := nodesAny(r.Nodes)
	if nodes == nil {
		nodes = []any{}
	}
	return jsonv.Stringify(jsonv.NewObject("nodes", nodes, "warnings", ws), "")
}

func resultString(ok bool, value, errMsg string) string {
	if ok {
		return "ok " + value
	}
	return "error " + errMsg
}

func wantResult(c *jsonv.Object) string {
	r := c
	if r.Bool("ok") {
		return resultString(true, r.Str("value"), "")
	}
	return resultString(false, "", r.Str("error"))
}

func TestGoldenImports(t *testing.T) {
	g := loadGolden(t)
	im := g.Obj("imports")
	for i, v := range im.Arr("svg") {
		c := v.(*jsonv.Object)
		o := c.Obj("opts")
		opts := ImportOptions{X: o.Num("x"), Y: o.Num("y")}
		if o.Has("name") {
			n := o.Str("name")
			opts.Name = &n
		}
		r, err := ImportSVG(c.Str("src"), opts)
		got := ""
		if err != nil {
			got = resultString(false, "", err.Error())
		} else {
			got = resultString(true, importJSON(r), "")
		}
		eq(t, fmt.Sprintf("svg %d %s", i, c.Str("src")), got, wantResult(c.Obj("result")))
	}
	for i, v := range im.Arr("html") {
		c := v.(*jsonv.Object)
		src := c.Str("src")
		r, err := ImportHTML(src, ImportOptions{X: float64(jsonv.Len16(src) % 3)})
		got := ""
		if err != nil {
			got = resultString(false, "", err.Error())
		} else {
			got = resultString(true, importJSON(r), "")
		}
		eq(t, fmt.Sprintf("html %d %.80s", i, src), got, wantResult(c.Obj("result")))
	}
}

func svgJSON(r SVGResult) string {
	ws := make([]any, len(r.Warnings))
	for i, w := range r.Warnings {
		ws[i] = w
	}
	return jsonv.Stringify(jsonv.NewObject("svg", r.SVG, "width", r.Width, "height", r.Height, "warnings", ws), "")
}

func TestGoldenSVGExport(t *testing.T) {
	g := loadGolden(t)
	docs := baseDocs(t, g)
	for _, v := range g.Arr("svgExports") {
		c := v.(*jsonv.Object)
		doc := docs[c.Str("name")]
		var m Measure
		if err := json.Unmarshal([]byte(c.Str("measure")), &m); err != nil {
			t.Fatal(err)
		}
		for _, mode := range []string{"plain", "measured"} {
			cases := c.Obj(mode)
			for _, id := range cases.Keys() {
				var mp *Measure
				if mode == "measured" {
					mp = &m
				}
				r, err := ExportSVG(doc, id, mp)
				got := ""
				if err != nil {
					got = resultString(false, "", err.Error())
				} else {
					got = resultString(true, svgJSON(r), "")
				}
				eq(t, fmt.Sprintf("svg %s %s %q", c.Str("name"), mode, id), got, wantResult(cases.Obj(id)))
			}
		}
	}
}

func TestGoldenDiagrams(t *testing.T) {
	g := loadGolden(t)
	docs := baseDocs(t, g)
	for i, v := range g.Arr("diagrams") {
		c := v.(*jsonv.Object)
		d := docs[c.Str("doc")]
		where := fmt.Sprintf("diagram %d %s", i, jsonv.Stringify(c.Obj("input"), ""))
		plan, err := DiagramOps(d, c.Obj("input"))
		if !c.Bool("ok") {
			if err == nil {
				t.Errorf("%s: expected error %q", where, c.Str("error"))
				continue
			}
			eq(t, where+" error", err.Error(), c.Str("error"))
			continue
		}
		if err != nil {
			t.Errorf("%s: unexpected error %v", where, err)
			continue
		}
		eq(t, where+" plan", jsonv.Stringify(plan.JSON(), ""), c.Str("plan"))
		r, aerr := ApplyOps(d, plan.Ops)
		if c.Has("applyError") {
			if aerr == nil {
				t.Errorf("%s: expected apply error %q", where, c.Str("applyError"))
			} else {
				eq(t, where+" apply error", aerr.Error(), c.Str("applyError"))
			}
			continue
		}
		if aerr != nil {
			t.Errorf("%s: apply error %v", where, aerr)
			continue
		}
		eq(t, where+" result", jsonv.Stringify(r.Doc, "  "), c.Str("result"))
	}
}

func TestGoldenShapeOutlines(t *testing.T) {
	g := loadGolden(t)
	for i, v := range g.Arr("outlines") {
		c := v.(*jsonv.Object)
		d, fold := ShapeOutline(c.Obj("n"))
		out := c.Obj("out")
		eq(t, fmt.Sprintf("outline %d d", i), d, out.Str("d"))
		eq(t, fmt.Sprintf("outline %d fold", i), fold, out.Str("fold"))
	}
}

func TestGoldenLayouts(t *testing.T) {
	g := loadGolden(t)
	if !g.Has("layouts") {
		t.Fatal("layouts fixture missing — run pnpm go:golden")
	}
	docs := map[string]string{}
	for _, view := range g.Arr("views") {
		o := view.(*jsonv.Object)
		docs[o.Str("name")] = o.Str("doc")
	}
	for _, v := range g.Arr("layouts") {
		c := v.(*jsonv.Object)
		name := c.Str("name")
		raw, ok := docs[name]
		if !ok || raw == "" {
			t.Fatalf("no view doc for layout %s", name)
		}
		d := mustDoc(t, raw)
		boxes, err := Layout(d, LayoutOptions{})
		want := c.Obj("layout")
		if !want.Bool("ok") {
			if err == nil {
				t.Errorf("layout %s: expected error %q", name, want.Str("error"))
			} else {
				eq(t, "layout err "+name, err.Error(), want.Str("error"))
			}
			continue
		}
		if err != nil {
			t.Errorf("layout %s: %v", name, err)
			continue
		}
		eq(t, "layout "+name, stringifyLayout(boxes), want.Str("value"))
		byRoot := c.Obj("byRoot")
		for _, id := range byRoot.Keys() {
			r := byRoot.Obj(id)
			boxes2, err2 := Layout(d, LayoutOptions{RootID: id})
			if !r.Bool("ok") {
				if err2 == nil {
					t.Errorf("layout %s root %s: expected error", name, id)
				} else {
					eq(t, "layout root err "+name+"/"+id, err2.Error(), r.Str("error"))
				}
				continue
			}
			if err2 != nil {
				t.Errorf("layout %s root %s: %v", name, id, err2)
				continue
			}
			eq(t, "layout root "+name+"/"+id, stringifyLayout(boxes2), r.Str("value"))
		}
	}
}

func stringifyLayout(boxes map[string]LayoutBox) string {
	gotObj := jsonv.NewObject()
	ids := make([]string, 0, len(boxes))
	for id := range boxes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		gotObj.Set(id, LayoutBoxJSON(boxes[id]))
	}
	return jsonv.Stringify(gotObj, "")
}

func TestGoldenTextMetrics(t *testing.T) {
	g := loadGolden(t)
	if !g.Has("textMetrics") {
		t.Fatal("textMetrics fixture missing — run pnpm go:golden")
	}
	for i, v := range g.Arr("textMetrics") {
		c := v.(*jsonv.Object)
		near(t, c.Num("fontAvg"), FontAvg, 1e-12)
		hasMax := c.Has("maxWidth")
		maxW := 0.0
		if hasMax {
			maxW = c.Num("maxWidth")
		}
		got := MeasureText(c.Str("text"), c.Num("fontSize"), c.Num("fontWeight"), c.Num("lineHeight"), c.Num("letterSpacing"), maxW, hasMax)
		want := c.Obj("result")
		near(t, got.Width, want.Num("width"), 1e-9)
		near(t, got.Height, want.Num("height"), 1e-9)
		if got.Lines != int(want.Num("lines")) {
			t.Errorf("textMetrics[%d] lines: got %d want %v", i, got.Lines, want.Num("lines"))
		}
	}
}

func TestGoldenPathNorm(t *testing.T) {
	g := loadGolden(t)
	if !g.Has("pathNorm") {
		t.Fatal("pathNorm fixture missing — run pnpm go:golden")
	}
	for _, v := range g.Arr("pathNorm") {
		c := v.(*jsonv.Object)
		segs, err := ParsePath(c.Str("d"))
		if err != nil {
			t.Fatal(err)
		}
		o := PathOrigin(segs)
		wantO := c.Obj("origin")
		near(t, o.X, wantO.Num("x"), 1e-9)
		near(t, o.Y, wantO.Num("y"), 1e-9)
		moved, _, b := NormalizePath(segs)
		eq(t, "pathNorm "+c.Str("d"), SerializePath(moved), c.Str("normalized"))
		wantB := c.Obj("bounds")
		near(t, b.X, wantB.Num("x"), 1e-9)
		near(t, b.Y, wantB.Num("y"), 1e-9)
		near(t, b.Width, wantB.Num("width"), 1e-9)
		near(t, b.Height, wantB.Num("height"), 1e-9)
	}
}
