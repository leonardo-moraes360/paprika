package server

import (
	"compress/gzip"
	"io"
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

func TestServeStaticCachesHashedAssetsAndGzips(t *testing.T) {
	web := t.TempDir()
	if err := os.MkdirAll(filepath.Join(web, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	big := strings.Repeat("console.log('paprika');\n", 400)
	for p, s := range map[string]string{"index.html": "<!doctype html>INDEX", "assets/app-abc123.js": big, "assets/tiny-abc123.css": "a{}", "icon.svg": "<svg/>"} {
		if err := os.WriteFile(filepath.Join(web, filepath.FromSlash(p)), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	get := func(target, enc string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", target, nil)
		if enc != "" {
			req.Header.Set("Accept-Encoding", enc)
		}
		rec := httptest.NewRecorder()
		serveStatic(rec, req, web)
		return rec
	}

	rec := get("/assets/app-abc123.js", "gzip, deflate, br")
	if cc := rec.Header().Get("cache-control"); cc != immutableCache {
		t.Fatalf("hashed asset cache-control %q", cc)
	}
	if rec.Header().Get("content-encoding") != "gzip" || rec.Header().Get("vary") != "Accept-Encoding" {
		t.Fatalf("hashed asset not gzipped: %v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := io.ReadAll(zr)
	if err != nil || string(plain) != big {
		t.Fatalf("gzip roundtrip failed: %v", err)
	}
	if again := get("/assets/app-abc123.js", "gzip"); again.Header().Get("content-encoding") != "gzip" {
		t.Fatal("cached gzip body differs")
	}

	for _, c := range []struct{ target, enc string }{{"/assets/app-abc123.js", ""}, {"/assets/app-abc123.js", "gzip;q=0"}, {"/assets/app-abc123.js", "identity"}} {
		r := get(c.target, c.enc)
		if r.Header().Get("content-encoding") != "" || r.Body.String() != big {
			t.Fatalf("%s with %q: want identity body, got encoding %q", c.target, c.enc, r.Header().Get("content-encoding"))
		}
	}

	if r := get("/assets/tiny-abc123.css", "gzip"); r.Header().Get("content-encoding") != "" || r.Body.String() != "a{}" {
		t.Fatalf("tiny asset should stay identity: %v", r.Header())
	}
	for _, target := range []string{"/", "/w/abc", "/icon.svg", "/assets/missing-abc.js"} {
		if cc := get(target, "gzip").Header().Get("cache-control"); cc != "no-store" {
			t.Fatalf("%s cache-control %q, want no-store", target, cc)
		}
	}
}
