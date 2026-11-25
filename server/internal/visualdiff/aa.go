package visualdiff

import "image/color"

// The colour difference is measured in YIQ, not RGB: the eye separates brightness far better
// than hue, so a channel-wise RGB distance flags anti-aliasing and dithering as errors and
// misses hue shifts nobody sees. Y/I/Q come from the NTSC matrices, and the weights
// (0.5053 / 0.2926 / 0.1597) are the share each component keeps after that rotation.
//
// The result is a squared distance in units of 255²: identical colours are 0 and black against
// white is about 0.5053 of the scale. That is what Options.Threshold (default 0.1) is compared
// against — so the bar is "a fifth of the way from black to white", which is what the
// maintainer's harness accepted.
const yiqScale = 255 * 255

// perceptualDelta returns the weighted squared YIQ distance between two opaque colours.
func perceptualDelta(a, b color.RGBA) float64 {
	dr, dg, db := float64(a.R)-float64(b.R), float64(a.G)-float64(b.G), float64(a.B)-float64(b.B)
	dy := 0.299*dr + 0.587*dg + 0.114*db
	di := 0.596*dr - 0.274*dg - 0.322*db
	dq := 0.211*dr - 0.523*dg + 0.312*db
	return 0.5053*dy*dy + 0.2926*di*di + 0.1597*dq*dq
}

// luminance is the Y of the same rotation, in 0..255.
func luminance(c color.RGBA) float64 {
	return 0.299*float64(c.R) + 0.587*float64(c.G) + 0.114*float64(c.B)
}

// neighbourOffsets is the 8-neighbourhood used to read the local edge.
var neighbourOffsets = [8][2]int{{-1, -1}, {0, -1}, {1, -1}, {-1, 0}, {1, 0}, {-1, 1}, {0, 1}, {1, 1}}

// edgeBlend reports whether a pixel looks like a blend on an edge rather than a colour in a
// flat area. A blend has neighbours on both sides of it in brightness: some darker and some
// lighter than itself. A solid region, or the hard core of a shape, never does — that is what
// keeps a real 1-pixel change from being forgiven just because it is small.
func edgeBlend(img []color.RGBA, x, y, w, h int) bool {
	c := luminance(img[y*w+x])
	darker, lighter := false, false
	for _, off := range neighbourOffsets {
		nx, ny := x+off[0], y+off[1]
		if nx < 0 || ny < 0 || nx >= w || ny >= h {
			continue
		}
		switch l := luminance(img[ny*w+nx]); {
		case l < c-1:
			darker = true
		case l > c+1:
			lighter = true
		}
		if darker && lighter {
			return true
		}
	}
	return false
}

// sameColourNear reports whether img holds c within the 3x3 window around (x,y), within the
// rounding a resampled edge produces.
func sameColourNear(img []color.RGBA, x, y, w, h int, c color.RGBA) bool {
	for dy := -1; dy <= 1; dy++ {
		for dx := -1; dx <= 1; dx++ {
			nx, ny := x+dx, y+dy
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			n := img[ny*w+nx]
			if diff8(n.R, c.R) <= 2 && diff8(n.G, c.G) <= 2 && diff8(n.B, c.B) <= 2 {
				return true
			}
		}
	}
	return false
}

// antiAliased decides whether a counted difference at (x,y) is really an edge that moved by
// less than a pixel instead of a design change.
//
// Both sides being edge blends is a sub-pixel difference: forgiven. Only one side being a
// blend is only forgiven when the other side already has that colour right next door, which is
// what a shifted edge looks like; if the colour is nowhere near, the blend was invented or
// removed and it is a real change.
func antiAliased(a, b []color.RGBA, x, y, w, h int) bool {
	i := y*w + x
	aaA, aaB := edgeBlend(a, x, y, w, h), edgeBlend(b, x, y, w, h)
	switch {
	case !aaA && !aaB:
		return false
	case aaA && aaB:
		return true
	case aaA:
		return sameColourNear(b, x, y, w, h, a[i])
	default:
		return sameColourNear(a, x, y, w, h, b[i])
	}
}

func diff8(a, b uint8) int {
	if a > b {
		return int(a) - int(b)
	}
	return int(b) - int(a)
}
