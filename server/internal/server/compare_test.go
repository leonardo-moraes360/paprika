package server

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func solidPNG(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestComposeSideBySide(t *testing.T) {
	left := solidPNG(t, 4, 2, color.NRGBA{R: 200, A: 255})
	right := solidPNG(t, 2, 2, color.NRGBA{G: 180, A: 255})
	out, w, h, err := composeSideBySide(left, right)
	if err != nil {
		t.Fatal(err)
	}
	if w != 4+compareGap+2 || h != 2 {
		t.Fatalf("size = %d×%d", w, h)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != w || img.Bounds().Dy() != h {
		t.Fatalf("decoded = %v", img.Bounds())
	}
	if _, _, _, err := composeSideBySide(left, []byte("not an image")); err == nil {
		t.Fatal("expected a decode error")
	}
}
