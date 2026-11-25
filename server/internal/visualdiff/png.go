package visualdiff

import (
	"fmt"
	"image"
	"image/png"
	"os"
)

func openPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("visualdiff: cannot read %s: %w", path, err)
	}
	defer f.Close()

	img, err := png.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("visualdiff: %s is not a readable PNG: %w", path, err)
	}
	return img, nil
}
