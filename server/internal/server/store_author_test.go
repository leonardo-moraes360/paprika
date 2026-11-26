package server

import (
	"errors"
	"fmt"
	"math/rand"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

const authorSeed = `[
  {"op":"create","parentId":null,"node":{"type":"page","id":"pg"}},
  {"op":"create","parentId":"pg","node":{"type":"frame","id":"fr","x":0,"y":0,"width":300,"height":200}},
  {"op":"create","parentId":"fr","node":{"type":"rect","id":"r1","x":0,"y":0,"width":40,"height":30}},
  {"op":"create","parentId":"fr","node":{"type":"rect","id":"r2","x":50,"y":0,"width":40,"height":30}},
  {"op":"create","parentId":"fr","node":{"type":"rect","id":"r3","x":100,"y":0,"width":40,"height":30}}
]`

func authorStore(t *testing.T) (*Store, string) {
	t.Helper()
	s, path := openTemp(t)
	if _, err := s.Apply(parseOps(t, authorSeed), "setup", "seed"); err != nil {
		t.Fatal(err)
	}
	return s, path
}

func fill(t *testing.T, s *Store, actor, id, color string) {
	t.Helper()
	if _, err := s.Apply(parseOps(t, fmt.Sprintf(`[{"op":"update","id":"%s","props":{"fill":"%s"}}]`, id, color)), actor, "fill "+id); err != nil {
		t.Fatal(err)
	}
}

func fillOf(s *Store, id string) string { return core.GetNode(s.Doc(), id).Str("fill") }

func TestStepOwnUndoesOnlyTheHumanStepAndBumpsVersion(t *testing.T) {
	s, _ := authorStore(t)
	var events []ChangeEvent
	off := s.OnChange(func(e ChangeEvent) { events = append(events, e) })
	defer off()
	fill(t, s, "user", "r1", "#111111")
	fill(t, s, "agent:claude", "r2", "#222222")
	fill(t, s, "agent:claude", "r3", "#333333")
	v := s.Version()
	res, head, err := s.StepOwn("", "user", false)
	if err != nil || res.Result != "undone" || res.Label != "fill r1" || res.Newer != 2 {
		t.Fatalf("%+v %v", res, err)
	}
	if fillOf(s, "r1") != "" || fillOf(s, "r2") != "#222222" || fillOf(s, "r3") != "#333333" {
		t.Fatal("only the human step must be undone")
	}
	if head.Version != v+1 || s.Version() != v+1 || !head.CanRedo {
		t.Fatalf("version %d, want %d", head.Version, v+1)
	}
	last := events[len(events)-1]
	if last.Kind != "undo" || last.Actor != "user" || last.Version != v+1 || last.Base != v || last.Delta == nil {
		t.Fatalf("event %+v", last)
	}
	samePersisted(t, s, 0)
	sameHistory(t, s, 0)
	res, _, err = s.StepOwn("", "user", true)
	if err != nil || res.Result != "redone" || fillOf(s, "r1") != "#111111" {
		t.Fatalf("%+v %v", res, err)
	}
	samePersisted(t, s, 1)
	sameHistory(t, s, 1)
}

func TestStepOwnNothingToUndoAndConflictWriteNothing(t *testing.T) {
	s, _ := authorStore(t)
	fill(t, s, "agent:claude", "r2", "#222222")
	v := s.Version()
	res, _, err := s.StepOwn("", "user", false)
	if err != nil || res.Result != "nothing" || res.Actor != "agent:claude" || s.Version() != v {
		t.Fatalf("%+v %v", res, err)
	}
	fill(t, s, "user", "r1", "#111111")
	fill(t, s, "agent:claude", "r1", "#999999")
	v = s.Version()
	res, _, err = s.StepOwn("", "user", false)
	var ce *core.ConflictError
	if !errors.As(err, &ce) || res.Result != "conflict" || res.WithActor != "agent:claude" || s.Version() != v || fillOf(s, "r1") != "#999999" {
		t.Fatalf("%+v %v", res, err)
	}
	if res, _, err := s.StepAt("", "user", 424242, false); !errors.Is(err, ErrNoStep) {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestStepAtUndoesAnAgentStepAndSurvivesReopen(t *testing.T) {
	s, path := authorStore(t)
	fill(t, s, "agent:claude", "r1", "#111111")
	fill(t, s, "user", "r2", "#222222")
	panel, err := s.HistoryPanel("")
	if err != nil || len(panel.Steps) < 3 {
		t.Fatalf("%+v %v", panel, err)
	}
	agent := panel.Steps[len(panel.Steps)-2]
	if agent.Actor != "agent:claude" || len(agent.NodeIDs) != 1 || agent.NodeIDs[0] != "r1" {
		t.Fatalf("%+v", agent)
	}
	res, _, err := s.StepAt("", "user", agent.ID, false)
	if err != nil || res.Result != "undone" || fillOf(s, "r1") != "" || fillOf(s, "r2") != "#222222" {
		t.Fatalf("%+v %v", res, err)
	}
	panel, _ = s.HistoryPanel("")
	undone := panel.Steps[len(panel.Steps)-2]
	if !undone.Undone || undone.UndoneBy != "user" || undone.ID != agent.ID {
		t.Fatalf("%+v", panel.Steps)
	}
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	res, _, err = s2.StepAt("", "user", agent.ID, true)
	if err != nil || res.Result != "redone" || fillOf(s2, "r1") != "#111111" {
		t.Fatalf("after reopen %+v %v", res, err)
	}
}

func TestStepOwnInAnotherWorkspace(t *testing.T) {
	s, _ := authorStore(t)
	info, err := s.CreateWorkspace("other", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyIn(info.ID, parseOps(t, `[{"op":"create","parentId":null,"node":{"type":"page","id":"op"}}]`), "user", "page", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyIn(info.ID, parseOps(t, `[{"op":"create","parentId":null,"node":{"type":"page","id":"op2"}}]`), "agent:claude", "rename", ""); err != nil {
		t.Fatal(err)
	}
	res, head, err := s.StepOwn(info.ID, "user", false)
	if err != nil || res.Result != "undone" || res.Label != "page" || core.GetNode(head.Doc, "op") != nil || core.GetNode(head.Doc, "op2") == nil {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestPersistedHistoryWithSelectiveSteps(t *testing.T) {
	s, path := authorStore(t)
	rng := rand.New(rand.NewSource(9))
	actors := []string{"user", "agent:a", "agent:b"}
	ids := []string{"r1", "r2", "r3", "fr"}
	for i := range 700 {
		actor := actors[rng.Intn(3)]
		switch k := rng.Intn(10); {
		case k == 0:
			if _, _, err := s.StepOwn("", "user", false); err != nil {
				if _, ok := errors.AsType[*core.ConflictError](err); !ok {
					t.Fatal(err)
				}
			}
		case k == 1:
			if _, _, err := s.StepOwn("", actor, true); err != nil {
				if _, ok := errors.AsType[*core.ConflictError](err); !ok {
					t.Fatal(err)
				}
			}
		case k == 2:
			es := s.history.Entries()
			if len(es) > 0 {
				if _, _, err := s.StepAt("", "user", es[rng.Intn(len(es))].Ord, false); err != nil {
					var ce *core.ConflictError
					if !errors.As(err, &ce) {
						t.Fatal(err)
					}
				}
			}
		case k == 3:
			es := s.history.RedoEntries()
			if len(es) > 0 {
				if _, _, err := s.StepAt("", "user", es[rng.Intn(len(es))].Ord, true); err != nil {
					var ce *core.ConflictError
					if !errors.As(err, &ce) {
						t.Fatal(err)
					}
				}
			}
		default:
			s.Apply(parseOps(t, fmt.Sprintf(`[{"op":"update","id":"%s","props":{"opacity":0.%d}}]`, ids[rng.Intn(len(ids))], rng.Intn(9))), actor, fmt.Sprintf("w%d", i))
		}
		if i%5 == 0 || i > 680 {
			samePersisted(t, s, i)
			sameHistory(t, s, i)
		}
	}
	if n := len(s.history.Entries()); n > 500 {
		t.Fatalf("history over its limit: %d", n)
	}
	mem, version, _, _ := s.Snapshot()
	memUndo, memRedo := len(s.history.Entries()), len(s.history.RedoEntries())
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	disk, dv, _, _ := s2.Snapshot()
	if dv != version || docDifference(mem, disk) != "" || len(s2.history.Entries()) != memUndo || len(s2.history.RedoEntries()) != memRedo {
		t.Fatal("reopened store differs")
	}
}
