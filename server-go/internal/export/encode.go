package export

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"

	"github.com/gen2brain/avif"
	"github.com/gen2brain/webp"
)

func EncodeImage(img image.Image, format string) ([]byte, string, error) {
	var buf bytes.Buffer
	switch format {
	case FormatPNG:
		if err := png.Encode(&buf, img); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/png", nil
	case FormatJPEG:
		opaque := image.NewRGBA(img.Bounds())
		for y := img.Bounds().Min.Y; y < img.Bounds().Max.Y; y++ {
			for x := img.Bounds().Min.X; x < img.Bounds().Max.X; x++ {
				opaque.Set(x, y, img.At(x, y))
			}
		}
		if err := jpeg.Encode(&buf, opaque, &jpeg.Options{Quality: 92}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/jpeg", nil
	case FormatWebP:
		if err := webp.Encode(&buf, img, webp.Options{Quality: 90}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/webp", nil
	case FormatAVIF:
		if err := avif.Encode(&buf, img, avif.Options{Quality: 60, QualityAlpha: 60}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/avif", nil
	default:
		return nil, "", fmt.Errorf("encode: unsupported format %q", format)
	}
}
