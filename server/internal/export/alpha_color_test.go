package export

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/srwiley/oksvg"
)

func TestNormalizeAlphaColors(t *testing.T) {
	cases := []struct{ in, want string }{
		{`<rect fill="#00000000" stroke="#ff000080"/>`, `<rect fill="none" stroke="#ff0000" stroke-opacity="0.502"/>`},
		{`<stop offset="0" stop-color="#11223300"/>`, `<stop offset="0" stop-color="#112233" stop-opacity="0"/>`},
		{`<rect fill="#f008" fill-opacity="0.5"/>`, `<rect fill="#ff0000" fill-opacity="0.267"/>`},
		{`<rect fill="#112233"/>`, `<rect fill="#112233"/>`},
	}
	for _, c := range cases {
		if got := normalizeAlphaColors(c.in); got != c.want {
			t.Errorf("normalizeAlphaColors(%s)\n got  %s\n want %s", c.in, got, c.want)
		}
	}
}

// oksvg rejects #RRGGBBAA ("color string 00000000 is not length 3 or 6"); prepareSVG now rewrites it.
func TestPrepareSVGAcceptsAlphaHex(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="#00000000" stroke="#ff000080"/></svg>`
	if _, err := oksvg.ReadIconStream(strings.NewReader(svg)); err == nil {
		t.Fatal("expected oksvg to reject the raw #RRGGBBAA color (guards the premise of this test)")
	}
	if _, err := oksvg.ReadIconStream(strings.NewReader(prepareSVG(svg))); err != nil {
		t.Fatal(err)
	}
}

func TestRasterizeTransparentRootBackground(t *testing.T) {
	ops, err := jsonv.Parse([]byte(`[{"op":"create","node":{"type":"path","id":"p","x":0,"y":0,"width":40,"height":40,"d":"M 5 5 L 35 35","stroke":{"color":"#ff0000","width":4}}}]`))
	if err != nil {
		t.Fatal(err)
	}
	res, err := core.ApplyOps(core.CreateDocument("T", "d"), ops.([]any))
	if err != nil {
		t.Fatal(err)
	}
	img, _, err := Rasterize(res.Doc, "p", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatalf("corner is not transparent: %v", img.At(0, 0))
	}
}
