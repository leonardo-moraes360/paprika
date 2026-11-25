package server

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"math"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const cropJPEGQuality = 95

// cropBox reads the optional crop argument: a rectangle in source image pixels.
func cropBox(a *jsonv.Object) (image.Rectangle, bool) {
	c := a.Obj("crop")
	if c == nil {
		return image.Rectangle{}, false
	}
	x0, y0 := int(math.Floor(c.Num("x"))), int(math.Floor(c.Num("y")))
	x1, y1 := int(math.Ceil(c.Num("x")+c.Num("width"))), int(math.Ceil(c.Num("y")+c.Num("height")))
	return image.Rect(x0, y0, x1, y1), true
}

// cropRaster cuts box (source pixels, JPEG orientation applied) out of info and re-encodes it
// before it is stored: PNG stays PNG, JPEG stays JPEG (quality 95), GIF and WebP become PNG.
// A box partly outside the image is clamped (and says so); one fully outside is an error.
func cropRaster(info rasterInfo, box image.Rectangle) (rasterInfo, []string, error) {
	switch {
	case info.mime == "image/avif":
		return info, nil, errors.New("AVIF cannot be cropped: no pure-Go pixel decoder (re-export as PNG or JPEG first)")
	case info.mime == "image/webp" && info.animated:
		return info, nil, errors.New("animated WebP cannot be cropped: use a still frame (PNG or JPEG)")
	}
	full := image.Rect(0, 0, info.width, info.height)
	clamped := box.Intersect(full)
	if clamped.Empty() {
		return info, nil, fmt.Errorf("crop is outside the image (the image is %dx%d px)", info.width, info.height)
	}
	var warnings []string
	if clamped != box {
		warnings = append(warnings, fmt.Sprintf("crop reaches outside the image (%dx%d px): clamped to x %d, y %d, %dx%d", info.width, info.height, clamped.Min.X, clamped.Min.Y, clamped.Dx(), clamped.Dy()))
	}
	img, warn, err := decodePixels(info)
	if err != nil {
		return info, nil, err
	}
	if warn != "" {
		warnings = append(warnings, "animated GIF: cropped the first frame only")
	}
	b := img.Bounds()
	src := image.Rect(b.Min.X+clamped.Min.X, b.Min.Y+clamped.Min.Y, b.Min.X+clamped.Max.X, b.Min.Y+clamped.Max.Y)
	out := image.NewNRGBA(image.Rect(0, 0, clamped.Dx(), clamped.Dy()))
	draw.Draw(out, out.Bounds(), img, src.Min, draw.Src)

	var buf bytes.Buffer
	next := rasterInfo{width: clamped.Dx(), height: clamped.Dy()}
	if info.mime == "image/jpeg" {
		next.mime = "image/jpeg"
		if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: cropJPEGQuality}); err != nil {
			return info, nil, err
		}
	} else {
		next.mime = "image/png"
		if err := png.Encode(&buf, out); err != nil {
			return info, nil, err
		}
	}
	if buf.Len() > MaxImportImageBytes {
		return info, nil, fmt.Errorf("the cropped image is too large: %d bytes (limit %d bytes); crop a smaller region or resize_image it first", buf.Len(), MaxImportImageBytes)
	}
	next.data = buf.Bytes()
	if next.mime != info.mime {
		warnings = append(warnings, fmt.Sprintf("%s was re-encoded as PNG after the crop", info.format()))
	}
	return next, warnings, nil
}

// applyCrop crops info when the call has a crop argument.
func applyCrop(a *jsonv.Object, info rasterInfo) (rasterInfo, []string, error) {
	box, ok := cropBox(a)
	if !ok {
		return info, nil, nil
	}
	return cropRaster(info, box)
}
