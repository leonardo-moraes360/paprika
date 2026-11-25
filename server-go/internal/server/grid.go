package server

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Region is a rectangle in frame coordinates (the root's own space, 0..width).
type Region struct{ X, Y, W, H float64 }

// GridSpec is the parsed `grid` argument of render_screenshot.
type GridSpec struct {
	Step   float64 // 0 = automatic
	Labels bool
	Color  color.NRGBA
}

const (
	gridTargetLines = 16
	rulerBand       = 16
)

var defaultGridColor = color.NRGBA{R: 0xff, G: 0x2d, B: 0x95, A: 0xff}

// parseGridArg reads `grid`: absent/false = none, true = defaults, object = options.
func parseGridArg(a *jsonv.Object) (*GridSpec, error) {
	v, ok := a.Get("grid")
	if !ok || v == nil {
		return nil, nil
	}
	spec := &GridSpec{Labels: true, Color: defaultGridColor}
	switch g := v.(type) {
	case bool:
		if !g {
			return nil, nil
		}
	case *jsonv.Object:
		if s, has := g.Get("step"); has {
			f, _ := s.(float64)
			if f <= 0 {
				return nil, errors.New("grid.step must be greater than 0")
			}
			spec.Step = f
		}
		if l, has := g.Get("labels"); has {
			spec.Labels, _ = l.(bool)
		}
		if c := g.Str("color"); c != "" {
			parsed, ok := parseHexColor(c)
			if !ok {
				return nil, fmt.Errorf("grid.color %q must be #rgb or #rrggbb", c)
			}
			spec.Color = parsed
		}
	default:
		return nil, errors.New("grid must be true or an object")
	}
	return spec, nil
}

func parseRegionArg(a *jsonv.Object) *Region {
	o := a.Obj("region")
	if o == nil {
		return nil
	}
	return &Region{o.Num("x"), o.Num("y"), o.Num("width"), o.Num("height")}
}

func parseHexColor(s string) (color.NRGBA, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return color.NRGBA{}, false
	}
	n, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.NRGBA{}, false
	}
	return color.NRGBA{R: uint8(n >> 16), G: uint8(n >> 8), B: uint8(n), A: 0xff}, true
}

// autoGridStep picks a 1/2/5 x 10^k step (50, 100, 200 for typical frames) so the longer
// visible side gets about 8 to 16 lines.
func autoGridStep(extent float64) float64 {
	if extent <= 0 {
		return 1
	}
	want := extent / gridTargetLines
	exp := math.Floor(math.Log10(want))
	for _, m := range []float64{1, 2, 5, 10} {
		step := m * math.Pow(10, exp)
		if step >= want-1e-9 {
			return step
		}
	}
	return math.Pow(10, exp+1)
}

// gridValues lists the multiples of step inside [start, start+size) in frame units.
func gridValues(start, size, step float64) []float64 {
	var out []float64
	first := math.Ceil(start/step-1e-9) * step
	for i := 0; ; i++ {
		v := first + float64(i)*step
		if v >= start+size-1e-9 {
			break
		}
		// drop float noise such as 0.30000000000000004
		out = append(out, math.Round(v*1e6)/1e6)
	}
	return out
}

// gridPixel maps a frame coordinate to a pixel offset inside the cropped image.
func gridPixel(v, start, scale float64) int {
	return int(math.Round((v - start) * scale))
}

func formatGridValue(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// frameSize is the root's size in frame units. A root sized hug/fill has no number in the
// document, so its size comes from the rendered image and the requested scale.
func frameSize(d *core.Document, rootID string, pngW, pngH int, scale float64) (float64, float64) {
	if scale <= 0 {
		scale = 1
	}
	fw, fh := float64(pngW)/scale, float64(pngH)/scale
	var b core.Bounds
	if rootID == "" {
		b = core.CanvasBounds(d, "")
	} else if rb, err := core.RootBounds(d, rootID); err == nil {
		b = rb
	} else {
		return fw, fh
	}
	n := core.GetNode(d, rootID)
	isPage := rootID == "" || (n != nil && n.Str("type") == "page")
	numeric := func(key string) bool {
		if isPage || n == nil {
			return true
		}
		v, _ := n.Get(key)
		_, ok := v.(float64)
		return ok
	}
	if numeric("width") {
		fw = math.Ceil(b.Width)
	}
	if numeric("height") {
		fh = math.Ceil(b.Height)
	}
	return fw, fh
}

// cropRect turns a region (frame units, clamped to the frame) into a pixel rectangle of an
// image rendered at `scale` pixels per unit. It also returns the clamped region.
func cropRect(r Region, frameW, frameH, scale float64) (image.Rectangle, Region, error) {
	x0, y0 := math.Max(0, r.X), math.Max(0, r.Y)
	x1, y1 := math.Min(frameW, r.X+r.W), math.Min(frameH, r.Y+r.H)
	if x1-x0 <= 0 || y1-y0 <= 0 {
		return image.Rectangle{}, Region{}, fmt.Errorf("region is outside the frame (0,0 to %s×%s)", formatGridValue(frameW), formatGridValue(frameH))
	}
	rect := image.Rect(
		int(math.Round(x0*scale)), int(math.Round(y0*scale)),
		int(math.Round(x1*scale)), int(math.Round(y1*scale)),
	)
	if rect.Dx() < 1 {
		rect.Max.X = rect.Min.X + 1
	}
	if rect.Dy() < 1 {
		rect.Max.Y = rect.Min.Y + 1
	}
	return rect, Region{x0, y0, x1 - x0, y1 - y0}, nil
}

// annotateShot crops the PNG to region (if any) and draws the grid (if any). pxPerUnit is
// the rendered pixels per frame unit; frameW/frameH the frame size. It returns the new PNG,
// its size, the grid step used (0 = no grid) and the region used (nil = whole frame).
func annotateShot(src []byte, frameW, frameH, pxPerUnit float64, region *Region, grid *GridSpec) ([]byte, int, int, float64, *Region, error) {
	img, err := png.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, 0, 0, 0, nil, fmt.Errorf("screenshot png: %w", err)
	}
	b := img.Bounds()
	start := Region{0, 0, frameW, frameH}
	var used *Region
	var dst *image.NRGBA
	if region != nil {
		rect, clamped, cerr := cropRect(*region, frameW, frameH, pxPerUnit)
		if cerr != nil {
			return nil, 0, 0, 0, nil, cerr
		}
		rect = rect.Intersect(image.Rect(0, 0, b.Dx(), b.Dy()))
		if rect.Empty() {
			return nil, 0, 0, 0, nil, errors.New("region is outside the rendered image")
		}
		dst = image.NewNRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
		draw.Draw(dst, dst.Bounds(), img, b.Min.Add(rect.Min), draw.Src)
		start = clamped
		used = &clamped
	} else {
		dst = image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	}
	var step float64
	if grid != nil {
		step = grid.Step
		if step == 0 {
			step = autoGridStep(math.Max(start.W, start.H))
		}
		drawGrid(dst, start, pxPerUnit, step, grid)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return nil, 0, 0, 0, nil, err
	}
	return buf.Bytes(), dst.Bounds().Dx(), dst.Bounds().Dy(), step, used, nil
}

