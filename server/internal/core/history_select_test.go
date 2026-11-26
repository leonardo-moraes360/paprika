package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func canon(t testing.TB, d *Document) string {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(jsonv.Stringify(d, "")), &v); err != nil {
		t.Fatal(err)
	}
	if m, ok := v.(map[string]any); ok {
		if nodes, ok := m["nodes"].(map[string]any); ok {
			for _, n := range nodes {
				if nm, ok := n.(map[string]any); ok && nm["type"] == "group" {
					if name, _ := nm["name"].(string); strings.HasPrefix(name, "Grupo ") {
						delete(nm, "name")
					}
					if c, _ := nm["children"].([]any); len(c) == 0 {
						delete(nm, "width")
						delete(nm, "height")
					}
				}
			}
		}
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func mkCreate(parent any, id, typ string, extra ...any) any {
	node := jsonv.NewObject("type", typ, "id", id)
	if typ != "page" {
		node.Set("x", 0.0)
		node.Set("y", 0.0)
		node.Set("width", 40.0)
		node.Set("height", 30.0)
	}
	for i := 0; i+1 < len(extra); i += 2 {
		node.Set(extra[i].(string), extra[i+1])
	}
	return jsonv.NewObject("op", "create", "parentId", parent, "node", node)
}

func mkUpdate(id string, kv ...any) any {
	props := jsonv.NewObject()
	for i := 0; i+1 < len(kv); i += 2 {
		props.Set(kv[i].(string), kv[i+1])
	}
	return jsonv.NewObject("op", "update", "id", id, "props", props)
}

func baseDoc(t testing.TB) *Document {
	t.Helper()
	h := NewHistory(CreateDocument("T", "d"))
	ops := []any{
		mkCreate(nil, "p1", "page"),
		mkCreate("p1", "fa", "frame", "width", 400.0, "height", 300.0),
		mkCreate("p1", "fb", "frame", "width", 300.0, "height", 200.0, "layout", jsonv.NewObject("mode", "row", "gap", 8.0)),
		mkCreate("fa", "a1", "rect", "fill", "#ff0000"),
		mkCreate("fa", "a2", "rect", "fill", "#00ff00"),
		mkCreate("fa", "a3", "rect", "constraints", jsonv.NewObject("horizontal", "right", "vertical", "top")),
		mkCreate("fb", "b1", "rect"),
		mkCreate("fb", "b2", "rect"),
		mkCreate("fb", "b3", "text", "text", "hi"),
	}
	if _, err := h.Apply(ops, "setup", "setup"); err != nil {
		t.Fatal(err)
	}
	return h.Doc()
}

type genStep struct {
	ops   []any
	actor string
}

func randomStep(rng *rand.Rand, h *History, n int) genStep {
	ids := Nodes(h.Doc()).Keys()
	pick := func() string { return ids[rng.Intn(len(ids))] }
	if len(ids) == 0 {
		return genStep{[]any{mkCreate(nil, fmt.Sprintf("p%d", n), "page")}, "user"}
	}
	var containers []string
	for _, id := range ids {
		if IsContainer(GetNode(h.Doc(), id).Str("type")) {
			containers = append(containers, id)
		}
	}
	cont := func() string {
		if len(containers) == 0 {
			return pick()
		}
		return containers[rng.Intn(len(containers))]
	}
	actor := []string{"user", "agent:a", "agent:b"}[rng.Intn(3)]
	var ops []any
	switch rng.Intn(11) {
	case 0, 1:
		ops = []any{mkUpdate(pick(), "fill", fmt.Sprintf("#%06x", rng.Intn(0xffffff)))}
	case 2:
		ops = []any{mkUpdate(pick(), "name", fmt.Sprintf("n%d", n))}
	case 3:
		ops = []any{mkUpdate(pick(), "x", float64(rng.Intn(200)), "y", float64(rng.Intn(200)))}
	case 4:
		ops = []any{mkUpdate(pick(), "width", float64(10+rng.Intn(200)))}
	case 5:
		ops = []any{mkCreate(cont(), fmt.Sprintf("c%d", n), "rect")}
	case 6:
		op := mkCreate(cont(), fmt.Sprintf("c%d", n), "frame", "layout", jsonv.NewObject("mode", "column"))
		op.(*jsonv.Object).Set("index", 0.0)
		ops = []any{op}
	case 7:
		ops = []any{jsonv.NewObject("op", "delete", "id", pick())}
	case 8:
		ops = []any{jsonv.NewObject("op", "move", "id", pick(), "parentId", cont(), "index", float64(rng.Intn(3)))}
	case 9:
		ops = []any{jsonv.NewObject("op", "group", "ids", []any{pick(), pick()}, "id", fmt.Sprintf("g%d", n))}
	case 10:
		ops = []any{mkUpdate(pick(), "index", "front")}
	}
	return genStep{ops, actor}
}

func TestSelectiveUndoDifferential(t *testing.T) {
	base := baseDoc(t)
	safe, conflicts, replayFail := 0, 0, 0
	for seed := range 400 {
		rng := rand.New(rand.NewSource(int64(seed)))
		h := NewHistory(base)
		var steps []genStep
		for n := range 12 {
			st := randomStep(rng, h, n)
			if _, err := h.Apply(st.ops, st.actor, fmt.Sprintf("s%d", n)); err != nil {
				continue
			}
			steps = append(steps, st)
		}
		if len(steps) == 0 {
			continue
		}
		entries := h.Entries()
		for k := range steps {
			h1 := NewHistory(base)
			for i, st := range steps {
				if _, err := h1.Apply(st.ops, st.actor, fmt.Sprintf("s%d", i)); err != nil {
					t.Fatalf("seed %d: replay %v", seed, err)
				}
			}
			beforeUndo := canon(t, h1.Doc())
			out, err := h1.UndoStep(entries[k].Ord, "user")
			var ce *ConflictError
			if errors.As(err, &ce) {
				conflicts++
				continue
			}
			if err != nil {
				t.Fatalf("seed %d k %d: %v", seed, k, err)
			}
			if !out.Done {
				t.Fatalf("seed %d k %d: not done", seed, k)
			}
			doc1 := canon(t, h1.Doc())
			if _, err := h1.RedoStep(entries[k].Ord, "user"); err != nil {
				t.Fatalf("seed %d k %d: redo %v", seed, k, err)
			}
			if got := canon(t, h1.Doc()); got != beforeUndo {
				t.Fatalf("seed %d k %d: undo then redo differs\nwas %s\ngot %s", seed, k, beforeUndo, got)
			}
			h2 := NewHistory(base)
			failed := false
			for i, st := range steps {
				if i == k {
					continue
				}
				if _, err := h2.Apply(st.ops, st.actor, ""); err != nil {
					failed = true
					break
				}
			}
			if failed {
				replayFail++
				t.Errorf("seed %d k %d: declared safe but replay without the step fails; ops %s", seed, k, jsonv.Stringify(steps[k].ops, ""))
				continue
			}
			safe++
			if a, b := doc1, canon(t, h2.Doc()); a != b {
				t.Fatalf("seed %d k %d (%s): selective undo differs from replay\nops %s\nlater %s\nundo   %s\nreplay %s", seed, k, steps[k].actor, jsonv.Stringify(steps[k].ops, ""), jsonv.Stringify(func() []any {
					var l []any
					for _, s := range steps[k+1:] {
						l = append(l, s.ops...)
					}
					return l
				}(), ""), a, b)
			}
		}
	}
	t.Logf("safe=%d conflicts=%d replayFail=%d", safe, conflicts, replayFail)
	if safe < 200 {
		t.Fatalf("too few safe cases: %d", safe)
	}
}
