package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeStaticStaysInWebRoot(t *testing.T) {
	base := t.TempDir()
	web := filepath.Join(base, "web")
	if err := os.MkdirAll(filepath.Join(web, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(p, s string) {
		if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(web, "index.html"), "INDEX")
	write(filepath.Join(web, "assets", "app.js"), "APP")
	write(filepath.Join(base, "secret.txt"), "SECRET")
	if err := os.Symlink(filepath.Join(base, "secret.txt"), filepath.Join(web, "leak.txt")); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		target string
		want   string
	}{
		{"/", "INDEX"},
		{"/assets/app.js", "APP"},
		{"/assets", "INDEX"},
		{"/missing/route", "INDEX"},
		{"/../secret.txt", "INDEX"},
		{"/assets/..%2f..%2fsecret.txt", "INDEX"},
		{"/%2e%2e/secret.txt", "INDEX"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		serveStatic(rec, httptest.NewRequest("GET", c.target, nil), web)
		if body := rec.Body.String(); body != c.want {
			t.Errorf("%s: status %d, body %q, want %q", c.target, rec.Code, body, c.want)
		}
	}

	rec := httptest.NewRecorder()
	serveStatic(rec, httptest.NewRequest("GET", "/leak.txt", nil), web)
	if strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatalf("symlink escaped the web root: %q", rec.Body.String())
	}
}
