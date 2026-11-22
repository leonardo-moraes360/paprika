package visualdiff

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// solid builds a w x h picture and paints on it through paint, so each case says what it draws.
func solid(w, h int, c color.RGBA) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func rect(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			img.SetRGBA(x, y, c)
		}
	}
}

func white10() *image.RGBA { return solid(10, 10, color.RGBA{255, 255, 255, 255}) }

var black = color.RGBA{0, 0, 0, 255}
var white = color.RGBA{255, 255, 255, 255}

func TestIdenticalImagesScoreOne(t *testing.T) {
	a, b := white10(), white10()
	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Similarity != 1 {
		t.Errorf("similarity = %v, want exactly 1 for identical images", got.Similarity)
	}
	if got.DiffPixels != 0 || got.Compared != 100 || got.Scored != 100 {
		t.Errorf("counts = diff %d compared %d scored %d, want 0 100 100", got.DiffPixels, got.Compared, got.Scored)
	}
	if got.AntiAliased != 0 {
		t.Errorf("anti-aliased = %d, want 0: there is no edge in a flat picture", got.AntiAliased)
	}
}

func TestOnePixelChangeIsCounted(t *testing.T) {
	a, b := white10(), white10()
	b.SetRGBA(4, 4, black)

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels != 1 {
		t.Errorf("diff pixels = %d, want 1: a single painted pixel is a real change", got.DiffPixels)
	}
	want := 1 - 1.0/100
	if got.Similarity != want {
		t.Errorf("similarity = %v, want %v", got.Similarity, want)
	}
	if got.MaxDelta < 0.4 || got.MaxDelta > 0.51 {
		t.Errorf("max delta = %v, want the black-on-white span (about 0.5)", got.MaxDelta)
	}
}

func TestTinyDifferenceBelowThresholdIsNotCounted(t *testing.T) {
	a, b := white10(), white10()
	// One channel by 8: under the 0.1 bar, and it should stay invisible to the loop.
	b.SetRGBA(4, 4, color.RGBA{247, 255, 255, 255})

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels != 0 {
		t.Errorf("diff pixels = %d, want 0 for a barely visible channel step", got.DiffPixels)
	}
	if got.Similarity != 1 {
		t.Errorf("similarity = %v, want 1", got.Similarity)
	}
}

func TestSizeMismatchPadsWithMagentaAndCounts(t *testing.T) {
	a := solid(10, 10, white) // 10x10
	b := solid(10, 8, white)  // same width, two rows shorter

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Width != 10 || got.Height != 10 {
		t.Errorf("canvas = %dx%d, want the larger 10x10", got.Width, got.Height)
	}
	if got.SizeMismatch != 20 {
		t.Errorf("size mismatch = %d, want the 20 pixels only one picture had", got.SizeMismatch)
	}
	if got.Compared != 100 {
		t.Errorf("compared = %d, want 100", got.Compared)
	}
	// The missing strip is magenta against white: a difference, so it must be counted.
	if got.DiffPixels != 20 {
		t.Errorf("diff pixels = %d, want 20: a screen that lost its footer is not identical", got.DiffPixels)
	}
	if got.Diff == nil {
		t.Fatal("no diff image")
	}
	if c := got.Diff.At(0, 9); (c != color.RGBA{0xff, 0x00, 0x00, 0xff}) {
		t.Errorf("diff pixel in the padded strip = %v, want red", c)
	}
}

func TestThresholdZeroCountsEveryVisibleDifference(t *testing.T) {
	a, b := white10(), white10()
	b.SetRGBA(4, 4, color.RGBA{254, 255, 255, 255}) // one step in one channel

	exact, err := Compare(a, b, &Options{Threshold: 0})
	if err != nil {
		t.Fatalf("Compare with threshold 0: %v", err)
	}
	if exact.DiffPixels != 1 {
		t.Errorf("diff pixels = %d at threshold 0, want 1: zero means exact", exact.DiffPixels)
	}

	// The same pair under the loop's bar: nil options is DefaultOptions, not "no threshold".
	def, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare with nil options: %v", err)
	}
	if def.DiffPixels != 0 {
		t.Errorf("diff pixels = %d with nil options, want 0 at the default 0.1", def.DiffPixels)
	}
}

func TestMaskWithoutReasonIsRefused(t *testing.T) {
	_, err := Compare(white10(), white10(), &Options{Masks: []Mask{{X: 1, Y: 1, Width: 2, Height: 2}}})
	if err == nil {
		t.Fatal("a mask with no reason was accepted")
	}
	if !strings.Contains(err.Error(), "no reason") {
		t.Errorf("error = %v, want it to name the missing reason", err)
	}
	if !strings.Contains(err.Error(), "1,1") {
		t.Errorf("error = %v, want the mask position so a human can find it", err)
	}
}

