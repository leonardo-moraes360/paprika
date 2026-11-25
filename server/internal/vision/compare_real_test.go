//go:build realimg

package vision

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// Real references are not in the repo. Run with
//
//	PAPRIKA_REAL_IMAGES=<dir with *.bin PNGs> [PAPRIKA_REAL_OUT=<dir for the variants>] \
//	  go test -tags realimg -run TestCompareRealBackgrounds -v ./internal/vision
//
// Each image is compared against itself, against copies shifted by a few pixels, and against
// versions whose background was swapped for a flat color or a linear gradient of a similar
// average (the ink pixels are left alone). With the background modelled the ink is the same in
// all of them, so the IoU should stay high. The variants are written to PAPRIKA_REAL_OUT (and
// read back when they are already there, so another build can be scored on the same files).
func TestCompareRealBackgrounds(t *testing.T) {
	dir := os.Getenv("PAPRIKA_REAL_IMAGES")
	if dir == "" {
		t.Skip("PAPRIKA_REAL_IMAGES is not set")
	}
	out := os.Getenv("PAPRIKA_REAL_OUT")
	if out == "" {
		out = t.TempDir()
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.bin"))
	if len(files) == 0 {
		t.Fatalf("no *.bin images in %s", dir)
	}
	for _, f := range files {
		name := filepath.Base(f)
		src := readPNG(t, f)
		b := src.Bounds()
		w, h := b.Dx(), b.Dy()
		variant := func(tag string, gen func() *image.NRGBA) image.Image {
			p := filepath.Join(out, name+"."+tag+".png")
			if _, err := os.Stat(p); err == nil {
				return readPNG(t, p)
			}
			img := gen()
			fh, err := os.Create(p)
			if err != nil {
				t.Fatal(err)
			}
			defer fh.Close()
			if err := png.Encode(fh, img); err != nil {
				t.Fatal(err)
			}
			return img
		}
		ink := func() []bool {
			cv := buildPlanes(src, src, float64(w), float64(h), Rect{Width: float64(w), Height: float64(h)}, compareMaxSide)
			return cv.rp.ink
		}
		mask := ink() // canvas size; only used to pick the pixels to keep when generating
		cases := []struct {
			tag string
			img image.Image
		}{
			{"self", src},
			{"shift-0.5pct", variant("shift05", func() *image.NRGBA { return shifted(src, max(1, w/200), 0) })},
			{"shift-1pct", variant("shift1", func() *image.NRGBA { return shifted(src, max(1, w/100), 0) })},
			{"shift-2pct", variant("shift2", func() *image.NRGBA { return shifted(src, max(1, w/50), 0) })},
			{"shift-4pct", variant("shift4", func() *image.NRGBA { return shifted(src, max(1, w/25), 0) })},
			{"blur", variant("blur", func() *image.NRGBA { return boxBlur(src, 2) })},
			{"posterize", variant("poster", func() *image.NRGBA { return posterize(src, 24) })},
			{"ink-on-mean-flat", variant("flat", func() *image.NRGBA { return swapBackground(src, mask, false) })},
			{"linear-gradient-bg", variant("lingrad", func() *image.NRGBA { return swapBackground(src, mask, true) })},
		}
		for _, c := range cases {
			res, err := Compare(CompareInput{
				Drawn: c.img, Ref: src, FrameW: float64(w), FrameH: float64(h),
				Placed: Rect{Width: float64(w), Height: float64(h)},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%-18s %-22s iou %.3f missing %.3f extra %.3f ink ref %.3f drawn %.3f bg ref %+v drawn %+v", name, c.tag, res.IoU, res.Missing, res.Extra,
				res.InkShare.Reference, res.InkShare.Drawn, res.Background.ReferenceModel, res.Background.DrawnModel)
			switch c.tag {
			case "self":
				if res.IoU != 1 {
					t.Errorf("%s self iou %v", name, res.IoU)
				}
			case "blur":
				if res.IoU < 0.9 {
					t.Errorf("%s %s iou %v", name, c.tag, res.IoU)
				}
			case "ink-on-mean-flat", "linear-gradient-bg":
				if res.IoU < 0.8 && !(c.tag == "linear-gradient-bg" && res.Background.ReferenceModel.Kind == "flat") {
					t.Errorf("%s %s iou %v: the ink is the same, only the background changed", name, c.tag, res.IoU)
				}
			}
		}
	}
}

func readPNG(t *testing.T, p string) image.Image {
	t.Helper()
	fh, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	img, err := png.Decode(fh)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

// shifted moves the picture right by dx and down by dy pixels, repeating the edge.
func shifted(src image.Image, dx, dy int) *image.NRGBA {
	b := src.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			sx, sy := min(max(x-dx, 0), b.Dx()-1), min(max(y-dy, 0), b.Dy()-1)
			out.Set(x, y, src.At(b.Min.X+sx, b.Min.Y+sy))
		}
	}
	return out
}

// swapBackground replaces the pixels that are not ink (mask is on the compare canvas, which has
// the image's size when it is at most compareMaxSide px; otherwise the mask is resampled) with a
// flat color, or a plane fitted to them (a linear gradient).
func swapBackground(src image.Image, mask []bool, gradient bool) *image.NRGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	k := math.Min(1, float64(compareMaxSide)/float64(max(w, h)))
	cw := max(1, int(math.Round(float64(w)*k)))
	isInk := func(x, y int) bool {
		cx, cy := min(int(float64(x)*k), cw-1), int(float64(y)*k)
		if i := cy*cw + cx; i >= 0 && i < len(mask) {
			return mask[i]
		}
		return true
	}
	// least squares: channel = a + b*u + c*v over the background pixels, u,v in 0..1
	var n, su, sv, suu, suv, svv float64
	var sc, scu, scv [3]float64
	for y := 0; y < h; y += 2 {
		for x := 0; x < w; x += 2 {
			if isInk(x, y) {
				continue
			}
			u, v := float64(x)/float64(w), float64(y)/float64(h)
			c := color.NRGBAModel.Convert(src.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			ch := [3]float64{float64(c.R), float64(c.G), float64(c.B)}
			n++
			su += u
			sv += v
			suu += u * u
			suv += u * v
			svv += v * v
			for i := range 3 {
				sc[i] += ch[i]
				scu[i] += ch[i] * u
				scv[i] += ch[i] * v
			}
		}
	}
	var coef [3][3]float64
	for i := range 3 {
		if !gradient {
			coef[i] = [3]float64{sc[i] / n, 0, 0}
			continue
		}
		coef[i] = solve3([3][3]float64{{n, su, sv}, {su, suu, suv}, {sv, suv, svv}}, [3]float64{sc[i], scu[i], scv[i]})
	}
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			if isInk(x, y) {
				out.Set(x, y, src.At(b.Min.X+x, b.Min.Y+y))
				continue
			}
			u, v := float64(x)/float64(w), float64(y)/float64(h)
			cl := func(i int) uint8 {
				return uint8(math.Max(0, math.Min(255, math.Round(coef[i][0]+coef[i][1]*u+coef[i][2]*v))))
			}
			out.SetNRGBA(x, y, color.NRGBA{cl(0), cl(1), cl(2), 255})
		}
	}
	return out
}

