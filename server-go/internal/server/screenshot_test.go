package server

import (
	"bytes"
	"context"
	"image/png"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Exercises the CDP calls end to end; skipped where no Chromium is installed.
func TestChromeScreenshot(t *testing.T) {
	if FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"rect","id":"r","x":0,"y":0,"width":40,"height":20,"fill":"#ff0000"}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	data, w, h, err := c.Screenshot(context.Background(), res.Doc, "r", 2)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); w != 80 || h != 40 || b.Dx() != 80 || b.Dy() != 40 {
		t.Fatalf("got %dx%d, image %v", w, h, b)
	}
	if r, _, _, a := img.At(40, 20).RGBA(); r>>8 != 255 || a>>8 != 255 {
		t.Fatalf("center pixel is not opaque red: %v", img.At(40, 20))
	}
}
