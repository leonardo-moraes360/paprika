package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func corruptWorkspace(t *testing.T, s *Store, id string) {
	t.Helper()
	if _, err := s.DB().Exec(`INSERT INTO nodes(doc_id, id, ord, parent_id, type, name, data) VALUES (?, 'bad', 0, NULL, 'image', 'bad', ?)`,
		id, `{"id":"bad","type":"image","name":"bad","parentId":null,"src":"$gone","width":8,"height":8}`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().Exec(`UPDATE documents SET root_ids = '["bad"]', updated_at = updated_at + 1000 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
}

func rowDump(t *testing.T, s *Store, id string) string {
	t.Helper()
	var d string
	if err := s.DB().QueryRow(`SELECT group_concat(id || data, '|') FROM nodes WHERE doc_id = ?`, id).Scan(&d); err != nil {
		t.Fatal(err)
	}
	var v, u int64
	if err := s.DB().QueryRow(`SELECT version, updated_at FROM documents WHERE id = ?`, id).Scan(&v, &u); err != nil {
		t.Fatal(err)
	}
	return d + "|" + jsonv.Stringify(float64(v), "") + "|" + jsonv.Stringify(float64(u), "")
}

func TestOpenStoreSurvivesInvalidWorkspace(t *testing.T) {
	s, path := openTemp(t)
	good := s.DocID()
	createRect(t, s, "ok")
	bad, err := s.CreateWorkspace("quebrado", "test")
	if err != nil {
		t.Fatal(err)
	}
	corruptWorkspace(t, s, bad.ID)
	before := rowDump(t, s, bad.ID)
	s.Close()

	var logs []string
	s2, err := OpenStore(path, OpenOptions{Poll: -1, Log: func(m string) { logs = append(logs, m) }})
	if err != nil {
		t.Fatalf("startup must survive an invalid workspace: %v", err)
	}
	t.Cleanup(func() { s2.Close() })
	if s2.DocID() != good {
		t.Fatalf("active = %s, want the valid workspace %s", s2.DocID(), good)
	}
	if len(logs) != 1 || !strings.Contains(logs[0], bad.ID) || !strings.Contains(logs[0], "quebrado") || !strings.Contains(logs[0], "does not match an asset") {
		t.Fatalf("logs = %q", logs)
	}
	ws, err := s2.ListWorkspaces()
	if err != nil || len(ws) != 2 {
		t.Fatalf("list: %+v %v", ws, err)
	}
	for _, w := range ws {
		if (w.ID == bad.ID) != (w.Error != "") {
			t.Fatalf("error state wrong for %+v", w)
		}
		if w.ID == bad.ID && !strings.Contains(w.Error, "does not match an asset") {
			t.Fatalf("error text: %q", w.Error)
		}
	}
	_, err = s2.OpenWorkspace(bad.ID, "user")
	var inv *InvalidDocumentError
	if !errors.As(err, &inv) || !strings.Contains(err.Error(), bad.ID) || !strings.Contains(err.Error(), "does not match an asset") {
		t.Fatalf("open invalid: %v", err)
	}
	if s2.DocID() != good {
		t.Fatalf("active changed to %s", s2.DocID())
	}
	if _, _, err := s2.ApplyIn(bad.ID, []any{obj("op", "set_tokens", "tokens", obj("a", "#fff"))}, "test", "x", ""); !errors.As(err, &inv) {
		t.Fatalf("write into invalid: %v", err)
	}
	if _, err := s2.ReadWorkspace(bad.ID); !errors.As(err, &inv) {
		t.Fatalf("read invalid: %v", err)
	}
	createRect(t, s2, "more")
	if after := rowDump(t, s2, bad.ID); after != before {
		t.Fatalf("invalid workspace rows changed\n got %s\nwant %s", after, before)
	}
}

func TestOpenStoreInvalidActiveFallsBack(t *testing.T) {
	s, path := openTemp(t)
	only := s.DocID()
	corruptWorkspace(t, s, only)
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatalf("startup: %v", err)
	}
	t.Cleanup(func() { s2.Close() })
	if s2.DocID() == only || s2.Doc().Obj("nodes").Len() != 0 {
		t.Fatalf("expected a new empty active workspace, got %s", s2.DocID())
	}
	ws, _ := s2.ListWorkspaces()
	if len(ws) != 2 {
		t.Fatalf("workspaces: %+v", ws)
	}
}

func TestHTTPOpenInvalidWorkspace(t *testing.T) {
	s, path := openTemp(t)
	bad, err := s.CreateWorkspace("quebrado", "test")
	if err != nil {
		t.Fatal(err)
	}
	corruptWorkspace(t, s, bad.ID)
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s2.Close() })
	m := NewMCP(s2, "agent:test", nil)
	out, isErr := callText(t, m, "open_workspace", obj("id", bad.ID))
	if !isErr || !strings.Contains(out, "does not match an asset") || !strings.Contains(out, bad.ID) {
		t.Fatalf("mcp open invalid: %v %q", isErr, out)
	}
}
