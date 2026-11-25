//go:build realimg

package vision

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestTraceEdgeReal(t *testing.T) {
	dir := os.Getenv("PAPRIKA_REAL_IMAGES")
	if dir == "" {
		t.Skip("PAPRIKA_REAL_IMAGES is not set")
	}
	only := map[string]bool{}
	for _, n := range strings.Split(os.Getenv("PAPRIKA_REAL_ONLY"), ",") {
		if n = strings.TrimSpace(n); n != "" {
			only[n] = true
		}
	}
	crops := map[string]image.Rectangle{}
	for _, e := range strings.Split(os.Getenv("PAPRIKA_REAL_CROP"), ";") {
		var x, y, w, h int
		if i := strings.Index(e, "="); i > 0 {
			if _, err := fmt.Sscanf(e[i+1:], "%d,%d,%d,%d", &x, &y, &w, &h); err == nil {
				crops[strings.TrimSpace(e[:i])] = image.Rect(x, y, x+w, y+h)
			}
		}
	}
	out := os.Getenv("PAPRIKA_REAL_OUT")
	files, _ := filepath.Glob(filepath.Join(dir, "*.bin"))
	if len(files) == 0 {
		t.Fatalf("no *.bin images in %s", dir)
	}
	sort.Strings(files)
	t.Logf("%-18s %5s %6s %6s %6s %6s %6s %7s %6s %6s %6s %7s", "image", "paths", "iou", "edgeMn", "edgeP95", "score", "sliver", "seamPx", "seam/M", "corner", "points", "ms")
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".bin")
		if len(only) > 0 && !only[name] {
			continue
		}
		src := readPNG(t, f)
		if r, ok := crops[name]; ok {
			c := image.NewNRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
			draw.Draw(c, c.Bounds(), src, r.Min, draw.Src)
			src = c
		}
		b := src.Bounds()
		const fw = 1200.0
		fh := fw * float64(b.Dy()) / float64(b.Dx())
		start := time.Now()
		res, err := Trace(src, TraceOptions{Scale: fw / float64(b.Dx()), MaxPaths: 400, MaxColors: envInt("PAPRIKA_REAL_COLORS"), MinArea: float64(envInt("PAPRIKA_REAL_MINAREA_PPM")) / 1e6})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		ms := time.Since(start).Milliseconds()
		const zoom = 3
		zw, zh := int(fw)*zoom, int(math.Round(fh))*zoom
		drawn := rasterizePaths(t, res, zw, zh, zoom)
		cv := buildPlanes(drawn.img, src, float64(zw), float64(zh), Rect{Width: float64(zw), Height: float64(zh)}, float64(zw))
		inter, uni := 0, 0
		for i := range cv.rp.ink {
			a, c := cv.rp.ink[i], cv.dp.ink[i]
			if a && c {
				inter++
			}
			if a || c {
				uni++
			}
		}
		e := edgeMetrics(cv.rp.ink, cv.dp.ink, cv.w, cv.h, 1.0/zoom, 0)
		seams := seamPixels(cv.rp.ink, cv.dp.ink, cv.w, cv.h)
		corners := 0
		for _, p := range res.Paths {
			corners += p.Corners
		}
		slivers := 0
		for i, p := range res.Paths {
			if drawn.perim[i] > 0 && 2*drawn.area[i]/drawn.perim[i] < 2 {
				_ = p
				slivers++
			}
		}
		em, e95, es := 0.0, 0.0, 0.0
		if e != nil {
			em, e95, es = e.Mean, e.P95, e.Score
		}
		t.Logf("%-18s %5d %6.3f %6.3f %7.3f %6.3f %6d %7d %6.0f %6d %6d %7d", name, len(res.Paths), float64(inter)/float64(uni), em, e95, es, slivers, seams,
			float64(seams)/float64(cv.w*cv.h)*1e6, corners, res.Points, ms)
		if out != "" {
			_ = os.MkdirAll(out, 0o755)
			if fh, err := os.Create(filepath.Join(out, name+".trace3x.png")); err == nil {
				_ = png.Encode(fh, drawn.img)
				fh.Close()
			}
			d := image.NewNRGBA(image.Rect(0, 0, cv.w, cv.h))
			for i := range cv.rp.ink {
				c := color.NRGBA{255, 255, 255, 255}
				switch {
				case cv.rp.ink[i] && cv.dp.ink[i]:
					c = color.NRGBA{150, 150, 150, 255}
				case cv.rp.ink[i]:
					c = color.NRGBA{255, 0, 0, 255}
				case cv.dp.ink[i]:
					c = color.NRGBA{0, 0, 255, 255}
				}
				d.SetNRGBA(i%cv.w, i/cv.w, c)
			}
			if fh, err := os.Create(filepath.Join(out, name+".diff3x.png")); err == nil {
				_ = png.Encode(fh, d)
				fh.Close()
			}
		}
	}
}

