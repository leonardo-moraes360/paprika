package server

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func importImageSetup(t *testing.T) (*MCP, *Store, string) {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("testdata", "images"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(ImportDirsEnv, dir)
	s, _ := openTemp(t)
	return NewMCP(s, "agent:test", nil), s, dir
}

func lastNode(t *testing.T, s *Store) *jsonv.Object {
	t.Helper()
	keys := core.Nodes(s.Doc()).Keys()
	if len(keys) == 0 {
		t.Fatal("no nodes")
	}
	return core.GetNode(s.Doc(), keys[len(keys)-1])
}

func TestImportImageFormats(t *testing.T) {
	cases := []struct {
		file          string
		format        string
		mime          string
		width, height float64
		animated      bool
	}{
		{"pixel.png", "png", "image/png", 4, 3, false},
		{"pixel.jpg", "jpeg", "image/jpeg", 4, 3, false},
		{"rotated.jpg", "jpeg", "image/jpeg", 3, 4, false},
		{"pixel.gif", "gif", "image/gif", 4, 3, false},
		{"animated.gif", "gif", "image/gif", 4, 3, true},
		{"pixel.webp", "webp", "image/webp", 4, 3, false},
		{"pixel-lossless.webp", "webp", "image/webp", 4, 3, false},
		{"animated.webp", "webp", "image/webp", 4, 3, true},
		{"pixel.avif", "avif", "image/avif", 4, 3, false},
		{"animated.avif", "avif", "image/avif", 4, 3, true},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			m, s, dir := importImageSetup(t)
			r := m.CallTool(t.Context(), "import_image", obj("src", filepath.Join(dir, c.file), "x", 10.0, "y", 20.0), true)
			if r.Bool("isError") {
				t.Fatalf("error: %s", jsonv.Stringify(r, ""))
			}
			out := r.Obj("structuredContent")
			if out.Str("format") != c.format || out.Num("naturalWidth") != c.width || out.Num("naturalHeight") != c.height || out.Bool("animated") != c.animated {
				t.Fatalf("result = %s", jsonv.Stringify(out, ""))
			}
			if (len(out.Arr("warnings")) == 1) != c.animated {
				t.Fatalf("warnings = %s", jsonv.Stringify(out.Arr("warnings"), ""))
			}
			n := lastNode(t, s)
			raw, err := os.ReadFile(filepath.Join(dir, c.file))
			if err != nil {
				t.Fatal(err)
			}
			want := "data:" + c.mime + ";base64," + base64.StdEncoding.EncodeToString(raw)
			if n.Str("type") != "image" || n.Str("src") != want {
				t.Fatalf("node src does not carry the original bytes: %s", n.Str("src")[:40])
			}
			if n.Num("width") != c.width || n.Num("height") != c.height || n.Num("x") != 10 || n.Num("y") != 20 {
				t.Fatalf("node = %s", jsonv.Stringify(n, ""))
			}
			if n.Str("name") != strings.TrimSuffix(c.file, filepath.Ext(c.file)) {
				t.Fatalf("name = %q", n.Str("name"))
			}
		})
	}
}

func TestImportImageSizing(t *testing.T) {
	m, s, _ := importImageSetup(t)
	if out, isErr := callText(t, m, "import_image", obj("src", "pixel.png", "width", 2.0, "fit", "contain")); isErr {
		t.Fatalf("relative path: %s", out)
	}
	n := lastNode(t, s)
	if n.Num("width") != 2 || n.Num("height") != 1.5 || n.Str("fit") != "contain" {
		t.Fatalf("shrunk node = %s", jsonv.Stringify(n, ""))
	}
	if out, isErr := callText(t, m, "import_image", obj("src", "pixel.png", "width", 100.0)); isErr {
		t.Fatalf("width above natural: %s", out)
	}
	if n := lastNode(t, s); n.Num("width") != 4 || n.Num("height") != 3 {
		t.Fatalf("a max width must not enlarge: %s", jsonv.Stringify(n, ""))
	}
}

func TestImportImageDataURL(t *testing.T) {
	m, s, dir := importImageSetup(t)
	raw, err := os.ReadFile(filepath.Join(dir, "pixel.png"))
	if err != nil {
		t.Fatal(err)
	}
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(raw)
	if out, isErr := callText(t, m, "import_image", obj("src", src)); isErr {
		t.Fatalf("data URL: %s", out)
	}
	n := lastNode(t, s)
	if n.Str("src") != src || n.Str("name") != "Image" || n.Num("width") != 4 {
		t.Fatalf("node = %s", jsonv.Stringify(n, ""))
	}
	mislabeled := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(raw)
	if out, isErr := callText(t, m, "import_image", obj("src", mislabeled)); isErr {
		t.Fatalf("mislabeled data URL: %s", out)
	}
	if n := lastNode(t, s); !strings.HasPrefix(n.Str("src"), "data:image/png;base64,") {
		t.Fatalf("the format comes from the bytes, not the declared type: %s", n.Str("src")[:30])
	}
	for _, bad := range []string{"data:image/png;base64,@@@", "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not an image")), "data:image/png"} {
		if _, isErr := callText(t, m, "import_image", obj("src", bad)); !isErr {
			t.Fatalf("%q must be refused", bad)
		}
	}
}

