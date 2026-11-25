package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const dotPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

func applyAssetImage(t *testing.T, s *Store) {
	t.Helper()
	if _, err := s.Apply([]any{obj("op", "set_assets", "assets", obj("dot", dotPNG, "logo", "https://example.com/a.png"))}, "test", "assets"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "image", "id", "im", "src", "$dot", "width", 8.0, "height", 8.0))}, "test", "image"); err != nil {
		t.Fatal(err)
	}
}

func TestStorePersistsAssets(t *testing.T) {
	s, path := openTemp(t)
	applyAssetImage(t, s)
	want := jsonv.Stringify(s.Doc(), "  ")
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s2.Close() })
	if got := jsonv.Stringify(s2.Doc(), "  "); got != want {
		t.Fatalf("reopened document differs\n got %s\nwant %s", got, want)
	}
	if v, _ := s2.Doc().Obj("assets").Get("dot"); v != dotPNG {
		t.Fatalf("asset dot = %v", v)
	}
	if ok, err := s2.Undo("test"); !ok || err != nil {
		t.Fatalf("undo image: %v %v", ok, err)
	}
	if ok, err := s2.Undo("test"); !ok || err != nil {
		t.Fatalf("undo assets: %v %v", ok, err)
	}
	if s2.Doc().Has("assets") {
		t.Fatalf("assets after undo: %s", jsonv.Stringify(s2.Doc(), ""))
	}
	s2.Close()
	s3, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s3.Close() })
	if s3.Doc().Has("assets") {
		t.Fatal("undone assets came back after restart")
	}
	for i := 0; i < 2; i++ {
		if ok, err := s3.Redo("test"); !ok || err != nil {
			t.Fatalf("redo: %v %v", ok, err)
		}
	}
	if got := jsonv.Stringify(s3.Doc(), "  "); got != want {
		t.Fatalf("after redo differs\n got %s\nwant %s", got, want)
	}
	if _, err := s3.Apply([]any{obj("op", "set_assets", "assets", obj("logo", nil))}, "test", "drop"); err != nil {
		t.Fatal(err)
	}
	s3.Close()
	s4, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s4.Close() })
	a := s4.Doc().Obj("assets")
	if a == nil || a.Len() != 1 || !a.Has("dot") {
		t.Fatalf("assets after delete: %v", a)
	}
}

func TestAssetsFollowWorkspacePaths(t *testing.T) {
	s, path := openTemp(t)
	applyAssetImage(t, s)
	first := s.DocID()
	exported, err := ExportDocument(s.DB(), first)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateWorkspace("outro", "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenWorkspace(other.ID, "test"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.ApplyIn(first, []any{obj("op", "set_assets", "assets", obj("extra", "https://example.com/b.png"))}, "test", "aside", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.StepIn(first, "test", false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.StepIn(first, "test", true); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s2, err := OpenStore(path, OpenOptions{DocID: first, Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s2.Close() })
	a := s2.Doc().Obj("assets")
	if a == nil || a.Len() != 3 || !a.Has("extra") || !a.Has("dot") {
		t.Fatalf("aside assets: %v", a)
	}
	if _, err := ImportDocument(s2.DB(), []byte(exported), true); err != nil {
		t.Fatal(err)
	}
	again, err := ExportDocument(s2.DB(), first)
	if err != nil || again != exported {
		t.Fatalf("import replace changed the document: %v\n%s\n%s", err, again, exported)
	}
	if _, err := s2.DeleteWorkspace(first, "test"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s2.DB().QueryRow(`SELECT COUNT(*) FROM assets WHERE doc_id = ?`, first).Scan(&n); err != nil || n != 0 {
		t.Fatalf("assets left after delete: %d %v", n, err)
	}
}

func TestAssetsTableMigration(t *testing.T) {
	s, path := openTemp(t)
	createRect(t, s, "a")
	if _, err := s.DB().Exec(`DROP TABLE assets`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s2.Close() })
	applyAssetImage(t, s2)
	want := jsonv.Stringify(s2.Doc(), "")
	s2.Close()
	s3, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s3.Close() })
	if got := jsonv.Stringify(s3.Doc(), ""); got != want || !strings.Contains(got, `"$dot"`) {
		t.Fatalf("migrated store lost assets: %s", got)
	}
}