// blend composites c with alpha over the pixel, keeping transparent pixels correct.
func blend(img *image.NRGBA, x, y int, c color.NRGBA, alpha float64) {
	if !(image.Point{X: x, Y: y}).In(img.Bounds()) {
		return
	}
	o := img.NRGBAAt(x, y)
	oa := float64(o.A) / 255
	na := alpha + oa*(1-alpha)
	if na <= 0 {
		return
	}
	mix := func(over, under uint8) uint8 {
		return uint8(math.Round((float64(over)*alpha + float64(under)*oa*(1-alpha)) / na))
	}
	img.SetNRGBA(x, y, color.NRGBA{R: mix(c.R, o.R), G: mix(c.G, o.G), B: mix(c.B, o.B), A: uint8(math.Round(na * 255))})
}

func fillRect(img *image.NRGBA, r image.Rectangle, c color.NRGBA, alpha float64) {
	r = r.Intersect(img.Bounds())
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			blend(img, x, y, c, alpha)
		}
	}
}

func drawText(img *image.NRGBA, s string, x, baseline int, c color.NRGBA) {
	d := font.Drawer{Dst: img, Src: image.NewUniform(c), Face: basicfont.Face7x13, Dot: fixed.P(x, baseline)}
	d.DrawString(s)
}

func textWidth(s string) int { return len(s) * basicfont.Face7x13.Advance }

// drawGrid overlays 1px lines (with a faint light and dark neighbour so they read on light
// and dark content), a ruler band along the top and left edges, and the labels.
func drawGrid(img *image.NRGBA, start Region, scale, step float64, g *GridSpec) {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	dark := color.NRGBA{A: 0xff}
	white := color.NRGBA{R: 0xff, G: 0xff, B: 0xff, A: 0xff}
	xs := gridValues(start.X, start.W, step)
	ys := gridValues(start.Y, start.H, step)
	for _, v := range xs {
		px := gridPixel(v, start.X, scale)
		for y := 0; y < h; y++ {
			blend(img, px-1, y, white, 0.25)
			blend(img, px+1, y, dark, 0.25)
			blend(img, px, y, g.Color, 0.7)
		}
	}
	for _, v := range ys {
		py := gridPixel(v, start.Y, scale)
		for x := 0; x < w; x++ {
			blend(img, x, py-1, white, 0.25)
			blend(img, x, py+1, dark, 0.25)
			blend(img, x, py, g.Color, 0.7)
		}
	}
	if !g.Labels {
		return
	}
	ink := color.NRGBA{R: 0x11, G: 0x11, B: 0x14, A: 0xff}
	leftW := 0
	for _, v := range ys {
		leftW = max(leftW, textWidth(formatGridValue(v))+6)
	}
	if len(ys) > 0 {
		fillRect(img, image.Rect(0, 0, leftW, h), ink, 0.78)
	}
	fillRect(img, image.Rect(0, 0, w, rulerBand), ink, 0.78)
	for _, v := range xs {
		px := gridPixel(v, start.X, scale)
		fillRect(img, image.Rect(px, 0, px+1, rulerBand), g.Color, 1)
		drawText(img, formatGridValue(v), px+3, 12, white)
	}
	for _, v := range ys {
		py := gridPixel(v, start.Y, scale)
		if py < rulerBand {
			continue // collides with the top band
		}
		fillRect(img, image.Rect(0, py, leftW, py+1), g.Color, 1)
		drawText(img, formatGridValue(v), 3, py-3, white)
	}
}