func TestImportImageParent(t *testing.T) {
	m, s, _ := importImageSetup(t)
	if _, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "frame", "id", "card", "width", 100.0, "height", 100.0)})); isErr {
		t.Fatal("create_nodes")
	}
	if out, isErr := callText(t, m, "import_image", obj("src", "pixel.png", "parentId", "card")); isErr {
		t.Fatalf("parentId: %s", out)
	}
	if kids := core.GetNode(s.Doc(), "card").Arr("children"); len(kids) != 1 {
		t.Fatalf("children = %v", kids)
	}
	if out, isErr := callText(t, m, "import_image", obj("src", "pixel.png", "parentId", "missing")); !isErr || out == "" {
		t.Fatalf("missing parent: %q", out)
	}
}

func TestImportImagePathTraversal(t *testing.T) {
	m, _, fixtures := importImageSetup(t)
	raw, err := os.ReadFile(filepath.Join(fixtures, "pixel.png"))
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	dir, sibling, outside := filepath.Join(base, "images"), filepath.Join(base, "images-evil"), filepath.Join(base, "outside")
	for _, d := range []string{dir, sibling, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	secret := filepath.Join(outside, "secret.png")
	for _, f := range []string{filepath.Join(dir, "pixel.png"), filepath.Join(sibling, "pixel.png"), secret} {
		if err := os.WriteFile(f, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(secret, filepath.Join(dir, "escape.png")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	t.Setenv(ImportDirsEnv, dir)
	rel, err := filepath.Rel(dir, secret)
	if err != nil {
		t.Fatal(err)
	}
	attempts := map[string]string{
		"dot-dot":        "../images-evil/pixel.png",
		"dot-dot deep":   "../../../../../../../../etc/passwd",
		"relative climb": rel,
		"absolute":       secret,
		"sibling prefix": filepath.Join(sibling, "pixel.png"),
		"symlink escape": "escape.png",
		"dot-dot inside": "../images/../images-evil/pixel.png",
	}
	for name, src := range attempts {
		t.Run(name, func(t *testing.T) {
			out, isErr := callText(t, m, "import_image", obj("src", src))
			if !isErr || !strings.Contains(out, "outside the allowed directories") && !strings.Contains(out, "file not found") {
				t.Fatalf("%q must be refused, got isErr=%v %q", src, isErr, out)
			}
			if strings.Contains(out, "unsupported") || strings.Contains(out, "too large") {
				t.Fatalf("%q was read before being refused: %q", src, out)
			}
		})
	}
	if out, isErr := callText(t, m, "import_image", obj("src", "pixel.png")); isErr {
		t.Fatalf("a file inside the allowed dir must still work: %s", out)
	}
	t.Setenv(ImportDirsEnv, dir+string(os.PathListSeparator)+outside)
	if out, isErr := callText(t, m, "import_image", obj("src", secret)); isErr {
		t.Fatalf("a second allowed dir must work: %s", out)
	}
}

func TestImportImageTooLarge(t *testing.T) {
	m, s, _ := importImageSetup(t)
	dir := t.TempDir()
	t.Setenv(ImportDirsEnv, dir)
	before := s.Version()
	big := filepath.Join(dir, "big.png")
	data := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, MaxImportImageBytes)...)
	if err := os.WriteFile(big, data, 0o600); err != nil {
		t.Fatal(err)
	}
	out, isErr := callText(t, m, "import_image", obj("src", big))
	if !isErr || !strings.Contains(out, "too large") || !strings.Contains(out, "limit 3500000 bytes") {
		t.Fatalf("oversized file: isErr=%v %q", isErr, out)
	}
	out, isErr = callText(t, m, "import_image", obj("src", "data:image/png;base64,"+base64.StdEncoding.EncodeToString(data)))
	if !isErr || !strings.Contains(out, "too large") || !strings.Contains(out, "limit 3500000 bytes") {
		t.Fatalf("oversized data URL: isErr=%v %q", isErr, out)
	}
	if s.Version() != before {
		t.Fatal("a refused import must not write")
	}
}

func TestImportImageRefusals(t *testing.T) {
	m, s, _ := importImageSetup(t)
	dir := t.TempDir()
	t.Setenv(ImportDirsEnv, dir)
	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	for src, want := range map[string]string{
		"note.txt":                    "unsupported image format",
		"missing.png":                 "file not found",
		".":                           "not a regular file",
		"https://example.com/a.png":   "not fetched",
		"data:text/plain;base64,aGk=": "unsupported image format",
	} {
		out, isErr := callText(t, m, "import_image", obj("src", src))
		if !isErr || !strings.Contains(out, want) {
			t.Fatalf("%q: isErr=%v %q (want %q)", src, isErr, out, want)
		}
	}
	if s.Version() != 0 {
		t.Fatal("refused imports must not write")
	}
}
