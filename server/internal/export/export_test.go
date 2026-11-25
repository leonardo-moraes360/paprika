package export

import (
	"bytes"
	"image"
	"os"
	"path/filepath"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
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

func TestExportFormatsRoundTrip(t *testing.T) {
	doc := loadExample(t, "bezier.paprika.json")
	for _, format := range []string{FormatPNG, FormatJPEG, FormatWebP, FormatPDF} {
		t.Run(format, func(t *testing.T) {
			out, err := Export(doc, "board", format, 1)
			if err != nil {
				t.Fatal(err)
			}
			if len(out.Data) < 20 {
				t.Fatalf("tiny payload: %d bytes", len(out.Data))
			}
			if out.Format != format {
				t.Fatalf("format = %s", out.Format)
			}
			if out.Width < 10 || out.Height < 10 {
				t.Fatalf("size %dx%d", out.Width, out.Height)
			}
		})
	}
}

func TestExportAVIF(t *testing.T) {
	if testing.Short() {
		t.Skip("avif encode is slow under wazero")
	}
	doc := loadExample(t, "bezier.paprika.json")
	out, err := Export(doc, "board", FormatAVIF, 1)
	if err != nil {
		t.Fatal(err)
	}
	if out.Mime != "image/avif" || len(out.Data) < 20 {
		t.Fatalf("avif = %s %d bytes", out.Mime, len(out.Data))
	}
}

func TestExportNoChromium(t *testing.T) {
	t.Setenv("PAPRIKA_CHROMIUM", "/nonexistent/chromium")
	doc := loadExample(t, "bezier.paprika.json")
	if _, err := Export(doc, "board", FormatPNG, 1); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareSVGFlattensNested(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg"><g><svg width="10" height="10"><path d="M0 0"/></svg></g></svg>`
	got := prepareSVG(in)
	if got == in {
		t.Fatal("expected flatten")
	}
	if bytes.Count([]byte(got), []byte("<svg")) != 1 {
		t.Fatalf("nested svg left: %s", got)
	}
}

func TestRasterCenterPixel(t *testing.T) {
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"rect","id":"r","x":0,"y":0,"width":40,"height":20,"fill":"#ff0000"}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	img, _, err := Rasterize(res.Doc, "r", 1)
	if err != nil {
		t.Fatal(err)
	}
	r, g, b, a := img.At(20, 10).RGBA()
	if a>>8 < 200 || r>>8 < 200 || g>>8 > 40 || b>>8 > 40 {
		t.Fatalf("center = %v", img.At(20, 10))
	}
	_ = image.Image(img)
}
