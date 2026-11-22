package visualdiff

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// board paints something that looks like a screen: background, cards, borders and thin text
// bars, so the benchmark measures a real comparison (edges and anti-aliasing included) and not
// a flat fill the fast path would swallow.
func board(w, h int, seed int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	rect(img, 0, 0, w, h, color.RGBA{0xf5, 0xf6, 0xf8, 0xff})
	for y := 40; y < h-40; y += 160 {
		for x := 40; x < w-40; x += 300 {
			rect(img, x, y, x+260, y+120, color.RGBA{0xff, 0xff, 0xff, 0xff})
			rect(img, x, y, x+260, y+1, color.RGBA{0x2a, 0x9d, 0x8f, 0xff})
			for t := 0; t < 5; t++ { // thin bars read as text and give the comparator edges
				rect(img, x+12, y+20+t*16, x+12+120+((x+y+t+seed)%100), y+28+t*16, color.RGBA{0x1f, 0x24, 0x28, 0xff})
			}
		}
	}
	if seed != 0 {
		// One card filled with the wrong token: the kind of real change the loop must catch,
		// and the reason the benchmark is not comparing two identical buffers.
		rect(img, 40, 40, 300, 160, color.RGBA{0xe8, 0xf7, 0xf4, 0xff})
	}
	return img
}

func writePNG(t testing.TB, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create %s: %v", path, err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatalf("encode %s: %v", path, err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close %s: %v", path, err)
	}
}

const (
	benchW = 1440
	benchH = 900
)

func BenchmarkCompareIdentical1440x900(b *testing.B) {
	a, c := board(benchW, benchH, 0), board(benchW, benchH, 0)
	runCompare(b, a, c, nil)
}

func BenchmarkCompareEdited1440x900(b *testing.B) {
	a, c := board(benchW, benchH, 0), board(benchW, benchH, 1)
	runCompare(b, a, c, nil)
}

func BenchmarkCompareEditedWithMasks1440x900(b *testing.B) {
	a, c := board(benchW, benchH, 0), board(benchW, benchH, 1)
	runCompare(b, a, c, &Options{Masks: []Mask{
		{X: 40, Y: 40, Width: 260, Height: 120, Reason: "the card that carries the live clock"},
	}})
}

// BenchmarkCompareFiles1440x900 is the number the loop actually pays for: two PNG files on
// disk, decoded and compared.
func BenchmarkCompareFiles1440x900(b *testing.B) {
	dir := b.TempDir()
	reference, capture := filepath.Join(dir, "reference.png"), filepath.Join(dir, "capture.png")
	writePNG(b, reference, board(benchW, benchH, 0))
	writePNG(b, capture, board(benchW, benchH, 1))

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := CompareFiles(reference, capture, nil); err != nil {
			b.Fatalf("CompareFiles: %v", err)
		}
	}
}

func runCompare(b *testing.B, a, c image.Image, opts *Options) {
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := Compare(a, c, opts); err != nil {
			b.Fatalf("Compare: %v", err)
		}
	}
}

// TestBoardLooksLikeAScreen keeps the benchmark honest: the two boards must differ, or the
// benchmark is measuring a comparison of nothing.
func TestBoardLooksLikeAScreen(t *testing.T) {
	got, err := Compare(board(benchW, benchH, 0), board(benchW, benchH, 1), nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels == 0 {
		t.Fatal("the two benchmark boards are identical; the benchmark would prove nothing")
	}
	if got.Similarity < 0.5 || got.Similarity > 0.999 {
		t.Errorf("similarity = %v, want two screens that mostly match but not entirely", got.Similarity)
	}
}
