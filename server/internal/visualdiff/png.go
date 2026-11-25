package visualdiff

import (
	"fmt"
	"image"
	"image/png"
	"os"
)

// openPNG reads one screenshot. A file that is not a PNG fails with its name in the message:
// in the verification loop a broken reference must never be read as a blank canvas, because a
// blank canvas compared against itself scores a perfect 1.
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