// solve3 solves a 3x3 system by Cramer's rule.
func solve3(m [3][3]float64, r [3]float64) [3]float64 {
	det := func(a [3][3]float64) float64 {
		return a[0][0]*(a[1][1]*a[2][2]-a[1][2]*a[2][1]) - a[0][1]*(a[1][0]*a[2][2]-a[1][2]*a[2][0]) + a[0][2]*(a[1][0]*a[2][1]-a[1][1]*a[2][0])
	}
	d := det(m)
	var out [3]float64
	if math.Abs(d) < 1e-9 {
		return out
	}
	for c := range 3 {
		t := m
		for i := range 3 {
			t[i][c] = r[i]
		}
		out[c] = det(t) / d
	}
	return out
}

// boxBlur blurs with a 3x3 box, n times.
func boxBlur(src image.Image, n int) *image.NRGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	cur := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			cur.Set(x, y, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	for range n {
		next := image.NewNRGBA(cur.Bounds())
		for y := range h {
			for x := range w {
				var s [4]int
				k := 0
				for dy := -1; dy <= 1; dy++ {
					for dx := -1; dx <= 1; dx++ {
						c := cur.NRGBAAt(min(max(x+dx, 0), w-1), min(max(y+dy, 0), h-1))
						s[0] += int(c.R)
						s[1] += int(c.G)
						s[2] += int(c.B)
						s[3] += int(c.A)
						k++
					}
				}
				next.SetNRGBA(x, y, color.NRGBA{uint8(s[0] / k), uint8(s[1] / k), uint8(s[2] / k), uint8(s[3] / k)})
			}
		}
		cur = next
	}
	return cur
}

// posterize snaps every channel to steps of the given size.
func posterize(src image.Image, step int) *image.NRGBA {
	b := src.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	q := func(v uint8) uint8 { return uint8(min(255, (int(v)+step/2)/step*step)) }
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			c := color.NRGBAModel.Convert(src.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			out.SetNRGBA(x, y, color.NRGBA{q(c.R), q(c.G), q(c.B), c.A})
		}
	}
	return out
}