func seamPixels(ref, drawn []bool, w, h int) int {
	const reach = 3
	near := func(x, y, dx, dy int) bool {
		for k := 1; k <= reach; k++ {
			nx, ny := x+dx*k, y+dy*k
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				return false
			}
			if drawn[ny*w+nx] {
				return true
			}
		}
		return false
	}
	n := 0
	for y := range h {
		for x := range w {
			i := y*w + x
			if drawn[i] || !ref[i] {
				continue
			}
			if (near(x, y, -1, 0) && near(x, y, 1, 0)) || (near(x, y, 0, -1) && near(x, y, 0, 1)) {
				n++
			}
		}
	}
	return n
}

type rendered struct {
	img         *image.NRGBA
	area, perim []float64
}

func rasterizePaths(t *testing.T, res *TraceResult, w, h, zoom int) rendered {
	t.Helper()
	bg := color.NRGBA{255, 255, 255, 255}
	if res.Background.Color != "" {
		if r, g, b, ok := hexRGB(res.Background.Color); ok {
			bg = color.NRGBA{r, g, b, 255}
		}
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = bg.R, bg.G, bg.B, 255
	}
	out := rendered{img: img}
	cov := make([]float32, w)
	const sub = 4
	for _, p := range res.Paths {
		rings := flatten(t, p.D)
		r, g, b, _ := hexRGB(p.Color)
		var edges [][2]pt
		minY, maxY := math.MaxFloat64, -math.MaxFloat64
		perim := 0.0
		for _, rg := range rings {
			for i := range rg {
				a, c := rg[i].mul(float64(zoom)), rg[(i+1)%len(rg)].mul(float64(zoom))
				edges = append(edges, [2]pt{a, c})
				minY, maxY = math.Min(minY, a.y), math.Max(maxY, a.y)
				perim += dist(a, c) / float64(zoom)
			}
		}
		area := 0.0
		y0, y1 := max(0, int(math.Floor(minY))), min(h-1, int(math.Ceil(maxY)))
		for y := y0; y <= y1; y++ {
			for i := range cov {
				cov[i] = 0
			}
			touched := false
			for s := range sub {
				sy := float64(y) + (float64(s)+0.5)/sub
				var xs []float64
				for _, e := range edges {
					a, c := e[0], e[1]
					if (a.y > sy) != (c.y > sy) {
						xs = append(xs, a.x+(sy-a.y)*(c.x-a.x)/(c.y-a.y))
					}
				}
				sort.Float64s(xs)
				for k := 0; k+1 < len(xs); k += 2 {
					x0, x1 := math.Max(0, xs[k]), math.Min(float64(w), xs[k+1])
					if x1 <= x0 {
						continue
					}
					touched = true
					for x := int(x0); x <= int(math.Min(float64(w-1), x1)); x++ {
						ov := math.Min(x1, float64(x+1)) - math.Max(x0, float64(x))
						if ov > 0 {
							cov[x] += float32(ov / sub)
						}
					}
				}
			}
			if !touched {
				continue
			}
			for x := range w {
				c := cov[x]
				if c <= 0 {
					continue
				}
				c = min(c, 1)
				area += float64(c)
				o := y*img.Stride + x*4
				img.Pix[o] = uint8(float32(img.Pix[o])*(1-c) + float32(r)*c + 0.5)
				img.Pix[o+1] = uint8(float32(img.Pix[o+1])*(1-c) + float32(g)*c + 0.5)
				img.Pix[o+2] = uint8(float32(img.Pix[o+2])*(1-c) + float32(b)*c + 0.5)
			}
		}
		out.area = append(out.area, area/float64(zoom*zoom))
		out.perim = append(out.perim, perim)
	}
	return out
}

func hexRGB(s string) (r, g, b uint8, ok bool) {
	var v uint32
	if _, err := fmt.Sscanf(strings.TrimPrefix(s, "#"), "%06x", &v); err != nil {
		return 0, 0, 0, false
	}
	return uint8(v >> 16), uint8(v >> 8), uint8(v), true
}

func envInt(name string) int {
	var v int
	_, _ = fmt.Sscanf(os.Getenv(name), "%d", &v)
	return v
}
