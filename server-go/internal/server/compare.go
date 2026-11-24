package server

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"math"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

const compareGap = 16

var comparePaper = color.NRGBA{R: 0xf4, G: 0xf1, B: 0xec, A: 0xff}

// composeSideBySide draws the screenshot on the left and the compare image on the right,
// scaled to the screenshot's height, with a gap between them.
func composeSideBySide(leftPNG, right []byte) ([]byte, int, int, error) {
	left, err := png.Decode(bytes.NewReader(leftPNG))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("screenshot png: %w", err)
	}
	cmp, err := decodeCompare(right)
	if err != nil {
		return nil, 0, 0, err
	}
	lb, cb := left.Bounds(), cmp.Bounds()
	lw, lh := lb.Dx(), lb.Dy()
	cw, ch := cb.Dx(), cb.Dy()
	if lw < 1 || lh < 1 || cw < 1 || ch < 1 {
		return nil, 0, 0, fmt.Errorf("compare image has no pixels")
	}
	scaledW := max(1, int(math.Round(float64(cw)*float64(lh)/float64(ch))))
	totalW := lw + compareGap + scaledW
	dst := image.NewNRGBA(image.Rect(0, 0, totalW, lh))
	xdraw.Draw(dst, dst.Bounds(), image.NewUniform(comparePaper), image.Point{}, xdraw.Src)
	xdraw.Draw(dst, image.Rect(0, 0, lw, lh), left, lb.Min, xdraw.Over)
	scaled := image.NewNRGBA(image.Rect(0, 0, scaledW, lh))
	xdraw.BiLinear.Scale(scaled, scaled.Bounds(), cmp, cb, xdraw.Over, nil)
	xdraw.Draw(dst, image.Rect(lw+compareGap, 0, totalW, lh), scaled, image.Point{}, xdraw.Over)
	if totalW > int(maxSide) || lh > int(maxSide) {
		factor := math.Min(maxSide/float64(totalW), maxSide/float64(lh))
		nw := int(math.Max(1, math.Floor(float64(totalW)*factor)))
		nh := int(math.Max(1, math.Floor(float64(lh)*factor)))
		fitted := image.NewNRGBA(image.Rect(0, 0, nw, nh))
		xdraw.BiLinear.Scale(fitted, fitted.Bounds(), dst, dst.Bounds(), xdraw.Over, nil)
		dst = fitted
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, 0, 0, err
	}
	b := dst.Bounds()
	return buf.Bytes(), b.Dx(), b.Dy(), nil
}

func decodeCompare(data []byte) (image.Image, error) {
	if len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		img, err := webp.Decode(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("compare image: invalid WebP: %w", err)
		}
		return img, nil
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("compare image must be a PNG, JPEG, GIF or WebP: %w", err)
	}
	return img, nil
}
