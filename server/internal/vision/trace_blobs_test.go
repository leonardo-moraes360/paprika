package vision

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"strings"
	"testing"
)

func sceneImage() *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, 900, 600))
	for y := range 600 {
		for x := range 900 {
			c := color.NRGBA{255, 255, 255, 255}
			switch {
			case math.Hypot(float64(x)-200, float64(y)-200) <= 120:
				c = color.NRGBA{220, 30, 40, 255}
			case x >= 450 && x < 800 && y >= 100 && y < 300:
				c = color.NRGBA{20, 40, 110, 255}
			case x >= 100 && x < 400 && y >= 400 && y < 560:
				c = color.NRGBA{30, 150, 60, 255}
			case x >= 600 && x < 640 && y >= 450 && y < 470:
				c = color.NRGBA{10, 10, 10, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func TestTraceBlobIDsMatchAnalyze(t *testing.T) {
	img := sceneImage()
	an, err := Analyze(img, Options{MinArea: 0.0001})
	if err != nil {
		t.Fatal(err)
	}
	if len(an.Blobs) < 4 {
		t.Fatalf("blobs: %d", len(an.Blobs))
	}
	all := traceOf(t, img, TraceOptions{MinArea: 0.0001})
	if len(all.Paths) != len(an.Blobs) {
		t.Fatalf("trace drew %d paths, analyze found %d blobs", len(all.Paths), len(an.Blobs))
	}
	for _, b := range an.Blobs {
		r := traceOf(t, img, TraceOptions{MinArea: 0.0001, BlobIDs: []string{b.ID}})
		if len(r.Paths) != 1 || r.Paths[0].BlobID != b.ID || r.Paths[0].Color != b.Color {
			t.Fatalf("%s: %+v (analyze says %s)", b.ID, r.Paths, b.Color)
		}
		bb := r.Paths[0].BBox
		if math.Abs(bb.X-b.BBox.X) > 3 || math.Abs(bb.Y-b.BBox.Y) > 3 || math.Abs(bb.Width-b.BBox.Width) > 4 || math.Abs(bb.Height-b.BBox.Height) > 4 {
			t.Fatalf("%s: trace box %+v, analyze box %+v", b.ID, bb, b.BBox)
		}
		if r.Skipped.NotListed != len(an.Blobs)-1 || r.PathCount != 1 {
			t.Fatalf("%s: skipped %+v, pathCount %d", b.ID, r.Skipped, r.PathCount)
		}
	}
	r := traceOf(t, img, TraceOptions{MinArea: 0.0001, BlobIDs: []string{"b1", "b99"}})
	if len(r.Paths) != 1 || len(r.Warnings) != 1 {
		t.Fatalf("unknown id: %d paths, %v", len(r.Paths), r.Warnings)
	}
}

func TestTraceExclude(t *testing.T) {
	img := sceneImage()
	r := traceOf(t, img, TraceOptions{Exclude: []Rect{{X: 440, Y: 90, Width: 370, Height: 220}}})
	if r.Skipped.Excluded < 1 {
		t.Fatalf("excluded %d", r.Skipped.Excluded)
	}
	for _, p := range r.Paths {
		if p.Color == "#14286e" {
			t.Fatalf("blue was traced: %+v", p)
		}
	}
	if r.PathCount != len(r.Paths) || len(r.Paths) != 3 {
		t.Fatalf("pathCount %d", r.PathCount)
	}
	r = traceOf(t, img, TraceOptions{Exclude: []Rect{{X: 0, Y: 0, Width: 300, Height: 300}}})
	if r.Skipped.Excluded != 0 {
		t.Fatalf("partial overlap skipped %d", r.Skipped.Excluded)
	}
	r = traceOf(t, img, TraceOptions{Scale: 2, OffsetX: 10, OffsetY: 20, Exclude: []Rect{{X: 890, Y: 200, Width: 740, Height: 440}}})
	if r.Skipped.Excluded < 1 {
		t.Fatalf("scaled exclude: %d", r.Skipped.Excluded)
	}
}

func TestTraceDropsByImportanceNotArea(t *testing.T) {
	img := shapeImage(400, 400, color.NRGBA{235, 235, 235, 255}, func(x, y float64) bool { return x > 20 && x < 220 && y > 20 && y < 170 })
	for y := 300; y < 340; y++ {
		for x := 40; x < 100; x++ {
			img.SetNRGBA(x, y, color.NRGBA{0, 0, 0, 255})
		}
	}
	r := traceOf(t, img, TraceOptions{MaxPaths: 1})
	if len(r.Paths) != 1 || r.Paths[0].Color != "#000000" {
		t.Fatalf("kept %+v", r.Paths)
	}
	if !r.Truncated || r.PathCount != 2 || r.Dropped != 1 || len(r.DroppedIDs) != 1 {
		t.Fatalf("truncated %v pathCount %d dropped %d %v", r.Truncated, r.PathCount, r.Dropped, r.DroppedIDs)
	}
	if r.DroppedIDs[0] != "b1" {
		t.Fatalf("dropped %v", r.DroppedIDs)
	}
	again := traceOf(t, img, TraceOptions{BlobIDs: r.DroppedIDs})
	if len(again.Paths) != 1 || again.Paths[0].Color == "#000000" {
		t.Fatalf("retrace: %+v", again.Paths)
	}
	both := traceOf(t, img, TraceOptions{})
	if len(both.Paths) != 2 || both.Dropped != 0 || both.Paths[0].BlobID != "b1" {
		t.Fatalf("both: %+v", both.Paths)
	}
}

func TestTraceBlobIDsMatchAnalyzeWithPhoto(t *testing.T) {
	img := mixedSheet()
	opt := Options{MinArea: 0.0002, MaxBlobs: 200}
	an, err := Analyze(img, opt)
	if err != nil {
		t.Fatal(err)
	}
	if len(regionOf(an, KindPhoto)) == 0 {
		t.Fatal("no photo region in the sheet")
	}
	dropped := false
	for _, w := range an.Warnings {
		if strings.Contains(w, "not listed") {
			dropped = true
		}
	}
	if !dropped {
		t.Fatalf("expected photo specks to be left out of the list: %v", an.Warnings)
	}
	ids := map[string]bool{}
	for _, b := range an.Blobs {
		ids[b.ID] = true
		r := traceOf(t, img, TraceOptions{MinArea: 0.0002, BlobIDs: []string{b.ID}})
		if len(r.Paths) != 1 || r.Paths[0].BlobID != b.ID || r.Paths[0].Color != b.Color {
			t.Fatalf("%s: %+v (analyze says %s)", b.ID, r.Paths, b.Color)
		}
		bb := r.Paths[0].BBox
		if math.Abs(bb.X-b.BBox.X) > 2 || math.Abs(bb.Y-b.BBox.Y) > 2 || math.Abs(bb.Width-b.BBox.Width) > 3 || math.Abs(bb.Height-b.BBox.Height) > 3 {
			t.Fatalf("%s: trace box %+v, analyze box %+v", b.ID, bb, b.BBox)
		}
	}
	all := traceOf(t, img, TraceOptions{MinArea: 0.0002, MaxPaths: 500})
	for _, p := range all.Paths {
		if p.BlobID != "" && !ids[p.BlobID] {
			t.Fatalf("trace id %s is not an analyze id", p.BlobID)
		}
	}
	r := traceOf(t, img, TraceOptions{MinArea: 0.0002, BlobIDs: []string{fmt.Sprintf("b%d", len(an.Blobs)+1)}})
	if len(r.Paths) != 0 {
		t.Fatalf("an id past the listed blobs traced %d paths", len(r.Paths))
	}
}
