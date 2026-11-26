package core

import (
	"errors"
	"fmt"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func authorHistory(t *testing.T) *History {
	t.Helper()
	return NewHistory(baseDoc(t))
}

func mustApply(t *testing.T, h *History, actor, label string, ops ...any) {
	t.Helper()
	if _, err := h.Apply(ops, actor, label); err != nil {
		t.Fatal(err)
	}
}

func fillOf(h *History, id string) string { return GetNode(h.Doc(), id).Str("fill") }

func TestUndoOwnSkipsAgentSteps(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "theirs 1", mkUpdate("a2", "fill", "#222222"))
	mustApply(t, h, "agent:x", "theirs 2", mkUpdate("b1", "name", "n"))
	out, err := h.UndoOwn("user")
	if err != nil || !out.Done || out.Entry.Label != "mine" || out.Newer != 2 {
		t.Fatalf("out %+v err %v", out, err)
	}
	if fillOf(h, "a1") != "#ff0000" || fillOf(h, "a2") != "#222222" {
		t.Fatal("wrong nodes undone")
	}
	if len(h.Entries()) != 2 || len(h.RedoEntries()) != 1 {
		t.Fatalf("stacks %d/%d", len(h.Entries()), len(h.RedoEntries()))
	}
	again, err := h.UndoOwn("user")
	if err != nil || again.Done || again.Last.Actor != "agent:x" || again.Last.Label != "theirs 2" {
		t.Fatalf("nothing own: %+v %v", again, err)
	}
	if fillOf(h, "a2") != "#222222" {
		t.Fatal("agent step must stay")
	}
}

func TestUndoOwnTopStep(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a2", "fill", "#222222"))
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	out, err := h.UndoOwn("user")
	if err != nil || !out.Done || out.Newer != 0 {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestSelectiveUndoConflictLeavesEverythingUntouched(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a1", "fill", "#333333"))
	before := canon(t, h.Doc())
	out, err := h.UndoOwn("user")
	var ce *ConflictError
	if !errors.As(err, &ce) || out.Done {
		t.Fatalf("want conflict, got %+v %v", out, err)
	}
	if ce.With.Actor != "agent:x" || canon(t, h.Doc()) != before || len(h.Entries()) != 2 || len(h.RedoEntries()) != 0 {
		t.Fatal("conflict must not change anything")
	}
}

func TestSelectiveUndoAncestorStructure(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "style child", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "delete parent", jsonv.NewObject("op", "delete", "id", "fa"))
	var ce *ConflictError
	if _, err := h.UndoOwn("user"); !errors.As(err, &ce) {
		t.Fatalf("want conflict, got %v", err)
	}
}

func TestSelectiveUndoCreateKeepsSiblings(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkCreate("fa", "x1", "rect"))
	mustApply(t, h, "agent:x", "theirs", mkCreate("fa", "y1", "rect"))
	if out, err := h.UndoOwn("user"); err != nil || !out.Done {
		t.Fatalf("%+v %v", out, err)
	}
	if GetNode(h.Doc(), "x1") != nil || GetNode(h.Doc(), "y1") == nil {
		t.Fatal("only the user's create is undone")
	}
}

func TestSelectiveUndoDeleteAndMoveAndReparent(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "delete", jsonv.NewObject("op", "delete", "id", "a2"))
	mustApply(t, h, "agent:x", "other", mkUpdate("b1", "fill", "#444444"))
	if out, err := h.UndoOwn("user"); err != nil || !out.Done || GetNode(h.Doc(), "a2") == nil {
		t.Fatalf("delete undo: %+v %v", out, err)
	}
	mustApply(t, h, "user", "reparent", jsonv.NewObject("op", "move", "id", "a1", "parentId", "fb", "index", 0.0))
	mustApply(t, h, "agent:x", "other", mkUpdate("b2", "fill", "#555555"))
	if out, err := h.UndoOwn("user"); err != nil || !out.Done {
		t.Fatalf("reparent undo: %+v %v", out, err)
	}
	if p, _ := ParentID(GetNode(h.Doc(), "a1")); p != "fa" {
		t.Fatalf("a1 parent %s", p)
	}
	mustApply(t, h, "user", "move", mkUpdate("a1", "x", 77.0))
	mustApply(t, h, "agent:x", "same", mkUpdate("a1", "y", 5.0))
	var ce *ConflictError
	if _, err := h.UndoOwn("user"); !errors.As(err, &ce) {
		t.Fatalf("want conflict on the same node, got %v", err)
	}
}

func TestRedoOwnAndPerAuthorClear(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a2", "fill", "#222222"))
	if _, err := h.UndoOwn("user"); err != nil {
		t.Fatal(err)
	}
	mustApply(t, h, "agent:x", "more", mkUpdate("b1", "name", "q"))
	if len(h.RedoEntries()) != 1 {
		t.Fatal("another author's write keeps the redo")
	}
	out, err := h.RedoOwn("user")
	if err != nil || !out.Done || fillOf(h, "a1") != "#111111" {
		t.Fatalf("redo own: %+v %v", out, err)
	}
	if h.Entries()[len(h.Entries())-1].Label != "mine" {
		t.Fatal("redone step goes on top")
	}
	if _, err := h.UndoOwn("user"); err != nil {
		t.Fatal(err)
	}
	mustApply(t, h, "user", "new", mkUpdate("b2", "name", "w"))
	if len(h.RedoEntries()) != 0 {
		t.Fatal("own write clears own redo")
	}
	if out, _ := h.RedoOwn("user"); out.Done {
		t.Fatal("nothing to redo")
	}
}

