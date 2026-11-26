package core

import (
	"fmt"
	"math/rand"
	"slices"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server/internal/opgen"
)

func cowSeedDoc(t *testing.T, seed string) *Document {
	t.Helper()
	v, err := jsonv.Parse([]byte(seed))
	if err != nil {
		t.Fatal(err)
	}
	r, err := ApplyOps(CreateDocument("t", "d"), v.([]any))
	if err != nil {
		t.Fatal(err)
	}
	return r.Doc
}

func checkJournal(t *testing.T, ctx string, prev, cur *Document, j *Journal) {
	t.Helper()
	if j == nil {
		return
	}
	in := map[string]bool{}
	for _, e := range j.Nodes {
		in[e.Key] = true
	}
	pn, cn := Nodes(prev), Nodes(cur)
	for _, k := range cn.Keys() {
		a, aok := pn.Get(k)
		b, _ := cn.Get(k)
		if (!aok || a != b) && !in[k] {
			t.Fatalf("%s: node %q changed but is not in the journal", ctx, k)
		}
	}
	for _, k := range pn.Keys() {
		if !cn.Has(k) && !in[k] {
			t.Fatalf("%s: node %q removed but is not in the journal", ctx, k)
		}
	}
	for _, k := range cur.Keys() {
		a, _ := prev.Get(k)
		b, _ := cur.Get(k)
		if k == "nodes" {
			continue
		}
		if !jsonv.Equal(a, b) {
			found := false
			for _, e := range j.Doc {
				found = found || e.Key == k
			}
			if !found {
				t.Fatalf("%s: document key %q changed but is not in the journal", ctx, k)
			}
		}
	}
}

func runCOWRounds(t *testing.T, seedText string, rounds, steps int, mutate func(*History)) (derived int) {
	seed := cowSeedDoc(t, seedText)
	var cowSteps, okSteps int
	for round := range rounds {
		rng := rand.New(rand.NewSource(int64(7000 + round)))
		fast, slow := NewHistory(seed), NewHistory(seed)
		slow.legacy = true
		fast.Now = func() int64 { return 1 }
		slow.Now = func() int64 { return 1 }
		serial := 0
		for step := range steps {
			if mutate != nil {
				mutate(fast)
			}
			if Nodes(fast.Doc()).Len() < 14 {
				fast.Reset(seed)
				slow.Reset(seed)
			}
			slow.settled = false
			prev := fast.Doc()
			prevStr := jsonv.Stringify(prev, "")
			prevCopy := jsonv.Clone(prev).(*jsonv.Object)
			ctx := fmt.Sprintf("round %d step %d", round, step)
			var fe, se error
			switch k := rng.Intn(14); {
			case k == 0:
				_, _, fe = fast.Undo()
				_, _, se = slow.Undo()
			case k == 1:
				_, _, fe = fast.Redo()
				_, _, se = slow.Redo()
			default:
				ops := opgen.Ops(rng, fast.Doc(), &serial)
				ctx += " ops " + jsonv.Stringify(ops, "")
				var fr, sr *ApplyResult
				if k == 2 {
					fr, fe = fast.ApplyBatch(ops, "a", "l", "b")
					sr, se = slow.ApplyBatch(ops, "a", "l", "b")
				} else {
					fr, fe = fast.Apply(ops, "a", "l")
					sr, se = slow.Apply(ops, "a", "l")
				}
				if (fe == nil) != (se == nil) || (fe != nil && fe.Error() != se.Error()) {
					t.Fatalf("%s: error differs: fast %v slow %v", ctx, fe, se)
				}
				if fe == nil {
					okSteps++
					if a, b := jsonv.Stringify(fr.Inverse, ""), jsonv.Stringify(sr.Inverse, ""); a != b {
						t.Fatalf("%s: inverse differs\nfast %s\nslow %s", ctx, a, b)
					}
					if a, b := fmt.Sprint(fr.Created), fmt.Sprint(sr.Created); a != b {
						t.Fatalf("%s: created differs %s %s", ctx, a, b)
					}
				}
			}
			if (fe == nil) != (se == nil) {
				t.Fatalf("%s: undo/redo error differs: %v %v", ctx, fe, se)
			}
			if got := jsonv.Stringify(prev, ""); got != prevStr {
				t.Fatalf("%s: previous document mutated: %s", ctx, firstDifference(prev, prevCopy))
			}
			if m := consistencyError(slow.Doc()); m != "" {
				t.Fatalf("%s: legacy document inconsistent: %s", ctx, m)
			}
			if a, b := jsonv.Stringify(fast.Doc(), ""), jsonv.Stringify(slow.Doc(), ""); a != b {
				t.Fatalf("%s: documents differ: %s", ctx, firstDifference(fast.Doc(), slow.Doc()))
			}
			if j := fast.LastJournal(); j != nil {
				cowSteps++
				checkJournal(t, ctx, prev, fast.Doc(), j)
				if fast.LastDerivedScoped() {
					derived++
				}
			}
		}
	}
	if okSteps < rounds*steps/5 {
		t.Fatalf("only %d of %d steps applied", okSteps, rounds*steps)
	}
	if cowSteps < okSteps/2 {
		t.Fatalf("only %d copy-on-write steps", cowSteps)
	}
	return derived
}

func TestCopyOnWriteMatchesDeepCloneForEveryOp(t *testing.T) {
	runCOWRounds(t, opgen.Seed, 16, 250, nil)
}

func TestScopedDerivedPassesMatchFullPassForEveryOp(t *testing.T) {
	n := runCOWRounds(t, opgen.PlainSeed(), 24, 250, nil)
	t.Logf("scoped derived passes: %d", n)
	if n < 200 {
		t.Fatalf("scoped derived passes taken only %d times", n)
	}
}

func consistencyError(doc *Document) string {
	nodes := Nodes(doc)
	for _, id := range nodes.Keys() {
		n := nodes.Obj(id)
		for _, c := range n.Strings("children") {
			cn := nodes.Obj(c)
			if cn == nil {
				return fmt.Sprintf("%q lists missing child %q", id, c)
			}
			if p, _ := cn.Get("parentId"); p != id {
				return fmt.Sprintf("child %q of %q has parentId %v", c, id, p)
			}
		}
	}
	return ""
}

func firstDifference(a, b *Document) string {
	an, bn := Nodes(a), Nodes(b)
	if !slices.Equal(an.Keys(), bn.Keys()) {
		return fmt.Sprintf("node order differs\nfast %v\nslow %v", an.Keys(), bn.Keys())
	}
	for _, k := range an.Keys() {
		if x, y := jsonv.Stringify(an.Obj(k), ""), jsonv.Stringify(bn.Obj(k), ""); x != y {
			return fmt.Sprintf("node %q\nfast %s\nslow %s", k, x, y)
		}
	}
	for _, k := range a.Keys() {
		if k == "nodes" {
			continue
		}
		x, _ := a.Get(k)
		y, _ := b.Get(k)
		if !jsonv.Equal(x, y) {
			return fmt.Sprintf("key %q: %s vs %s", k, jsonv.Stringify(x, ""), jsonv.Stringify(y, ""))
		}
	}
	return "key order of the document"
}
