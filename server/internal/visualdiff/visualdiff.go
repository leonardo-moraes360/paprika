package visualdiff

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
)

const DefaultThreshold = 0.1

var PadColor = color.RGBA{R: 0xff, G: 0x00, B: 0xff, A: 0xff}

type Mask struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Reason string `json:"reason"`
}

func (m Mask) rect(w, h int) (x0, y0, x1, y1 int) {
	x0, y0 = clamp(m.X, 0, w), clamp(m.Y, 0, h)
	x1, y1 = clamp(m.X+m.Width, 0, w), clamp(m.Y+m.Height, 0, h)
	return
}

func (m Mask) validate(i int) error {
	if m.Width <= 0 || m.Height <= 0 {
		return fmt.Errorf("visualdiff: mask %d has size %dx%d: width and height must be positive", i, m.Width, m.Height)
	}
	if m.X < 0 || m.Y < 0 {
		return fmt.Errorf("visualdiff: mask %d starts at (%d,%d): negative coordinates are a typo or a way to hide the canvas edge", i, m.X, m.Y)
	}
	if trim(m.Reason) == "" {
		return fmt.Errorf("visualdiff: mask %d (%dx%d at %d,%d) has no reason: every skipped area needs an explanation the next round can audit", i, m.Width, m.Height, m.X, m.Y)
	}
	return nil
}

type Options struct {
	Threshold           float64
	IncludeAntiAliasing bool
	Masks               []Mask
	OmitDiff            bool
}

var DefaultOptions = Options{Threshold: DefaultThreshold}

func (o Options) withDefaults() (Options, error) {
	if math.IsNaN(o.Threshold) || o.Threshold < 0 || o.Threshold > 1 {
		return o, fmt.Errorf("visualdiff: threshold %v is outside 0..1", o.Threshold)
	}
	for i, m := range o.Masks {
		if err := m.validate(i); err != nil {
			return o, err
		}
	}
	return o, nil
}

type Result struct {
	Width         int         `json:"width"`
	Height        int         `json:"height"`
	Compared      int         `json:"compared"`
	Masked        int         `json:"masked"`
	Scored        int         `json:"scored"`
	DiffPixels    int         `json:"diffPixels"`
	AntiAliased   int         `json:"antiAliased"`
	SizeMismatch  int         `json:"sizeMismatch"`
	MaskedPerMask []int       `json:"maskedPerMask"`
	Similarity    float64     `json:"similarity"`
	MaxDelta      float64     `json:"maxDelta"`
	Diff          *image.RGBA `json:"-"`
}

func CompareFiles(pathA, pathB string, opts *Options) (*Result, error) {
	a, err := openPNG(pathA)
	if err != nil {
		return nil, err
	}
	b, err := openPNG(pathB)
	if err != nil {
		return nil, err
	}
	return Compare(a, b, opts)
}

