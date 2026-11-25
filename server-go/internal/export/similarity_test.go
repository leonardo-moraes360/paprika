package export_test

import (
	"bytes"
	"context"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/export"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/server"
	"github.com/leonardo-moraes360/paprika/server-go/internal/visualdiff"
)

func loadExample(t *testing.T, name string) *core.Document {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "packages", "e2e", "fixtures", name))
	if err != nil {
		t.Fatal(err)
	}
	v, err := jsonv.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := core.ParseDocument(v)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func TestExportSimilarityVsScreenshot(t *testing.T) {
	if server.FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	cases := []struct {
		file string
		root string
	}{
		{"bezier.paprika.json", "board"},
		{"demo.paprika.json", "login"},
		{"demo.paprika.json", "plano"},
	}
	chrome := &server.Chrome{}
	defer chrome.Close()
	opts := &visualdiff.Options{Threshold: 0.2}
	for _, c := range cases {
		t.Run(c.file+"/"+c.root, func(t *testing.T) {
			doc := loadExample(t, c.file)
			out, err := export.Export(doc, c.root, export.FormatPNG, 1)
			if err != nil {
				t.Fatal(err)
			}
			shot, _, _, err := chrome.Screenshot(context.Background(), doc, c.root, 1)
			if err != nil {
				t.Fatal(err)
			}
			a, err := png.Decode(bytes.NewReader(out.Data))
			if err != nil {
				t.Fatal(err)
			}
			b, err := png.Decode(bytes.NewReader(shot))
			if err != nil {
				t.Fatal(err)
			}
			res, err := visualdiff.Compare(a, b, opts)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("similarity=%.4f diff=%d scored=%d", res.Similarity, res.DiffPixels, res.Scored)
			if res.Similarity < 0.98 {
				t.Fatalf("similarity %.4f < 0.98", res.Similarity)
			}
		})
	}
}
