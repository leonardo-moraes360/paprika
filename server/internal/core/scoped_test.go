package core

import (
	"fmt"
	"math/rand"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const scopedSeed = `[
	{"op":"create","node":{"type":"page","id":"pg","name":"P"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"card","width":300,"height":200,"layout":{"mode":"column","gap":8,"padding":10},"radius":"$r","children":[
		{"type":"text","id":"t1","text":"Hello","fontSize":14},
		{"type":"rect","id":"r1","width":40,"height":20,"fill":"#ff0000","radius":4},
		{"type":"frame","id":"inner","width":"hug","height":"hug","layout":{"mode":"row","gap":4},"children":[
			{"type":"ellipse","id":"e1","width":10,"height":10},
			{"type":"text","id":"t2","text":"x"}
		]}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"group","id":"g1","children":[
		{"type":"rect","id":"ga","x":0,"y":0,"width":20,"height":20},
		{"type":"rect","id":"gb","x":30,"y":10,"width":20,"height":20}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"connector","id":"c1","from":{"nodeId":"ga"},"to":{"nodeId":"r1"}}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"btn","component":true,"x":400,"width":120,"height":40,"layout":{"mode":"row","gap":4,"padding":4},"componentProps":[{"name":"label","type":"text","default":"OK"}],"children":[
		{"type":"text","id":"lbl","text":"OK","bind":{"text":"label"}},
		{"type":"frame","id":"icon","slot":"icon","width":16,"height":16}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"rect","id":"gem","x":600,"width":16,"height":16,"fill":"#00ff00"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i1","instanceOf":"btn","x":400,"y":100,"slots":{"icon":["gem"]}}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i2","instanceOf":"btn","x":400,"y":200}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"outerc","component":true,"x":700,"width":300,"height":100,"children":[
		{"type":"frame","id":"nest","instanceOf":"btn","x":0,"y":0}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"o1","instanceOf":"outerc","x":700,"y":300}}
]`

func scopedSeedDoc(t *testing.T) *Document {
	t.Helper()
	v, err := jsonv.Parse([]byte(scopedSeed))
	if err != nil {
		t.Fatal(err)
	}
	doc := CreateDocument("t", "d")
	r, err := ApplyOps(doc, []any{jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject("r", 6.0))})
	if err == nil {
		doc = r.Doc
	}
	r, err = ApplyOps(doc, v.([]any))
	if err != nil {
		t.Fatal(err)
	}
	return r.Doc
}

func randomScopedOps(rng *rand.Rand, ids []string) []any {
	props := []func() (string, any){
		func() (string, any) { return "opacity", float64(rng.Intn(11)) / 10 },
		func() (string, any) { return "opacity", 2.0 },
		func() (string, any) {
			return "fill", []string{"#112233", "#abcdef", "$missing", "nope", "$r"}[rng.Intn(5)]
		},
		func() (string, any) { return "radius", []any{3.0, "$r", "$nope", -1.0, 8.0}[rng.Intn(5)] },
		func() (string, any) { return "name", fmt.Sprintf("n%d", rng.Intn(5)) },
		func() (string, any) { return "locked", rng.Intn(2) == 0 },
		func() (string, any) {
			return "stroke", jsonv.NewObject("color", "#000000", "width", float64(1+rng.Intn(3)))
		},
		func() (string, any) { return "color", []string{"#010203", "$bad"}[rng.Intn(2)] },
		func() (string, any) {
			return "shadow", jsonv.NewObject("x", 1.0, "y", 2.0, "blur", float64(rng.Intn(5)), "color", "#00000040")
		},
		func() (string, any) { return "x", float64(rng.Intn(50)) },
		func() (string, any) { return "width", float64(10 + rng.Intn(50)) },
		func() (string, any) { return "visible", rng.Intn(2) == 0 },
		func() (string, any) { return "text", fmt.Sprintf("T%d", rng.Intn(9)) },
		func() (string, any) { return "notes", "n" },
		func() (string, any) { return "bogus", 1.0 },
	}
	safe := rng.Intn(10) < 7
	limit := len(props)
	if safe {
		limit = 9
		ids = []string{"card", "t1", "r1", "inner", "e1", "t2", "ga"}
	}
	n := 1 + rng.Intn(3)
	ops := make([]any, n)
	for i := range ops {
		pr := jsonv.NewObject()
		for range 1 + rng.Intn(2) {
			k, v := props[rng.Intn(limit)]()
			pr.Set(k, v)
		}
		id := ids[rng.Intn(len(ids))]
		ops[i] = jsonv.NewObject("op", "update", "id", id, "props", pr)
	}
	return ops
}

