package visualdiff

import (
	"image/color"
	"math"
	"testing"
)

func rgba(hex string) color.Color {
	c, err := ParseHex(hex)
	if err != nil {
		panic(err)
	}
	return c
}

func TestContrastRatioKnownPairs(t *testing.T) {
	cases := []struct {
		fg, bg string
		want   float64
	}{
		{"#000000", "#ffffff", 21},
		{"#ffffff", "#ffffff", 1},
		{"#ffffff", "#000000", 21}, // order does not matter
		{"#777777", "#ffffff", 4.48},
		{"#767676", "#ffffff", 4.54},
	}
	for _, c := range cases {
		got := ContrastRatio(rgba(c.fg), rgba(c.bg))
		if math.Abs(got-c.want) > 0.02 {
			t.Errorf("contrast %s on %s = %.3f, want about %.2f", c.fg, c.bg, got, c.want)
		}
	}
}

func TestMeetsContrastDecidesTheWayWCAGDoes(t *testing.T) {
	// #777777 on white is the classic near miss: body text fails AA, large text passes.
	if ratio, need, ok := MeetsContrast(rgba("#777777"), rgba("#ffffff"), false, LevelAA); ok || need != 4.5 {
		t.Errorf("body AA = ok %v need %v (ratio %.2f), want it refused at 4.5", ok, need, ratio)
	}
	if _, need, ok := MeetsContrast(rgba("#777777"), rgba("#ffffff"), true, LevelAA); !ok || need != 3 {
		t.Errorf("large AA = ok %v need %v, want it accepted at 3", ok, need)
	}
	if _, need, ok := MeetsContrast(rgba("#777777"), rgba("#ffffff"), false, LevelAAA); ok || need != 7 {
		t.Errorf("body AAA = ok %v need %v, want it refused at 7", ok, need)
	}
	if _, _, ok := MeetsContrast(rgba("#000000"), rgba("#ffffff"), false, "A"); ok {
		t.Error("an unknown level reported success")
	}
}

func TestTranslucentForegroundIsCompositedBeforeJudging(t *testing.T) {
	// 50 % black on white is #7f7f7f on screen (255*127/255 rounds down), so the ratio must sit
	// there and not at the 21 of pure black.
	translucent := ContrastRatio(rgba("#00000080"), rgba("#ffffff"))
	flattened := ContrastRatio(rgba("#7f7f7f"), rgba("#ffffff"))
	if math.Abs(translucent-flattened) > 0.02 {
		t.Errorf("translucent = %.3f, #7f7f7f = %.3f: alpha must be flattened first", translucent, flattened)
	}
	if full := ContrastRatio(rgba("#000000"), rgba("#ffffff")); math.Abs(translucent-full) < 1 {
		t.Error("a 50 % black read as full black")
	}
	// The other direction, where a wrong blend formula overflows: 50 % white on black paints a
	// mid grey on screen, never pure white.
	up := ContrastRatio(rgba("#ffffff80"), rgba("#000000"))
	greyOnBlack := ContrastRatio(rgba("#808080"), rgba("#000000"))
	if math.Abs(up-greyOnBlack) > 0.02 {
		t.Errorf("50 %% white on black = %.3f, want the %.3f of the grey it paints", up, greyOnBlack)
	}
	if full := ContrastRatio(rgba("#ffffff"), rgba("#000000")); math.Abs(up-full) < 1 {
		t.Error("a 50 %% white read as full white")
	}
}

func TestParseHexAcceptsWhatTheBoardWrites(t *testing.T) {
	for _, s := range []string{"#fff", "fff", "#ffffff", "FFFFFF", "#1a2b3c", "#00000080"} {
		if _, err := ParseHex(s); err != nil {
			t.Errorf("ParseHex(%q): %v", s, err)
		}
	}
	short, _ := ParseHex("#f00")
	if r, g, b, _ := short.RGBA(); r>>8 != 255 || g>>8 != 0 || b>>8 != 0 {
		t.Errorf("#f00 expanded to %d,%d,%d, want 255,0,0", r>>8, g>>8, b>>8)
	}
	for _, s := range []string{"", "  ", "gg", "#12", "#12345", "rgba(0,0,0)"} {
		if _, err := ParseHex(s); err == nil {
			t.Errorf("ParseHex(%q) succeeded, want an error", s)
		}
	}
}

func TestRelativeLuminanceEndsOfTheScale(t *testing.T) {
	for _, c := range []struct {
		hex  string
		want float64
	}{{"#000000", 0}, {"#ffffff", 1}, {"#808080", 0.2159}} {
		got := relativeLuminance(opaque(rgba(c.hex)))
		if math.Abs(got-c.want) > 0.001 {
			t.Errorf("luminance(%s) = %.4f, want %.4f", c.hex, got, c.want)
		}
	}
}
