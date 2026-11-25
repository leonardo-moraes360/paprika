package export

import (
	"fmt"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

const (
	FormatPNG  = "png"
	FormatJPEG = "jpeg"
	FormatWebP = "webp"
	FormatAVIF = "avif"
	FormatPDF  = "pdf"
)

type Result struct {
	Data     []byte
	Mime     string
	Width    int
	Height   int
	Format   string
	Scale    float64
	Warnings []string
}

func Export(doc *core.Document, rootID string, format string, scale float64) (Result, error) {
	format = strings.ToLower(strings.TrimSpace(format))
	if scale <= 0 {
		scale = 1
	}
	if scale < 0.1 || scale > 4 {
		return Result{}, fmt.Errorf("scale must be between 0.1 and 4")
	}
	switch format {
	case FormatPNG, FormatJPEG, FormatWebP, FormatAVIF:
		img, warnings, err := Rasterize(doc, rootID, scale)
		if err != nil {
			return Result{}, err
		}
		data, mime, err := EncodeImage(img, format)
		if err != nil {
			return Result{}, err
		}
		b := img.Bounds()
		return Result{
			Data:     data,
			Mime:     mime,
			Width:    b.Dx(),
			Height:   b.Dy(),
			Format:   format,
			Warnings: warnings,
		}, nil
	case FormatPDF:
		return WritePDF(doc, rootID, scale)
	default:
		return Result{}, fmt.Errorf("unsupported format %q: expected png, jpeg, webp, avif or pdf", format)
	}
}
