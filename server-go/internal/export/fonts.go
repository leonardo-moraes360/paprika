package export

import (
	"embed"
	"fmt"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
)

//go:embed fonts/Inter-Regular.ttf fonts/Inter-SemiBold.ttf fonts/Inter-Bold.ttf fonts/LICENSE-Inter.txt
var fontFS embed.FS

var (
	fontOnce sync.Once
	fontErr  error
	faces    map[int]*opentype.Font
	rawByW   map[int][]byte
)

func loadFonts() error {
	fontOnce.Do(func() {
		faces = map[int]*opentype.Font{}
		rawByW = map[int][]byte{}
		for weight, name := range map[int]string{
			400: "Inter-Regular.ttf",
			600: "Inter-SemiBold.ttf",
			700: "Inter-Bold.ttf",
		} {
			raw, err := fontFS.ReadFile("fonts/" + name)
			if err != nil {
				fontErr = err
				return
			}
			f, err := opentype.Parse(raw)
			if err != nil {
				fontErr = err
				return
			}
			faces[weight] = f
			rawByW[weight] = raw
		}
	})
	return fontErr
}

func pickWeight(weight int) int {
	switch {
	case weight >= 650:
		return 700
	case weight >= 500:
		return 600
	default:
		return 400
	}
}

func faceFor(weight int, sizePx float64) (font.Face, error) {
	if err := loadFonts(); err != nil {
		return nil, err
	}
	f := faces[pickWeight(weight)]
	if f == nil {
		return nil, fmt.Errorf("missing Inter face for weight %d", weight)
	}
	return opentype.NewFace(f, &opentype.FaceOptions{
		Size:    sizePx,
		DPI:     72,
		Hinting: font.HintingNone,
	})
}

func fontBytes(weight int) ([]byte, error) {
	if err := loadFonts(); err != nil {
		return nil, err
	}
	return rawByW[pickWeight(weight)], nil
}
