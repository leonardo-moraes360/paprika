package export

import (
	"embed"
	"fmt"
	"strings"
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

// interFiles are the embedded Inter faces with the CSS weight ranges they cover. The ranges mirror
// pickWeight, so the canvas, the screenshot and the export pick the same face for every weight.
var interFiles = []struct {
	File  string
	Range string
}{
	{"Inter-Regular.ttf", "100 499"},
	{"Inter-SemiBold.ttf", "500 649"},
	{"Inter-Bold.ttf", "650 900"},
}

// InterFile returns an embedded Inter TTF by file name (for the static /fonts route).
func InterFile(name string) ([]byte, bool) {
	for _, f := range interFiles {
		if f.File == name {
			raw, err := fontFS.ReadFile("fonts/" + name)
			return raw, err == nil
		}
	}
	return nil, false
}

// InterFontFaceCSS returns the @font-face rules of the embedded Inter; url maps a file name to
// the url() target (a /fonts/ path for the canvas, a data: URI for the screenshot).
func InterFontFaceCSS(url func(file string) (string, error)) (string, error) {
	var b strings.Builder
	for _, f := range interFiles {
		u, err := url(f.File)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "@font-face{font-family:Inter;font-style:normal;font-weight:%s;font-display:swap;src:url(%s) format(\"truetype\")}\n", f.Range, u)
	}
	return b.String(), nil
}

func fontBytes(weight int) ([]byte, error) {
	if err := loadFonts(); err != nil {
		return nil, err
	}
	return rawByW[pickWeight(weight)], nil
}
