package server

import (
	"context"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func stepKinds(v HistoryView) string {
	out := ""
	for _, st := range v.Steps {
		out += st.Kind + ":" + st.Actor + ":" + st.Label + ";"
	}
	return out
}

func TestHistoryViewRecordsUndoRedoSteps(t *testing.T) {
	s, path := openTemp(t)
	createRect(t, s, "a")
	createRect(t, s, "b")
	if v, err := s.HistoryViewIn("", 20); err != nil || len(v.Steps) != 0 || len(v.Redo) != 0 || !v.CanUndo || v.CanRedo {
		t.Fatalf("fresh view: %+v %v", v, err)
	}
	if ok, err := s.Undo("user"); !ok || err != nil {
		t.Fatalf("undo: %v %v", ok, err)
	}
	if ok, err := s.Redo("agent:x"); !ok || err != nil {
		t.Fatalf("redo: %v %v", ok, err)
	}
	if ok, err := s.Undo("user"); !ok || err != nil {
		t.Fatalf("undo: %v %v", ok, err)
	}
	if ok, _ := s.Redo("user"); !ok {
		t.Fatal("redo")
	}
	if ok, _ := s.Undo("user"); !ok {
		t.Fatal("undo")
	}
	if ok, _ := s.Undo("user"); !ok {
		t.Fatal("undo a")
	}
	if ok, _ := s.Undo("user"); ok {
		t.Fatal("nothing left to undo")
	}
	v, err := s.HistoryViewIn("", 20)
	if err != nil {
		t.Fatal(err)
	}
	want := "undo:user:criar b;redo:agent:x:criar b;undo:user:criar b;redo:user:criar b;undo:user:criar b;undo:user:criar a;"
	if got := stepKinds(v); got != want {
		t.Fatalf("steps %s\nwant %s", got, want)
	}
	if v.Steps[0].At == 0 || len(v.Entries) != 0 || len(v.Redo) != 2 || v.CanUndo || !v.CanRedo {
		t.Fatalf("view %+v", v)
	}
	if v.Redo[1].Label != "criar a" || v.Redo[0].Label != "criar b" {
		t.Fatalf("redo order %+v", v.Redo)
	}
	if two, _ := s.HistoryViewIn("", 2); len(two.Steps) != 2 || two.Steps[1].Label != "criar a" || len(two.Redo) != 2 {
		t.Fatalf("limit %+v", two)
	}
	s.Close()

	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	v2, err := s2.HistoryViewIn("", 20)
	if err != nil || stepKinds(v2) != want || len(v2.Redo) != 2 {
		t.Fatalf("after reopen: %s %v", stepKinds(v2), err)
	}
}

func TestHistoryStepsOfOtherWorkspace(t *testing.T) {
	s, _ := openTemp(t)
	info, err := s.CreateWorkspace("outro", "agent:x")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyIn(info.ID, []any{obj("op", "create", "node", obj("type", "rect", "id", "z"))}, "agent:x", "criar z", ""); err != nil {
		t.Fatal(err)
	}
	if ok, _, err := s.StepIn(info.ID, "agent:y", false); !ok || err != nil {
		t.Fatalf("step: %v %v", ok, err)
	}
	v, err := s.HistoryViewIn(info.ID, 20)
	if err != nil || stepKinds(v) != "undo:agent:y:criar z;" || len(v.Redo) != 1 {
		t.Fatalf("aside view: %+v %v", v, err)
	}
	if main, _ := s.HistoryViewIn("", 20); len(main.Steps) != 0 {
		t.Fatalf("main workspace got steps: %+v", main.Steps)
	}
}

func TestGetHistoryToolShowsStepsAndRedo(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	createRect(t, s, "a")
	if _, isErr := callText(t, m, "undo", nil); isErr {
		t.Fatal("undo")
	}
	r := m.CallTool(context.Background(), "get_history", jsonv.NewObject(), true)
	sc := r.Obj("structuredContent")
	if len(sc.Arr("entries")) != 0 || len(sc.Arr("redo")) != 1 || sc.Bool("canUndo") || !sc.Bool("canRedo") {
		t.Fatalf("structured %s", jsonv.Stringify(sc, ""))
	}
	st := sc.Arr("steps")
	if len(st) != 1 {
		t.Fatalf("steps %s", jsonv.Stringify(sc, ""))
	}
	step := st[0].(*jsonv.Object)
	if step.Str("kind") != "undo" || step.Str("actor") != "agent:test" || step.Str("label") != "criar a" || step.Num("at") == 0 {
		t.Fatalf("step %s", jsonv.Stringify(step, ""))
	}
	if sc.Arr("redo")[0].(*jsonv.Object).Str("label") != "criar a" {
		t.Fatalf("redo %s", jsonv.Stringify(sc, ""))
	}
}