func TestScopedMatchesFullPass(t *testing.T) {
	seed := scopedSeedDoc(t)
	ids := append([]string(nil), Nodes(seed).Keys()...)
	ids = append(ids, "missing")
	for round := range 6 {
		rng := rand.New(rand.NewSource(int64(round + 1)))
		fast := NewHistory(seed)
		slow := NewHistory(seed)
		fast.Now = func() int64 { return 1 }
		slow.Now = func() int64 { return 1 }
		scoped, steps := 0, 0
		for step := range 400 {
			slow.settled = false
			prev := fast.Doc()
			prevStr := jsonv.Stringify(prev, "")
			var fe, se error
			var fr, sr *ApplyResult
			switch k := rng.Intn(10); {
			case k == 0:
				_, _, fe = fast.Undo()
				_, _, se = slow.Undo()
			case k == 1:
				_, _, fe = fast.Redo()
				_, _, se = slow.Redo()
			default:
				ops := randomScopedOps(rng, ids)
				fr, fe = fast.Apply(ops, "a", "l")
				sr, se = slow.Apply(ops, "a", "l")
				if (fe == nil) != (se == nil) || (fe != nil && fe.Error() != se.Error()) {
					t.Fatalf("round %d step %d: error differs: fast %v slow %v ops %s", round, step, fe, se, jsonv.Stringify(ops, ""))
				}
				if fe == nil {
					if a, b := jsonv.Stringify(fr.Inverse, ""), jsonv.Stringify(sr.Inverse, ""); a != b {
						t.Fatalf("round %d step %d: inverse differs\nfast %s\nslow %s", round, step, a, b)
					}
					if len(fr.Created) != len(sr.Created) {
						t.Fatalf("created differs")
					}
				}
			}
			if (fe == nil) != (se == nil) {
				t.Fatalf("round %d step %d: undo/redo error differs: %v %v", round, step, fe, se)
			}
			if got := jsonv.Stringify(prev, ""); got != prevStr {
				t.Fatalf("round %d step %d: previous document mutated", round, step)
			}
			if a, b := jsonv.Stringify(fast.Doc(), ""), jsonv.Stringify(slow.Doc(), ""); a != b {
				t.Fatalf("round %d step %d: documents differ\nfast %s\nslow %s", round, step, a, b)
			}
			steps++
			if _, ok := fast.LastTouched(); ok {
				scoped++
			}
		}
		if scoped < 50 {
			t.Fatalf("round %d: scoped path taken only %d of %d steps", round, scoped, steps)
		}
	}
}

func TestScopedFallsBackOutsidePaintProps(t *testing.T) {
	h := NewHistory(scopedSeedDoc(t))
	op := func(id, k string, v any) []any {
		return []any{jsonv.NewObject("op", "update", "id", id, "props", jsonv.NewObject(k, v))}
	}
	if _, err := h.Apply(op("r1", "opacity", 0.5), "a", "l"); err != nil {
		t.Fatal(err)
	}
	if _, ok := h.LastTouched(); ok {
		t.Fatal("first write after load must take the full path")
	}
	cases := []struct {
		id, k string
		v     any
		want  bool
	}{
		{"r1", "opacity", 0.4, true},
		{"r1", "width", 50.0, false},
		{"t1", "text", "bye", false},
		{"i1", "opacity", 0.4, false},
		{"btn", "opacity", 0.4, false},
		{"lbl", "opacity", 0.4, false},
		{"gem", "opacity", 0.4, false},
		{"c1", "opacity", 0.4, false},
		{"g1", "opacity", 0.4, false},
		{"pg", "fill", "#ffffff", false},
	}
	for _, c := range cases {
		h.Apply(op(c.id, c.k, c.v), "a", "l")
		if _, ok := h.LastTouched(); ok != c.want {
			t.Fatalf("%s.%s scoped=%v want %v", c.id, c.k, ok, c.want)
		}
	}
}

