package server

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const persistSeed = `[
	{"op":"set_tokens","tokens":{"r":6}},
	{"op":"create","node":{"type":"page","id":"pg","name":"P"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"card","width":300,"height":200,"layout":{"mode":"column","gap":8,"padding":10},"children":[
		{"type":"text","id":"t1","text":"Hello"},
		{"type":"rect","id":"r1","width":40,"height":20,"fill":"#ff0000"},
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
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"btn","component":true,"x":400,"width":120,"height":40,"layout":{"mode":"row","gap":4,"padding":4},"children":[
		{"type":"text","id":"lbl","text":"OK"},
		{"type":"frame","id":"icon","slot":"icon","width":16,"height":16}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"rect","id":"gem","x":600,"width":16,"height":16}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i1","instanceOf":"btn","x":400,"y":100,"slots":{"icon":["gem"]}}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i2","instanceOf":"btn","x":400,"y":200}}
]`

func samePersisted(t *testing.T, s *Store, step int) {
	t.Helper()
	mem, version, _, _ := s.Snapshot()
	disk, dv, err := LoadDocument(s.db, s.DocID())
	if err != nil {
		t.Fatalf("step %d: load: %v", step, err)
	}
	if dv != version {
		t.Fatalf("step %d: disk version %d, memory %d", step, dv, version)
	}
	if a, b := jsonv.Stringify(mem, ""), jsonv.Stringify(disk, ""); a != b {
		t.Fatalf("step %d: SQLite differs from memory\nmemory %.400s\ndisk   %.400s", step, a, b)
	}
}

func TestPersistedDocumentMatchesMemoryAfterRandomOps(t *testing.T) {
	path := filepath.Join(t.TempDir(), "p.db")
	s, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply(parseOps(t, persistSeed), "user", "seed"); err != nil {
		t.Fatal(err)
	}
	rng := rand.New(rand.NewSource(11))
	ids := []string{"card", "t1", "r1", "inner", "e1", "t2", "g1", "ga", "gb", "c1", "btn", "lbl", "icon", "gem", "i1", "i2", "pg"}
	next := 0
	pick := func() string { return ids[rng.Intn(len(ids))] }
	scopedSteps := 0
	off := s.OnChange(func(e ChangeEvent) {})
	defer off()
	for i := range 500 {
		var ops string
		switch rng.Intn(12) {
		case 0, 1, 2, 3:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"opacity":%v,"name":"v%d"}}]`, pick(), float64(rng.Intn(10))/10, i)
		case 4:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"fill":"#%06x","radius":%d}}]`, pick(), rng.Intn(1<<24), rng.Intn(9))
		case 5:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"x":%d,"width":%d}}]`, pick(), rng.Intn(100), 10+rng.Intn(80))
		case 6:
			next++
			id := fmt.Sprintf("n%d", next)
			if _, err := s.Apply(parseOps(t, fmt.Sprintf(`[{"op":"create","parentId":"%s","node":{"type":"rect","id":"%s"}}]`, []string{"card", "pg", "inner"}[rng.Intn(3)], id)), "user", "c"); err == nil {
				ids = append(ids, id)
			}
			samePersisted(t, s, i)
			continue
		case 7:
			id := pick()
			if _, err := s.Apply(parseOps(t, fmt.Sprintf(`[{"op":"delete","id":"%s"}]`, id)), "user", "d"); err == nil {
				ids = slicesDelete(ids, id)
			}
			samePersisted(t, s, i)
			continue
		case 8:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"text":"w%d"}}]`, pick(), i)
		case 9:
			if _, err := s.Undo("user"); err != nil {
				t.Fatal(err)
			}
			samePersisted(t, s, i)
			continue
		case 10:
			if _, err := s.Redo("user"); err != nil {
				t.Fatal(err)
			}
			samePersisted(t, s, i)
			continue
		default:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"opacity":0.%d}},{"op":"update","id":"%s","props":{"stroke":{"color":"#000000","width":%d}}}]`, pick(), rng.Intn(9), pick(), 1+rng.Intn(3))
		}
		_, _ = s.Apply(parseOps(t, ops), "user", "x")
		if _, ok := s.history.LastTouched(); ok {
			scopedSteps++
		}
		samePersisted(t, s, i)
	}
	if scopedSteps < 50 {
		t.Fatalf("only %d writes took the scoped path", scopedSteps)
	}
	mem, version, _, _ := s.Snapshot()
	memUndo, memRedo := len(s.history.Entries()), len(s.history.RedoEntries())
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	disk, dv, _, _ := s2.Snapshot()
	if dv != version || jsonv.Stringify(mem, "") != jsonv.Stringify(disk, "") {
		t.Fatal("reopened store differs from the document in memory")
	}
	if len(s2.history.Entries()) != memUndo || len(s2.history.RedoEntries()) != memRedo {
		t.Fatalf("history reloaded %d/%d, memory %d/%d", len(s2.history.Entries()), len(s2.history.RedoEntries()), memUndo, memRedo)
	}
	var _ *core.Document = disk
	t.Logf("scoped writes: %d", scopedSteps)
}