func TestRedoBlockedByNewerStep(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a2", "fill", "#222222"))
	if _, err := h.UndoOwn("user"); err != nil {
		t.Fatal(err)
	}
	mustApply(t, h, "agent:x", "touches", mkUpdate("a1", "fill", "#999999"))
	var ce *ConflictError
	out, err := h.RedoOwn("user")
	if !errors.As(err, &ce) || out.Done || fillOf(h, "a1") != "#999999" || len(h.RedoEntries()) != 1 {
		t.Fatalf("want conflict: %+v %v", out, err)
	}
}

func TestRedoStepAndUndoStepByOrd(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "user", "mine", mkUpdate("a2", "fill", "#222222"))
	ord := h.Entries()[0].Ord
	out, err := h.UndoStep(ord, "user")
	if err != nil || !out.Done || out.Newer != 1 {
		t.Fatalf("%+v %v", out, err)
	}
	if got := h.RedoEntries()[0]; got.By != "user" || got.Actor != "agent:x" {
		t.Fatalf("redo entry %+v", got)
	}
	if _, err := h.UndoStep(9999, "user"); !errors.Is(err, ErrNoStep) {
		t.Fatalf("want ErrNoStep, got %v", err)
	}
	if out, err := h.RedoStep(ord, "user"); err != nil || !out.Done || fillOf(h, "a1") != "#111111" {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestLinearUndoRedoStillWorks(t *testing.T) {
	h := authorHistory(t)
	start := canon(t, h.Doc())
	mustApply(t, h, "agent:x", "one", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "user", "two", mkUpdate("a2", "fill", "#222222"))
	for range 2 {
		if _, ok, err := h.Undo(); err != nil || !ok {
			t.Fatal(err)
		}
	}
	if canon(t, h.Doc()) != start {
		t.Fatal("not back to start")
	}
	for range 2 {
		if _, ok, err := h.Redo(); err != nil || !ok {
			t.Fatal(err)
		}
	}
	if fillOf(h, "a1") != "#111111" || fillOf(h, "a2") != "#222222" {
		t.Fatal("redo failed")
	}
}

func TestSelectiveUndoBatchIsOneStep(t *testing.T) {
	h := authorHistory(t)
	for _, id := range []string{"n1", "n2", "n3"} {
		if _, err := h.ApplyBatch([]any{mkCreate("fa", id, "rect")}, "user", "x", "draw"); err != nil {
			t.Fatal(err)
		}
	}
	mustApply(t, h, "agent:x", "other", mkUpdate("b1", "name", "q"))
	out, err := h.UndoOwn("user")
	if err != nil || !out.Done {
		t.Fatalf("%+v %v", out, err)
	}
	for _, id := range []string{"n1", "n2", "n3"} {
		if GetNode(h.Doc(), id) != nil {
			t.Fatalf("%s still there", id)
		}
	}
	if GetNode(h.Doc(), "b1").Str("name") != "q" {
		t.Fatal("agent step lost")
	}
}

func TestSelectiveUndoAfterTrim(t *testing.T) {
	h := authorHistory(t)
	for i := range 520 {
		actor := "agent:x"
		id := "b2"
		if i%2 == 0 {
			actor, id = "user", "b1"
		}
		mustApply(t, h, actor, fmt.Sprint(i), mkUpdate(id, "name", fmt.Sprint("v", i)))
	}
	if len(h.Entries()) != 500 {
		t.Fatalf("entries %d", len(h.Entries()))
	}
	out, err := h.UndoOwn("user")
	if err != nil || !out.Done || out.Newer != 1 {
		t.Fatalf("%+v %v", out, err)
	}
	if GetNode(h.Doc(), "b1").Str("name") != "v516" {
		t.Fatalf("name %q", GetNode(h.Doc(), "b1").Str("name"))
	}
}

func TestRestoreAssignsOrdersAndFootprints(t *testing.T) {
	h := authorHistory(t)
	mustApply(t, h, "user", "mine", mkUpdate("a1", "fill", "#111111"))
	mustApply(t, h, "agent:x", "theirs", mkUpdate("a2", "fill", "#222222"))
	legacy := func(es []HistoryEntry) []HistoryEntry {
		out := make([]HistoryEntry, len(es))
		for i, e := range es {
			out[i] = HistoryEntry{Actor: e.Actor, Label: e.Label, Ops: e.Ops, Inverse: e.Inverse, At: e.At}
		}
		return out
	}
	r := Restore(h.Doc(), legacy(h.Entries()), nil)
	if es := r.Entries(); es[0].Ord == 0 || es[1].Ord <= es[0].Ord || len(es[0].Keys) == 0 {
		t.Fatalf("%+v", es)
	}
	if out, err := r.UndoOwn("user"); err != nil || !out.Done {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestLinearRedoChainOnOneNode(t *testing.T) {
	for _, actors := range [][]string{{"user", "user", "user"}, {"user", "agent:x", "user"}} {
		h := authorHistory(t)
		start := canon(t, h.Doc())
		for i, a := range actors {
			mustApply(t, h, a, fmt.Sprint(i), mkUpdate("a1", "fill", fmt.Sprintf("#00000%d", i+1)))
		}
		for range actors {
			if _, ok, err := h.UndoBy("user"); err != nil || !ok {
				t.Fatalf("undo: %v", err)
			}
		}
		if canon(t, h.Doc()) != start {
			t.Fatal("not back at the start")
		}
		for range actors {
			if _, ok, err := h.RedoBy("user"); err != nil || !ok {
				t.Fatalf("redo: %v", err)
			}
		}
		if fillOf(h, "a1") != "#000003" {
			t.Fatalf("fill %s", fillOf(h, "a1"))
		}
	}
}
