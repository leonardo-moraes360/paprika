package server

import (
	"fmt"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type worstCase struct {
	raw        []byte
	heavyPage  string
	textID     string
	masterText string
	instance   string
	pages      []string
	nodeCount  int
}

func buildWorstCase(totalNodes, heavyNodes, pages, instanceTarget int) worstCase {
	nodes := jsonv.NewObject()
	seq := 0
	nid := func(p string) string {
		s := p + strconv.FormatInt(int64(seq), 36)
		seq++
		return s
	}
	seed := uint32(20261125)
	rnd := func() float64 {
		seed += 0x6d2b79f5
		t := seed
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return float64(t^(t>>14)) / 4294967296
	}
	palette := []string{"#c43d27", "#2563eb", "#059669", "#7c3aed", "#d97706", "#0891b2"}
	pick := func() string { return palette[int(rnd()*float64(len(palette)))] }
	add := func(n *jsonv.Object) *jsonv.Object {
		nodes.Set(n.Str("id"), n)
		return n
	}
	link := func(parent, child *jsonv.Object) *jsonv.Object {
		child.Set("parentId", parent.Str("id"))
		ch, _ := parent.Get("children")
		parent.Set("children", append(ch.([]any), child.Str("id")))
		return child
	}
	extra := func(n *jsonv.Object, kv ...any) *jsonv.Object {
		for i := 0; i+1 < len(kv); i += 2 {
			n.Set(kv[i].(string), kv[i+1])
		}
		return n
	}
	frame := func(name string, kv ...any) *jsonv.Object {
		n := jsonv.NewObject("id", nid("f"), "type", "frame", "name", name, "parentId", nil, "x", 0.0, "y", 0.0, "width", "hug", "height", "hug", "children", []any{}, "clip", false)
		return add(extra(n, kv...))
	}
	var textID string
	text := func(v string, kv ...any) *jsonv.Object {
		n := jsonv.NewObject("id", nid("t"), "type", "text", "name", "label", "parentId", nil, "text", v, "fontSize", 14.0, "color", "#1d1a1f", "width", "hug", "height", "hug")
		if textID == "" {
			textID = n.Str("id")
		}
		return add(extra(n, kv...))
	}
	rect := func(w, h float64, fill string) *jsonv.Object {
		return add(jsonv.NewObject("id", nid("r"), "type", "rect", "name", "swatch", "parentId", nil, "width", w, "height", h, "fill", fill, "radius", 4.0))
	}
	ellipse := func(d float64, fill string) *jsonv.Object {
		return add(jsonv.NewObject("id", nid("e"), "type", "ellipse", "name", "dot", "parentId", nil, "width", d, "height", d, "fill", fill))
	}
	path := func(color string) *jsonv.Object {
		return add(jsonv.NewObject("id", nid("p"), "type", "path", "name", "icon", "parentId", nil, "width", 24.0, "height", 24.0,
			"d", "M2 12 L12 2 L22 12 L12 22 Z M7 12 L12 7 L17 12 L12 17 Z", "viewBox", []any{0.0, 0.0, 24.0, 24.0},
			"stroke", jsonv.NewObject("color", color, "width", 2.0), "fill", "#ffffff"))
	}
	component := frame("Chip", "component", true, "fill", "#ffffff", "radius", 8.0,
		"stroke", jsonv.NewObject("color", "#e6e0da", "width", 1.0),
		"layout", jsonv.NewObject("mode", "row", "gap", 6.0, "padding", []any{4.0, 8.0}, "align", "center"))
	link(component, ellipse(8, "#c43d27"))
	link(component, text("Chip", "fontSize", 12.0))
	link(component, path("#6b6470"))
	masterText := textID
	textID = ""
	counted := 0
	instances := 0
	var firstInstance string
	instance := func() *jsonv.Object {
		instances++
		counted++
		n := add(jsonv.NewObject("id", nid("i"), "type", "frame", "name", "Chip", "parentId", nil, "instanceOf", component.Str("id"), "width", "hug", "height", "hug", "children", []any{}))
		if firstInstance == "" {
			firstInstance = n.Str("id")
		}
		return n
	}
	row := func(withInstance bool) *jsonv.Object {
		r := frame("row", "fill", "#ffffff", "radius", 6.0, "stroke", jsonv.NewObject("color", "#e6e0da", "width", 1.0),
			"layout", jsonv.NewObject("mode", "row", "gap", 8.0, "padding", []any{6.0, 10.0}, "align", "center"))
		link(r, rect(16, 16, pick()))
		link(r, text(fmt.Sprintf("Item %d lorem ipsum dolor sit amet", seq)))
		counted += 3
		if withInstance {
			link(r, instance())
		}
		return r
	}
	card := func(withInstances int) *jsonv.Object {
		c := frame("card", "width", 320.0, "fill", "#fbf8f4", "radius", 12.0,
			"stroke", jsonv.NewObject("color", pick(), "width", 2.0, "position", "inside"),
			"layout", jsonv.NewObject("mode", "column", "gap", 10.0, "padding", 16.0))
		header := link(c, frame("header", "layout", jsonv.NewObject("mode", "row", "gap", 8.0, "align", "center")))
		link(header, ellipse(20, pick()))
		link(header, text(fmt.Sprintf("Card %d", seq), "fontSize", 18.0, "fontWeight", 600.0))
		link(header, path(pick()))
		counted += 5
		body := link(c, frame("body", "layout", jsonv.NewObject("mode", "column", "gap", 6.0)))
		counted++
		for i := 0; i < 6; i++ {
			link(body, row(i < withInstances))
		}
		link(c, text("Footer note with a longer sentence to wrap inside the card width", "fontSize", 12.0, "color", "#6b6470", "width", "fill"))
		counted++
		return c
	}
	perPage := []int{heavyNodes}
	rest := totalNodes - heavyNodes - 40
	for i := 1; i < pages; i++ {
		perPage = append(perPage, (rest+(pages-1)/2)/(pages-1))
	}
	sum := 0
	for _, n := range perPage {
		sum += n
	}
	var rootIDs []any
	var pageIDs []string
	heavy := ""
	for p := 0; p < pages; p++ {
		pg := add(jsonv.NewObject("id", nid("pg"), "type", "page", "name", fmt.Sprintf("Page %d", p+1), "parentId", nil, "children", []any{}))
		rootIDs = append(rootIDs, pg.Str("id"))
		pageIDs = append(pageIDs, pg.Str("id"))
		if p == 0 {
			heavy = pg.Str("id")
		}
		start := counted
		remaining := instanceTarget * perPage[p] / sum
		if p == pages-1 {
			remaining = instanceTarget - instances
		}
		remaining = min(remaining, instanceTarget-instances)
		i := 0
		if p == 1 {
			link(pg, component)
			component.Set("x", -400.0)
			counted += 4
		}
		for counted-start < perPage[p] {
			w := min(6, remaining)
			remaining -= w
			c := link(pg, card(w))
			c.Set("x", float64(i%10*380))
			c.Set("y", float64(i/10*700))
			i++
		}
	}
	doc := jsonv.NewObject("format", "paprika/1", "id", "perfworst1", "name", "Perf worst case", "tokens", jsonv.NewObject(), "rootIds", rootIDs, "nodes", nodes)
	return worstCase{raw: []byte(jsonv.Stringify(doc, "")), heavyPage: heavy, textID: textID, masterText: masterText, instance: firstInstance, pages: pageIDs, nodeCount: nodes.Len()}
}

func openWorst(b testing.TB, wc worstCase) *Store {
	path := filepath.Join(b.TempDir(), "w.db")
	db, err := OpenDB(path)
	if err != nil {
		b.Fatal(err)
	}
	if _, err := ImportDocument(db, wc.raw, false); err != nil {
		b.Fatal(err)
	}
	db.Close()
	s, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		b.Fatal(err)
	}
	warm := parseOp(b, fmt.Sprintf(`{"op":"update","id":"%s","props":{"fontSize":9}}`, wc.textID))
	if _, err := s.Apply([]any{warm}, "agent:bench", "warm"); err != nil {
		b.Fatal(err)
	}
	for i := 0; i < warmHistory; i++ {
		op := parseOp(b, fmt.Sprintf(`{"op":"update","id":"%s","props":{"opacity":%v}}`, wc.textID, 0.2+float64(i%5)/10))
		if _, err := s.Apply([]any{op}, "agent:bench", "warm"); err != nil {
			b.Fatal(err)
		}
	}
	return s
}

