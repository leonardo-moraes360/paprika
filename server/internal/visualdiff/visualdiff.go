// Package visualdiff compares two screenshots and says, in numbers, whether they are the
// same picture. It is the first piece of the assisted adversarial verification loop
// (docs/visual-verification.md): the generator changes the app, the discriminator re-renders
// the reference and re-runs this comparison, and a score below the bar fails the round.
//
// The metric is a perceptual colour difference in YIQ with an anti-aliasing filter, so that a
// sub-pixel difference on a diagonal edge does not fail a board. The approach is the one
// popularised by pixelmatch (ISC); this is our own implementation — no code was copied — and
// the choices that matter are written down in docs/visual-verification.md so that a change
// here is visible to the discriminator.
//
// Every exception is explicit: a mask that skips pixels must carry a reason, and the diff
// image paints masks, anti-aliased pixels and differing pixels in different colours so a
// human can see what was forgiven. Nothing here decides pass or fail: that is the caller's
// threshold (the loop in the backlog uses 95 % per screen and mode).
package visualdiff

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"
)

// DefaultThreshold is the perceptual cut-off (0..1) a pixel must exceed to count as a
// difference. 0.1 is the bar the maintainer's harness used; keep it unless the whole loop is
// retuned, because the score is only comparable at the same threshold.
const DefaultThreshold = 0.1

// PadColor fills whatever area one screenshot is smaller than the other. Magenta is chosen
// because it is a colour no real screen produces, so the padded strip is impossible to read
// as content.
var PadColor = color.RGBA{R: 0xff, G: 0x00, B: 0xff, A: 0xff}

// Mask is a rectangle whose pixels are excluded from the comparison. A mask is an admission
// that the two pictures differ there, so it has to say why: Reason is required and is carried
// into the result so a discriminator can audit every exception later.
type Mask struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Reason string `json:"reason"`
}

// rect returns the mask clipped to nothing but its own bounds; it is the area counted.
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

// Options tunes one comparison. Leaving it nil in Compare means DefaultOptions.
type Options struct {
	// Threshold is the perceptual distance (0..1) above which a pixel counts. Zero counts every
	// visible difference, so a caller who wants the loop's bar asks for DefaultThreshold (0.1).
	Threshold float64
	// IncludeAntiAliasing counts anti-aliased edge pixels as differences too. Off by default:
	// a 1-pixel-wide blend on a diagonal is not a design change.
	IncludeAntiAliasing bool
	// Masks are the excluded rectangles; each one needs a Reason.
	Masks []Mask
	// OmitDiff skips building the diff image (useful in a benchmark).
	OmitDiff bool
}

// DefaultOptions is what Compare uses when it is handed nil.
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

// Result is what one comparison says about two pictures. Counts are kept apart on purpose: a
// score is only honest next to how many pixels were masked and how many were forgiven as
// anti-aliasing.
type Result struct {
	// Width and Height are the size of the compared canvas: the larger of the two inputs,
	// with the smaller one padded in magenta.
	Width  int `json:"width"`
	Height int `json:"height"`
	// Compared counts every pixel of that canvas.
	Compared int `json:"compared"`
	// Masked counts pixels removed from the comparison by the masks.
	Masked int `json:"masked"`
	// Scored is Compared minus Masked: the pixels that actually decided the score.
	Scored int `json:"scored"`
	// DiffPixels are the pixels that differ beyond the threshold.
	DiffPixels int `json:"diffPixels"`
	// AntiAliased counts differences that were skipped because both sides looked like edge
	// blends, or like a blend the other side also contains.
	AntiAliased int `json:"antiAliased"`
	// SizeMismatch is the area that only one of the two screenshots had (padded in magenta).
	SizeMismatch int `json:"sizeMismatch"`
	// MaskedPerMask is the pixel count of each mask, in the order given. A mask that covers
	// nothing is a red flag, and this is where the next round can see it.
	MaskedPerMask []int `json:"maskedPerMask"`
	// Similarity is 1 - DiffPixels/Scored, in 0..1.
	Similarity float64 `json:"similarity"`
	// MaxDelta is the largest perceptual distance seen, useful when a score is close to the
	// bar and someone wants to know how bad the worst pixel is.
	MaxDelta float64 `json:"maxDelta"`
	// Diff is the annotated picture: red = counted difference, yellow = anti-aliasing,
	// blue = masked, magenta = the strip only one screenshot had.
	Diff *image.RGBA `json:"-"`
}

// Compare loads two PNG files and compares them. It is the path the discriminator uses, and
// it reports a clear error when a file is not a readable PNG instead of treating it as blank.
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

// Compare compares two pictures. The returned Result always carries the counts that explain
// its Similarity.
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

	// Copy both into premultiplied-free RGBA canvases of the same size, padding the missing
	// area with magenta so a size difference is a visible, countable difference.
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

	// perceptualDelta is a squared distance in units of 255², so the same 0..1 threshold the
	// caller passes is compared against the same scale here.
	threshold := o.Threshold * yiqScale

	for y := range h {
		for x := range w {
			i := y*w + x
			if res.Diff != nil {
				// Base: the reference (image A) dimmed, so the marks read on top of it.
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

// WriteDiffPNG encodes the annotated picture. It is a no-op with a clear error when the
// comparison was asked to omit it, so a caller never writes an empty file by accident.
func (r *Result) WriteDiffPNG(w io.Writer) error {
	if r == nil {
		return fmt.Errorf("visualdiff: no result")
	}
	if r.Diff == nil {
		return fmt.Errorf("visualdiff: this result has no diff image (Options.OmitDiff was set)")
	}
	return png.Encode(w, r.Diff)
}

// outside reports whether the index falls outside an image of the given size.
func outside(i, iw, ih, w int) bool {
	x, y := i%w, i/w
	return x >= iw || y >= ih
}

// flatten copies an image into a compact RGBA slice of the canvas size, padding with PadColor.
// A fully transparent pixel keeps the pad, so a hole in one screenshot shows up as a
// difference instead of being invisible.
//
// The typed branch reads the pixel buffer directly: calling image.Image.At boxes a colour into
// an interface, and at 1440x900 that is millions of allocations for nothing. Screenshots from
// Chrome and from the renderer come back as *image.RGBA or *image.NRGBA, so the slow generic
// path is the rare one.
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
					continue // a hole: the pad underneath stays visible
				}
				// In-between alpha: *image.RGBA stores it premultiplied, so ask for the
				// straight colour instead of guessing.
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

// ontoPad flattens a straight-alpha colour over the pad and returns it opaque.
func ontoPad(c color.NRGBA) color.RGBA {
	if c.A == 255 {
		return color.RGBA{R: c.R, G: c.G, B: c.B, A: 255}
	}
	m := over(c, color.NRGBA{R: PadColor.R, G: PadColor.G, B: PadColor.B, A: 255})
	return color.RGBA{R: m.R, G: m.G, B: m.B, A: 255}
}

// over blends src (straight, non-premultiplied alpha) over bg.
func over(src, bg color.NRGBA) color.NRGBA {
	a := uint32(src.A)
	inv := 255 - a
	mix := func(s, d uint8) uint8 { return uint8((uint32(s)*a + uint32(d)*inv + 127) / 255) }
	return color.NRGBA{R: mix(src.R, bg.R), G: mix(src.G, bg.G), B: mix(src.B, bg.B), A: 255}
}

// dim keeps the reference visible under the marks without letting it hide a red pixel.
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
