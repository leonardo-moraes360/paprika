package core

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
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
		case "empty", "card", "demo", "bezier":
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
		for _, id := range Nodes(doc).Keys() {
			r, _ := ExportReact(doc, id)
			eq(t, name+" react "+id, r, c.Obj("react").Str(id))
			eq(t, name+" describe "+id, DescribeNode(GetNode(doc, id)), c.Obj("describe").Str(id))
			eq(t, name+" style "+id, CSSToString(NodeStyle(doc, GetNode(doc, id), false)), c.Obj("style").Str(id))
		}
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
	eq(t, "createDocument", jsonv.Stringify(CreateDocument("Sem título", "abc"), ""), jsonv.Stringify(g.Obj("created"), ""))
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
