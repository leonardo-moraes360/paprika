package server

import (
	"errors"
	"testing"
)

func TestWorkspacesListOpenCreate(t *testing.T) {
	s, _ := openTemp(t)
	first := s.DocID()
	createRect(t, s, "a")

	created, err := s.CreateWorkspace("  Landing  ")
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "Landing" || created.Active || created.Nodes != 0 {
		t.Fatalf("created = %+v", created)
	}
	if blank, _ := s.CreateWorkspace(" "); blank.Name != "Sem título" {
		t.Fatalf("blank name = %q", blank.Name)
	}
	ws, err := s.ListWorkspaces()
	if err != nil || len(ws) != 3 {
		t.Fatalf("list = %+v, %v", ws, err)
	}
	active := 0
	for _, w := range ws {
		if w.Active {
			active++
			if w.ID != first || w.Nodes != 1 {
				t.Fatalf("active = %+v", w)
			}
		}
	}
	if active != 1 {
		t.Fatalf("%d active workspaces", active)
	}

	var events []ChangeEvent
	s.OnChange(func(e ChangeEvent) { events = append(events, e) })
	opened, err := s.OpenWorkspace(created.ID, "user")
	if err != nil || !opened.Active || s.DocID() != created.ID || s.Doc().Str("name") != "Landing" {
		t.Fatalf("open = %+v, %v (active %s)", opened, err, s.DocID())
	}
	if len(events) != 1 || events[0].Kind != "open" || events[0].Doc.Str("id") != created.ID {
		t.Fatalf("events = %+v", events)
	}
	if s.CanUndo() {
		t.Fatal("the new workspace must not inherit the undo history")
	}
	// Writes go to the active workspace; the previous one keeps its own history.
	createRect(t, s, "b")
	if _, err := s.OpenWorkspace(first, "user"); err != nil {
		t.Fatal(err)
	}
	if !s.CanUndo() || s.Doc().Obj("nodes").Has("b") || !s.Doc().Obj("nodes").Has("a") {
		t.Fatal("switching back must restore that workspace's document and history")
	}
	// Opening the active one again is a no-op.
	if _, err := s.OpenWorkspace(first, "user"); err != nil || len(events) != 3 { // open, apply b, open first
		t.Fatalf("reopen: %v, %d events", err, len(events))
	}
	if _, err := s.OpenWorkspace("nope", "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestWorkspacesRenameDelete(t *testing.T) {
	s, _ := openTemp(t)
	first := s.DocID()
	if _, err := s.DeleteWorkspace(first, "user"); !errors.Is(err, ErrLastWorkspace) {
		t.Fatalf("delete only workspace: %v", err)
	}
	other, err := s.CreateWorkspace("Outro")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.RenameWorkspace(other.ID, "  Marca  ", "user")
	if err != nil || got.Name != "Marca" || got.Active {
		t.Fatalf("rename other = %+v, %v", got, err)
	}
	if doc, _, err := LoadDocument(s.DB(), other.ID); err != nil || doc.Str("name") != "Marca" {
		t.Fatalf("stored name: %v", err)
	}
	if _, err := s.RenameWorkspace(other.ID, " ", "user"); err == nil {
		t.Fatal("blank name must fail")
	}
	if _, err := s.RenameWorkspace("nope", "x", "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("rename unknown: %v", err)
	}

	before := s.Doc().Str("name")
	if _, err := s.RenameWorkspace(first, "Ativo", "user"); err != nil || s.Doc().Str("name") != "Ativo" || !s.CanUndo() {
		t.Fatalf("rename active: %v (%q)", err, s.Doc().Str("name"))
	}
	if ok, _ := s.Undo("user"); !ok || s.Doc().Str("name") != before {
		t.Fatalf("undo rename: %q", s.Doc().Str("name"))
	}

	createRect(t, s, "a")
	var events []ChangeEvent
	s.OnChange(func(e ChangeEvent) { events = append(events, e) })
	active, err := s.DeleteWorkspace(first, "user")
	if err != nil || active != other.ID || s.DocID() != other.ID {
		t.Fatalf("delete active = %q, %v (active %s)", active, err, s.DocID())
	}
	if len(events) != 1 || events[0].Kind != "open" {
		t.Fatalf("events = %+v", events)
	}
	var n int
	for _, table := range []string{"documents", "nodes", "history"} {
		if err := s.DB().QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+map[bool]string{true: "id", false: "doc_id"}[table == "documents"]+` = ?`, first).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s rows left for deleted doc: %d, %v", table, n, err)
		}
	}
	if _, err := s.DeleteWorkspace(first, "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("delete twice: %v", err)
	}
}
