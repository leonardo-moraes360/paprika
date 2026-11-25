package core

import (
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

// Same rules as the TS History batch test (packages/core/test/core.test.ts).
func TestHistoryBatch(t *testing.T) {
	h := NewHistory(CreateDocument("T", "d"))
	start := jsonv.Stringify(h.Doc(), "")
	create := func(id string) []any {
		return []any{jsonv.NewObject("op", "create", "parentId", nil, "node", jsonv.NewObject("type", "rect", "id", id))}
	}
	for _, id := range []string{"a", "b", "c"} {
		if _, err := h.ApplyBatch(create(id), "agent:a", "step", "draw"); err != nil {
			t.Fatal(err)
		}
	}
	merged := jsonv.Stringify(h.Doc(), "")
	if e := h.Entries(); len(e) != 1 || e[0].Label != "draw" || len(e[0].Ops) != 3 {
		t.Fatalf("entries: %+v", e)
	}
	if _, err := h.ApplyBatch(create("d"), "agent:b", "", "draw"); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ApplyBatch(create("e"), "agent:a", "", "draw"); err != nil {
		t.Fatal(err)
	}
	if n := len(h.Entries()); n != 3 {
		t.Fatalf("entries after other actor: %d", n)
	}
	for range 2 {
		if _, _, err := h.Undo(); err != nil {
			t.Fatal(err)
		}
	}
	if got := jsonv.Stringify(h.Doc(), ""); got != merged {
		t.Fatalf("after 2 undos: %s", got)
	}
	if _, _, err := h.Undo(); err != nil {
		t.Fatal(err)
	}
	if got := jsonv.Stringify(h.Doc(), ""); got != start {
		t.Fatalf("batch not undone whole: %s", got)
	}
	if _, _, err := h.Redo(); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ApplyBatch(create("f"), "agent:a", "", "draw"); err != nil {
		t.Fatal(err)
	}
	if n := len(h.Entries()); n != 2 {
		t.Fatalf("batch reopened after redo: %d entries", n)
	}
}
