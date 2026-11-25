package visualdiff

import "image/color"

const yiqScale = 255 * 255

func perceptualDelta(a, b color.RGBA) float64 {
	dr, dg, db := float64(a.R)-float64(b.R), float64(a.G)-float64(b.G), float64(a.B)-float64(b.B)
	dy := 0.299*dr + 0.587*dg + 0.114*db
	di := 0.596*dr - 0.274*dg - 0.322*db
	dq := 0.211*dr - 0.523*dg + 0.312*db
	return 0.5053*dy*dy + 0.2926*di*di + 0.1597*dq*dq
}

func luminance(c color.RGBA) float64 {
	return 0.299*float64(c.R) + 0.587*float64(c.G) + 0.114*float64(c.B)
}

var neighbourOffsets = [8][2]int{{-1, -1}, {0, -1}, {1, -1}, {-1, 0}, {1, 0}, {-1, 1}, {0, 1}, {1, 1}}

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