func TestMaskWithReasonExcludesItsPixels(t *testing.T) {
	a, b := white10(), white10()
	rect(b, 2, 2, 6, 6, black) // a 4x4 block differs

	got, err := Compare(a, b, &Options{Masks: []Mask{{X: 2, Y: 2, Width: 4, Height: 4, Reason: "the live clock is inside this frame"}}})
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Masked != 16 || len(got.MaskedPerMask) != 1 || got.MaskedPerMask[0] != 16 {
		t.Errorf("masked = %d per mask %v, want 16 and [16]", got.Masked, got.MaskedPerMask)
	}
	if got.Scored != 84 {
		t.Errorf("scored = %d, want 84 of 100", got.Scored)
	}
	if got.DiffPixels != 0 || got.Similarity != 1 {
		t.Errorf("diff = %d similarity = %v, want the masked block forgiven", got.DiffPixels, got.Similarity)
	}
}

func TestMaskCoveringEverythingIsRefused(t *testing.T) {
	// Everything skipped is not a pass, it is a screenshot nobody looked at.
	_, err := Compare(white10(), white10(), &Options{
		Masks: []Mask{{X: 0, Y: 0, Width: 10, Height: 10, Reason: "trust me"}},
	})
	if err == nil {
		t.Fatal("a mask over the whole canvas was accepted")
	}
	if !strings.Contains(err.Error(), "comparison of nothing") {
		t.Errorf("error = %v, want it to say nothing was scored", err)
	}
}

func TestOverlappingMasksAreCountedOnce(t *testing.T) {
	got, err := Compare(white10(), white10(), &Options{Masks: []Mask{
		{X: 0, Y: 0, Width: 4, Height: 4, Reason: "first"},
		{X: 2, Y: 2, Width: 4, Height: 4, Reason: "second"},
	}})
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Masked != 28 { // 16 + 16 - 4 shared
		t.Errorf("masked = %d, want 28: an overlapping area is excused once, not twice", got.Masked)
	}
}

func TestInvalidMaskGeometryIsRefused(t *testing.T) {
	for _, m := range []Mask{
		{X: 0, Y: 0, Width: 0, Height: 4, Reason: "empty"},
		{X: -1, Y: 0, Width: 4, Height: 4, Reason: "off canvas"},
	} {
		if _, err := Compare(white10(), white10(), &Options{Masks: []Mask{m}}); err == nil {
			t.Errorf("mask %+v was accepted", m)
		}
	}
}

func TestAntiAliasedEdgeIsNotCounted(t *testing.T) {
	// The same edge with its blend one pixel over: white, a grey blend column, then black.
	// Nothing about the design changed — the edge just landed half a pixel away — so the two
	// grey positions must be forgiven, not counted.
	a, b := solid(20, 8, white), solid(20, 8, white)
	grey := color.RGBA{128, 128, 128, 255}
	rect(a, 4, 0, 5, 8, grey)
	rect(a, 5, 0, 20, 8, black)
	rect(b, 5, 0, 6, 8, grey)
	rect(b, 6, 0, 20, 8, black)

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels != 0 {
		t.Errorf("diff pixels = %d, want 0 for an edge that moved by one pixel", got.DiffPixels)
	}
	if got.AntiAliased != 16 {
		t.Errorf("anti-aliased = %d, want the 16 blend pixels recorded so the forgiveness is visible", got.AntiAliased)
	}
	if got.Similarity != 1 {
		t.Errorf("similarity = %v, want 1", got.Similarity)
	}

	// Same pair with the filter off: the pixels are then counted, which is what
	// IncludeAntiAliasing is for.
	withAA, err := Compare(a, b, &Options{IncludeAntiAliasing: true})
	if err != nil {
		t.Fatalf("Compare with IncludeAntiAliasing: %v", err)
	}
	if withAA.DiffPixels != 16 {
		t.Errorf("diff pixels = %d with the filter on, want the 16 blends counted", withAA.DiffPixels)
	}
}

func TestInventedEdgeBlendIsStillCounted(t *testing.T) {
	// A grey column that only one picture has, with a hard black on the other side: one side
	// is a blend, but the colour is nowhere near in the other picture, so it is a real change.
	a, b := solid(20, 8, white), solid(20, 8, white)
	rect(a, 4, 0, 5, 8, color.RGBA{128, 128, 128, 255})
	rect(a, 5, 0, 10, 8, black)
	rect(b, 5, 0, 10, 8, black)

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels < 8 {
		t.Errorf("diff pixels = %d, want at least the 8 pixels of the column that disappeared", got.DiffPixels)
	}
}

