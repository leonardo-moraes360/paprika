package server

import (
	"bytes"
	"context"
	"image/png"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// A non-frame, non-page root (here a stroke-only path) comes out on a transparent background:
// the PNG keeps an alpha channel and the corner is fully transparent.
func TestChromeScreenshotTransparentRoot(t *testing.T) {
	if FindChromium() == "" {
		t.Skip("Chromium not found")
	}
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"path","id":"p","x":0,"y":0,"width":40,"height":40,"d":"M 5 5 L 35 35","stroke":{"color":"#ff0000","width":4}}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	c := &Chrome{}
	defer c.Close()
	data, _, _, err := c.Screenshot(context.Background(), res.Doc, "p", 1)
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatalf("corner pixel is not transparent: %v (%T)", img.At(0, 0), img)
	}
	if _, _, _, a := img.At(20, 20).RGBA(); a == 0 {
		t.Fatalf("stroke pixel is transparent")
	}
}
