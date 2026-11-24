package server

import (
	"errors"
	"testing"
)

func TestFoldersCreateRenameMove(t *testing.T) {
	s, _ := openTemp(t)
	id := s.DocID()
	createRect(t, s, "box")

	if _, err := s.CreateFolder("  "); !errors.Is(err, ErrBlankName) {
		t.Fatalf("blank = %v", err)
	}
	folder, err := s.CreateFolder("  Produto  ")
	if err != nil || folder.Name != "Produto" || folder.ID == "" {
		t.Fatalf("create = %+v %v", folder, err)
	}
	renamed, err := s.RenameFolder(folder.ID, "Marca")
	if err != nil || renamed.Name != "Marca" || renamed.ID != folder.ID {
		t.Fatalf("rename = %+v %v", renamed, err)
	}
	if _, err := s.RenameFolder("missing", "x"); !errors.Is(err, ErrNoFolder) {
		t.Fatalf("missing folder = %v", err)
	}

	moved, err := s.MoveWorkspace(id, folder.ID, "user")
	if err != nil || moved.FolderID != folder.ID {
		t.Fatalf("move = %+v %v", moved, err)
	}
	if len(moved.Preview) != 1 || moved.Preview[0].W != 100 || moved.Preview[0].H != 100 {
		t.Fatalf("preview = %+v", moved.Preview)
	}
	if _, err := s.MoveWorkspace(id, "nope", "user"); !errors.Is(err, ErrNoFolder) {
		t.Fatalf("bad folder = %v", err)
	}
	if _, err := s.MoveWorkspace("nope", folder.ID, "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("bad workspace = %v", err)
	}
	root, err := s.MoveWorkspace(id, "", "user")
	if err != nil || root.FolderID != "" {
		t.Fatalf("root = %+v %v", root, err)
	}
	list, err := s.ListFolders()
	if err != nil || len(list) != 1 || list[0].Name != "Marca" {
		t.Fatalf("folders = %+v %v", list, err)
	}
	ws, err := s.ListWorkspaces()
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range ws {
		if w.Preview == nil {
			t.Fatalf("nil preview on %s", w.ID)
		}
	}
}
