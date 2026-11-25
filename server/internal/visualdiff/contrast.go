package visualdiff

import (
	"fmt"
	"image/color"
	"math"
)

// The contrast half of the loop: pixels can match at 95 % and still ship a label nobody can
// read, because a 1-pixel-wide difference in a thin glyph passes the comparator and fails a
// person. These helpers are the WCAG 2.1 numbers, kept next to the comparator so the generator
// and the discriminator use one definition.

// Level is the WCAG conformance level to check.
type Level string

const (
	LevelAA  Level = "AA"
	LevelAAA Level = "AAA"
)

// ContrastRatio returns the WCAG 2.1 contrast ratio between a foreground and a background,
// 1 (identical) to 21 (black on white). A translucent foreground is composited over the
// background first, because that is what the screen shows.
func ContrastRatio(fg, bg color.Color) float64 {
	f, b := compositeOver(fg, bg), opaque(bg)
	l1, l2 := relativeLuminance(f), relativeLuminance(b)
	if l1 < l2 {
		l1, l2 = l2, l1
	}
	return (l1 + 0.05) / (l2 + 0.05)
}

// MinContrast is the ratio WCAG 2.1 asks for: 4.5 for body text, 3 for large text (18 px bold
// or 24 px), and one step higher at AAA. UI parts (icons, borders that carry meaning) sit at
// the large-text bar, which is why the loop reuses it.
func MinContrast(large bool, level Level) (float64, error) {
	switch level {
	case LevelAA:
		if large {
			return 3, nil
		}
		return 4.5, nil
	case LevelAAA:
		if large {
			return 4.5, nil
		}
		return 7, nil
	default:
		return 0, fmt.Errorf("visualdiff: unknown WCAG level %q (use AA or AAA)", level)
	}
}

// MeetsContrast answers one thing the generator can act on: does this colour pair pass, and by
// how much did it miss.
func MeetsContrast(fg, bg color.Color, large bool, level Level) (ratio float64, required float64, ok bool) {
	ratio = ContrastRatio(fg, bg)
	required, err := MinContrast(large, level)
	if err != nil {
		return ratio, 0, false
	}
	return ratio, required, ratio >= required
}

// ParseHex reads "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" (with or without the '#'), the way
// the board writes its tokens.
func ParseHex(s string) (color.Color, error) {
	if trim(s) == "" {
		return nil, fmt.Errorf("visualdiff: empty colour")
	}
	if s[0] == '#' {
		s = s[1:]
	}
	out := []uint8{}
	for i := 0; i < len(s); i++ {
		d, err := hexDigit(s[i])
		if err != nil {
			return nil, fmt.Errorf("visualdiff: colour %q: %w", s, err)
		}
		switch len(s) {
		case 3, 4: // #rgb / #rgba: each digit stands for itself
			out = append(out, d*17)
		default:
			if i+1 >= len(s) {
				return nil, fmt.Errorf("visualdiff: colour %q has a half byte left over", s)
			}
			d2, err := hexDigit(s[i+1])
			if err != nil {
				return nil, fmt.Errorf("visualdiff: colour %q: %w", s, err)
			}
			out = append(out, d*16+d2)
			i++
		}
	}
	switch len(out) {
	case 3:
		return color.RGBA{R: out[0], G: out[1], B: out[2], A: 255}, nil
	case 4:
		return color.NRGBA{R: out[0], G: out[1], B: out[2], A: out[3]}, nil
	default:
		return nil, fmt.Errorf("visualdiff: colour %q is not #rgb, #rgba, #rrggbb or #rrggbbaa", s)
	}
}

func hexDigit(b byte) (uint8, error) {
	switch {
	case b >= '0' && b <= '9':
		return b - '0', nil
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10, nil
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10, nil
	default:
		return 0, fmt.Errorf("%q is not a hex digit", b)
	}
}

// relativeLuminance is WCAG 2.1's Y: the sRGB channels linearised and weighted.
func relativeLuminance(c color.RGBA) float64 {
	lin := func(v uint8) float64 {
		s := float64(v) / 255
		if s <= 0.03928 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(c.R) + 0.7152*lin(c.G) + 0.0722*lin(c.B)
}

func opaque(c color.Color) color.RGBA {
	r, g, b, a := c.RGBA()
	return color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: uint8(a >> 8)}
}

// compositeOver flattens a translucent colour onto a background, so a token with alpha is
// judged on the colour the screen actually paints.
func compositeOver(fg, bg color.Color) color.RGBA {
	f, b := toNRGBA(fg), toNRGBA(bg)
	if f.A == 0 {
		return color.RGBA{R: b.R, G: b.G, B: b.B, A: 255}
	}
	out := over(color.NRGBA{R: f.R, G: f.G, B: f.B, A: f.A}, color.NRGBA{R: b.R, G: b.G, B: b.B, A: 255})
	return color.RGBA{R: out.R, G: out.G, B: out.B, A: 255}
}

func toNRGBA(c color.Color) color.NRGBA { return color.NRGBAModel.Convert(c).(color.NRGBA) }