func TestDiffImageMarksEachKindOfPixel(t *testing.T) {
	a, b := white10(), white10()
	b.SetRGBA(4, 4, black)
	got, err := Compare(a, b, &Options{Masks: []Mask{{X: 0, Y: 0, Width: 1, Height: 1, Reason: "cursor"}}})
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Diff == nil {
		t.Fatal("no diff image")
	}
	if c := got.Diff.At(4, 4); (c != color.RGBA{0xff, 0x00, 0x00, 0xff}) {
		t.Errorf("differing pixel = %v, want red", c)
	}
	if c := got.Diff.At(0, 0); (c != color.RGBA{0x00, 0x66, 0xff, 0xff}) {
		t.Errorf("masked pixel = %v, want blue", c)
	}
	if c := got.Diff.At(9, 9); (c == color.RGBA{0xff, 0x00, 0x00, 0xff}) {
		t.Error("an unchanged pixel was painted red")
	}
}

func TestOmitDiffLeavesNoImage(t *testing.T) {
	got, err := Compare(white10(), white10(), &Options{OmitDiff: true})
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.Diff != nil {
		t.Error("Diff was built even though OmitDiff was set")
	}
	if err := got.WriteDiffPNG(&bytes.Buffer{}); err == nil {
		t.Error("WriteDiffPNG on a result without an image reported success")
	}
}

func TestThresholdOutsideRangeIsRefused(t *testing.T) {
	for _, th := range []float64{-0.1, 1.5} {
		if _, err := Compare(white10(), white10(), &Options{Threshold: th}); err == nil {
			t.Errorf("threshold %v was accepted", th)
		}
	}
}

func TestCompareFilesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	pathA := filepath.Join(dir, "reference.png")
	pathB := filepath.Join(dir, "capture.png")

	a, b := white10(), white10()
	b.SetRGBA(1, 1, black)
	for p, img := range map[string]image.Image{pathA: a, pathB: b} {
		f, err := os.Create(p)
		if err != nil {
			t.Fatalf("create %s: %v", p, err)
		}
		if err := png.Encode(f, img); err != nil {
			f.Close()
			t.Fatalf("encode %s: %v", p, err)
		}
		if err := f.Close(); err != nil {
			t.Fatalf("close %s: %v", p, err)
		}
	}

	got, err := CompareFiles(pathA, pathB, nil)
	if err != nil {
		t.Fatalf("CompareFiles: %v", err)
	}
	if got.DiffPixels != 1 {
		t.Errorf("diff pixels = %d, want 1", got.DiffPixels)
	}

	diff := filepath.Join(dir, "diff.png")
	f, err := os.Create(diff)
	if err != nil {
		t.Fatalf("create diff: %v", err)
	}
	if err := got.WriteDiffPNG(f); err != nil {
		f.Close()
		t.Fatalf("WriteDiffPNG: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close diff: %v", err)
	}
	back, err := os.Open(diff)
	if err != nil {
		t.Fatalf("open diff: %v", err)
	}
	defer back.Close()
	if _, err := png.Decode(back); err != nil {
		t.Errorf("the diff file is not a readable PNG: %v", err)
	}
}

func TestCompareFilesReportsBadPaths(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "ok.png")
	f, err := os.Create(good)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := png.Encode(f, white10()); err != nil {
		f.Close()
		t.Fatalf("encode: %v", err)
	}
	f.Close()
	junk := filepath.Join(dir, "junk.png")
	if err := os.WriteFile(junk, []byte("not a png"), 0o600); err != nil {
		t.Fatalf("write junk: %v", err)
	}

	for _, pair := range [][2]string{{junk, good}, {filepath.Join(dir, "missing.png"), good}} {
		_, err := CompareFiles(pair[0], pair[1], nil)
		if err == nil {
			t.Fatalf("CompareFiles(%q, %q) succeeded", pair[0], pair[1])
		}
		if !strings.Contains(err.Error(), pair[0]) {
			t.Errorf("error = %v, want it to name the unreadable file %q", err, pair[0])
		}
	}
}

func TestEmptyImageIsRefused(t *testing.T) {
	if _, err := Compare(image.NewRGBA(image.Rect(0, 0, 0, 4)), white10(), nil); err == nil {
		t.Error("an empty image was accepted")
	}
	if _, err := Compare(nil, white10(), nil); err == nil {
		t.Error("a nil image was accepted")
	}
}

func TestTranslucentHoleIsADifference(t *testing.T) {
	a := white10()
	b := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	for y := 0; y < 10; y++ {
		for x := 0; x < 10; x++ {
			b.SetNRGBA(x, y, color.NRGBA{255, 255, 255, 255})
		}
	}
	b.SetNRGBA(5, 5, color.NRGBA{0, 0, 0, 0}) // a hole

	got, err := Compare(a, b, nil)
	if err != nil {
		t.Fatalf("Compare: %v", err)
	}
	if got.DiffPixels != 1 {
		t.Errorf("diff pixels = %d, want 1: a transparent hole shows the magenta pad", got.DiffPixels)
	}
}

func ExampleCompare() {
	a, b := white10(), white10()
	b.SetRGBA(3, 3, black)
	got, err := Compare(a, b, nil)
	if err != nil {
		fmt.Println(err)
		return
	}
	fmt.Printf("%.2f %d\n", got.Similarity, got.DiffPixels)
	// Output: 0.99 1
}