func randomWideOps(rng *rand.Rand, doc *Document, serial *int) []any {
	keys := Nodes(doc).Keys()
	pick := func() string { return keys[rng.Intn(len(keys))] }
	one := func() any {
		switch rng.Intn(12) {
		case 0:
			*serial++
			return jsonv.NewObject("op", "create", "parentId", pick(), "node", jsonv.NewObject("type", "rect", "id", fmt.Sprintf("w%d", *serial), "width", 12.0, "height", 12.0))
		case 1:
			return jsonv.NewObject("op", "delete", "id", pick())
		case 2:
			return jsonv.NewObject("op", "move", "id", pick(), "parentId", pick())
		case 3:
			return jsonv.NewObject("op", "update", "id", pick(), "props", jsonv.NewObject("text", fmt.Sprintf("t%d", rng.Intn(5))))
		case 4:
			return jsonv.NewObject("op", "update", "id", pick(), "props", jsonv.NewObject("width", float64(20+rng.Intn(60))))
		case 5:
			return jsonv.NewObject("op", "update", "id", pick(), "props", jsonv.NewObject("fill", []string{"#111111", "#222222", "#333333"}[rng.Intn(3)]))
		case 6:
			return jsonv.NewObject("op", "update", "id", []string{"i1", "i2", "o1"}[rng.Intn(3)], "props", jsonv.NewObject("propValues", jsonv.NewObject("label", fmt.Sprintf("L%d", rng.Intn(4)))))
		case 7:
			return jsonv.NewObject("op", "update", "id", []string{"i1", "i2", "o1"}[rng.Intn(3)], "props", jsonv.NewObject("scale", []float64{1, 1.5, 2}[rng.Intn(3)]))
		case 8:
			return jsonv.NewObject("op", "update", "id", []string{"i1", "i2"}[rng.Intn(2)], "props", jsonv.NewObject("slots", jsonv.NewObject("icon", []any{[]string{"gem", "r1", "ga"}[rng.Intn(3)]})))
		case 9:
			return jsonv.NewObject("op", "update", "id", pick(), "props", jsonv.NewObject("visible", rng.Intn(2) == 0))
		case 10:
			return jsonv.NewObject("op", "detach", "ids", []any{[]string{"i1", "i2", "o1"}[rng.Intn(3)]})
		default:
			return jsonv.NewObject("op", "update", "id", pick(), "props", jsonv.NewObject("opacity", float64(rng.Intn(10))/10))
		}
	}
	ops := make([]any, 1+rng.Intn(3))
	for i := range ops {
		ops[i] = one()
	}
	return ops
}

func TestIncrementalInstanceSyncMatchesFullRebuild(t *testing.T) {
	seed := scopedSeedDoc(t)
	for round := range 12 {
		rng := rand.New(rand.NewSource(int64(100 + round)))
		fast, slow := NewHistory(seed), NewHistory(seed)
		fast.Now = func() int64 { return 1 }
		slow.Now = func() int64 { return 1 }
		serial, applied := 0, 0
		lastOps := ""
		for step := range 300 {
			slow.settled = false
			if Nodes(fast.Doc()).Len() < 12 {
				fast.Reset(seed)
				slow.Reset(seed)
			}
			var fe, se error
			switch k := rng.Intn(12); {
			case k == 0:
				_, _, fe = fast.Undo()
				_, _, se = slow.Undo()
			case k == 1:
				_, _, fe = fast.Redo()
				_, _, se = slow.Redo()
			default:
				ops := randomWideOps(rng, fast.Doc(), &serial)
				lastOps = jsonv.Stringify(ops, "")
				_, fe = fast.Apply(ops, "a", "l")
				_, se = slow.Apply(ops, "a", "l")
				if fe == nil {
					applied++
				}
				if (fe == nil) != (se == nil) || (fe != nil && fe.Error() != se.Error()) {
					t.Fatalf("round %d step %d: error differs: fast %v slow %v ops %s", round, step, fe, se, jsonv.Stringify(ops, ""))
				}
			}
			if (fe == nil) != (se == nil) {
				t.Fatalf("round %d step %d: undo/redo error differs: %v %v", round, step, fe, se)
			}
			if a, b := jsonv.Stringify(fast.Doc(), ""), jsonv.Stringify(slow.Doc(), ""); a != b {
				t.Fatalf("round %d step %d: documents differ (last ops %s)\nfast keys %v\nslow keys %v", round, step, lastOps, Nodes(fast.Doc()).Keys(), Nodes(slow.Doc()).Keys())
			}
		}
		if applied < 60 {
			t.Fatalf("round %d: only %d ops applied", round, applied)
		}
	}
}