func Compare(a, b image.Image, opts *Options) (*Result, error) {
	if a == nil || b == nil {
		return nil, fmt.Errorf("visualdiff: both images are required (got %v and %v)", a == nil, b == nil)
	}
	if opts == nil {
		opts = &DefaultOptions
	}
	o, err := opts.withDefaults()
	if err != nil {
		return nil, err
	}

	ra, rb := a.Bounds(), b.Bounds()
	if ra.Min.X != 0 || ra.Min.Y != 0 || rb.Min.X != 0 || rb.Min.Y != 0 {
		return nil, fmt.Errorf("visualdiff: images must start at (0,0); got (%d,%d) and (%d,%d)", ra.Min.X, ra.Min.Y, rb.Min.X, rb.Min.Y)
	}

	w, h := max(ra.Dx(), rb.Dx()), max(ra.Dy(), rb.Dy())
	if ra.Dx() <= 0 || ra.Dy() <= 0 || rb.Dx() <= 0 || rb.Dy() <= 0 {
		return nil, fmt.Errorf("visualdiff: empty image: %dx%d and %dx%d", ra.Dx(), ra.Dy(), rb.Dx(), rb.Dy())
	}

	pa, err := flatten(a, w, h)
	if err != nil {
		return nil, err
	}
	pb, err := flatten(b, w, h)
	if err != nil {
		return nil, err
	}

	res := &Result{Width: w, Height: h, Compared: w * h, MaskedPerMask: make([]int, len(o.Masks))}

	masked := make([]bool, w*h)
	for i, m := range o.Masks {
		x0, y0, x1, y1 := m.rect(w, h)
		count := 0
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				if !masked[y*w+x] {
					masked[y*w+x] = true
					count++
				}
			}
		}
		res.MaskedPerMask[i] = count
		res.Masked += count
	}
	res.Scored = res.Compared - res.Masked
	if res.Scored <= 0 {
		return nil, fmt.Errorf("visualdiff: the masks leave %d pixels to score: a comparison of nothing cannot prove a screen is correct", res.Scored)
	}

	if !o.OmitDiff {
		res.Diff = image.NewRGBA(image.Rect(0, 0, w, h))
	}

	threshold := o.Threshold * yiqScale

	for y := range h {
		for x := range w {
			i := y*w + x
			if res.Diff != nil {
				res.Diff.SetRGBA(x, y, dim(pa[i]))
			}
			if masked[i] {
				if res.Diff != nil {
					res.Diff.SetRGBA(x, y, color.RGBA{R: 0x00, G: 0x66, B: 0xff, A: 0xff})
				}
				continue
			}
			if outside(i, ra.Dx(), ra.Dy(), w) || outside(i, rb.Dx(), rb.Dy(), w) {
				res.SizeMismatch++
			}

			px, py := pa[i], pb[i]
			if px == py {
				continue
			}
			delta := perceptualDelta(px, py)
			if delta <= threshold {
				continue
			}
			if delta > res.MaxDelta {
				res.MaxDelta = delta / yiqScale
			}

			if !o.IncludeAntiAliasing && antiAliased(pa, pb, x, y, w, h) {
				res.AntiAliased++
				if res.Diff != nil {
					res.Diff.SetRGBA(x, y, color.RGBA{R: 0xff, G: 0xff, B: 0x00, A: 0xff})
				}
				continue
			}

			res.DiffPixels++
			if res.Diff != nil {
				res.Diff.SetRGBA(x, y, color.RGBA{R: 0xff, G: 0x00, B: 0x00, A: 0xff})
			}
		}
	}

	res.Similarity = 1 - float64(res.DiffPixels)/float64(res.Scored)
	return res, nil
}

func (r *Result) WriteDiffPNG(w io.Writer) error {
	if r == nil {
		return fmt.Errorf("visualdiff: no result")
	}
	if r.Diff == nil {
		return fmt.Errorf("visualdiff: this result has no diff image (Options.OmitDiff was set)")
	}
	return png.Encode(w, r.Diff)
}

func outside(i, iw, ih, w int) bool {
	x, y := i%w, i/w
	return x >= iw || y >= ih
}

func flatten(img image.Image, w, h int) ([]color.RGBA, error) {
	out := make([]color.RGBA, w*h)
	for i := range out {
		out[i] = PadColor
	}
	b := img.Bounds()

	var pix []byte
	var stride int
	switch src := img.(type) {
	case *image.NRGBA:
		pix, stride = src.Pix, src.Stride
	case *image.RGBA:
		pix, stride = src.Pix, src.Stride
	}

	if pix != nil {
		for y := 0; y < b.Dy(); y++ {
			row := (b.Min.Y+y)*stride + b.Min.X*4
			dst := y * w
			for x := 0; x < b.Dx(); x, row = x+1, row+4 {
				a := pix[row+3]
				if a == 255 {
					out[dst+x] = color.RGBA{R: pix[row], G: pix[row+1], B: pix[row+2], A: 255}
					continue
				}
				if a == 0 {
					continue
				}
				c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
				out[dst+x] = ontoPad(c)
			}
		}
		return out, nil
	}

	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			if c.A == 0 {
				continue
			}
			out[y*w+x] = ontoPad(c)
		}
	}
	return out, nil
}

func ontoPad(c color.NRGBA) color.RGBA {
	if c.A == 255 {
		return color.RGBA{R: c.R, G: c.G, B: c.B, A: 255}
	}
	m := over(c, color.NRGBA{R: PadColor.R, G: PadColor.G, B: PadColor.B, A: 255})
	return color.RGBA{R: m.R, G: m.G, B: m.B, A: 255}
}

func over(src, bg color.NRGBA) color.NRGBA {
	a := uint32(src.A)
	inv := 255 - a
	mix := func(s, d uint8) uint8 { return uint8((uint32(s)*a + uint32(d)*inv + 127) / 255) }
	return color.NRGBA{R: mix(src.R, bg.R), G: mix(src.G, bg.G), B: mix(src.B, bg.B), A: 255}
}

func dim(c color.RGBA) color.RGBA {
	f := func(v uint8) uint8 { return uint8(uint32(v) * 40 / 100) }
	return color.RGBA{R: f(c.R), G: f(c.G), B: f(c.B), A: 255}
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func trim(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}
