package vision

import (
	"fmt"
	"math"
)

// OKLab is the perceptual space used for quantization: Euclidean distance there tracks how
// different two colors look, so merging and nearest-color decisions behave like an eye would.

var srgbLinear [256]float64

func init() {
	for i := range srgbLinear {
		c := float64(i) / 255
		if c <= 0.04045 {
			srgbLinear[i] = c / 12.92
		} else {
			srgbLinear[i] = math.Pow((c+0.055)/1.055, 2.4)
		}
	}
}

type lab struct{ L, A, B float64 }

func oklab(r, g, b float64) lab {
	l := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
	m := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
	s := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
	return lab{
		L: 0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
		A: 1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
		B: 0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
	}
}

func labFromBytes(r, g, b uint8) lab {
	return oklab(srgbLinear[r], srgbLinear[g], srgbLinear[b])
}

// labFromRGBf takes fractional 0..255 channels (a mean of several pixels).
func labFromRGBf(r, g, b float64) lab {
	lin := func(v float64) float64 {
		c := v / 255
		if c <= 0.04045 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	return oklab(lin(r), lin(g), lin(b))
}

func (a lab) dist2(b lab) float64 {
	dl, da, db := a.L-b.L, a.A-b.A, a.B-b.B
	return dl*dl + da*da + db*db
}

func hexOf(rgb [3]float64) string {
	c := func(v float64) int { return int(math.Max(0, math.Min(255, math.Round(v)))) }
	return fmt.Sprintf("#%02x%02x%02x", c(rgb[0]), c(rgb[1]), c(rgb[2]))
}
