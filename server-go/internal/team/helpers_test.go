package team

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/leonardo-moraes360/paprika/server-go/internal/server"
)

// sidecarBin finds a built paprika-sync for tests: $PAPRIKA_SYNC or crates/sync/target.
func sidecarBin(t *testing.T) string {
	t.Helper()
	if p := os.Getenv("PAPRIKA_SYNC"); p != "" {
		return p
	}
	for _, prof := range []string{"release", "debug"} {
		p, _ := filepath.Abs(filepath.Join("..", "..", "..", "crates", "sync", "target", prof, BinaryName))
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	t.Skip("paprika-sync not built (cargo build in crates/sync, or set PAPRIKA_SYNC)")
	return ""
}

type instance struct {
	store *server.Store
	team  *Service
}

func newInstance(t *testing.T, name string) *instance {
	t.Helper()
	dir := t.TempDir()
	// Every test instance starts on the same workspace id, like peers of one team.
	dbPath := filepath.Join(dir, "p.db")
	db, err := server.OpenDB(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := server.ImportDocument(db, []byte(`{"format":"paprika/1","id":"shared","name":"Shared"}`), false); err != nil {
		t.Fatal(err)
	}
	db.Close()
	store, err := server.OpenStore(dbPath, server.OpenOptions{DocID: "shared", Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	svc, err := New(context.Background(), store, Options{Bin: sidecarBin(t), DataDir: filepath.Join(dir, "team"), Name: name, NoRelay: true, Bind: "127.0.0.1:0"}, func(m string) { t.Log(name + ": " + m) })
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.Close(); store.Close() })
	return &instance{store, svc}
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out: %s", what)
}

func call(t *testing.T, i *instance, cmd map[string]any) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := i.team.Sidecar().Call(ctx, cmd)
	if err != nil {
		t.Fatalf("%v: %v", cmd["t"], err)
	}
	return res
}