const warmHistory = 520

func parseOp(b testing.TB, s string) any {
	op, err := jsonv.Parse([]byte(s))
	if err != nil {
		b.Fatal(err)
	}
	return op
}

func frameOps(b testing.TB, parent, prefix string, n int) []any {
	ops := []any{parseOp(b, fmt.Sprintf(`{"op":"create","parentId":"%s","node":{"type":"frame","id":"%s","name":"bench","width":200,"height":200}}`, parent, prefix))}
	for i := 1; i < n; i++ {
		ops = append(ops, parseOp(b, fmt.Sprintf(`{"op":"create","parentId":"%s","node":{"type":"rect","id":"%s%d","name":"r","width":10,"height":10,"x":%d,"y":0}}`, prefix, prefix, i, i)))
	}
	return ops
}

func BenchmarkWorstCase(b *testing.B) {
	wc := buildWorstCase(15000, 3500, 7, 1000)
	b.Run("update_one_prop", func(b *testing.B) {
		s := openWorst(b, wc)
		defer s.Close()
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			op := parseOp(b, fmt.Sprintf(`{"op":"update","id":"%s","props":{"opacity":%v}}`, wc.textID, 0.1+float64(i%8)/10))
			if _, err := s.Apply([]any{op}, "agent:bench", "w"); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("create_200", func(b *testing.B) {
		s := openWorst(b, wc)
		defer s.Close()
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			ops := frameOps(b, wc.pages[2], fmt.Sprintf("cf%d_", i), 200)
			b.StartTimer()
			if _, err := s.Apply(ops, "agent:bench", "c"); err != nil {
				b.Fatal(err)
			}
			b.StopTimer()
			del := parseOp(b, fmt.Sprintf(`{"op":"delete","id":"cf%d_"}`, i))
			if _, err := s.Apply([]any{del}, "agent:bench", "d"); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("delete_200_frame", func(b *testing.B) {
		s := openWorst(b, wc)
		defer s.Close()
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			ops := frameOps(b, wc.pages[2], fmt.Sprintf("df%d_", i), 200)
			if _, err := s.Apply(ops, "agent:bench", "c"); err != nil {
				b.Fatal(err)
			}
			del := parseOp(b, fmt.Sprintf(`{"op":"delete","id":"df%d_"}`, i))
			b.StartTimer()
			if _, err := s.Apply([]any{del}, "agent:bench", "d"); err != nil {
				b.Fatal(err)
			}
			b.StopTimer()
		}
	})
	b.Run("update_instance_master", func(b *testing.B) {
		s := openWorst(b, wc)
		defer s.Close()
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			op := parseOp(b, fmt.Sprintf(`{"op":"update","id":"%s","props":{"opacity":%v}}`, wc.masterText, 0.1+float64(i%8)/10))
			if _, err := s.Apply([]any{op}, "agent:bench", "w"); err != nil {
				b.Fatal(err)
			}
		}
	})
}
