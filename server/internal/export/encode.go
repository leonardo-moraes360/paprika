package export

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
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
		draw.Draw(opaque, opaque.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
		draw.Draw(opaque, opaque.Bounds(), img, img.Bounds().Min, draw.Over)
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

func FromPNG(data []byte, format string) (Result, error) {
	if format == FormatPNG {
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return Result{}, err
		}
		return Result{Data: data, Mime: "image/png", Width: cfg.Width, Height: cfg.Height, Format: format}, nil
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return Result{}, err
	}
	out, mime, err := EncodeImage(img, format)
	if err != nil {
		return Result{}, err
	}
	b := img.Bounds()
	return Result{Data: out, Mime: mime, Width: b.Dx(), Height: b.Dy(), Format: format}, nil
}
