package vision

import (
	"bytes"
	"image"
	"image/png"
	"math"
	"sort"
)

type xform struct{ dx, dy, s, th float64 }

func warpIoU(drawn, ref []bool, w, h int, n float64, t xform) float64 {
	cs, sn := math.Cos(t.th), math.Sin(t.th)
	ox, oy := float64(w)/2, float64(h)/2
	dx, dy := t.dx/n, t.dy/n
	inter, uni := 0, 0
	for y := range h {
		qy := float64(y) + 0.5 - oy - dy
		for x := range w {
			qx := float64(x) + 0.5 - ox - dx
			px := (qx*cs+qy*sn)/t.s + ox
			py := (-qx*sn+qy*cs)/t.s + oy
			d := false
			if ix, iy := int(math.Floor(px)), int(math.Floor(py)); px >= 0 && py >= 0 && ix < w && iy < h {
				d = drawn[iy*w+ix]
			}
			r := ref[y*w+x]
			if r && d {
				inter++
			}
			if r || d {
				uni++
			}
		}
	}
	if uni == 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

func shrink(m []bool, w, h, n int, frac float64) ([]bool, int, int) {
	if n <= 1 {
		return m, w, h
	}
	nw, nh := (w+n-1)/n, (h+n-1)/n
	out := make([]bool, nw*nh)
	for cy := range nh {
		for cx := range nw {
			cnt, tot := 0, 0
			for y := cy * n; y < min(h, cy*n+n); y++ {
				for x := cx * n; x < min(w, cx*n+n); x++ {
					tot++
					if m[y*w+x] {
						cnt++
					}
				}
			}
			out[cy*nw+cx] = float64(cnt) >= frac*float64(tot) && cnt > 0
		}
	}
	return out, nw, nh
}

func align(ref, drawn []bool, w, h int, fx, fy, iouBefore float64, rotate bool) *Alignment {
	id := &Alignment{
		Scale: 1, Origin: Point{X: r1(float64(w) / 2 * fx), Y: r1(float64(h) / 2 * fy)},
		IoUBefore: iouBefore, IoUAfter: iouBefore,
	}
	cur := coarseSearch(ref, drawn, w, h, rotate)

	nM := 1
	if max(w, h) > 400 {
		nM = (max(w, h) + 399) / 400
	}
	dm, mw, mh := shrink(drawn, w, h, nM, 0.5)
	rm, _, _ := shrink(ref, w, h, nM, 0.5)
	steps := []struct{ t, s, r float64 }{{8, 0.04, 2}, {4, 0.02, 1}, {2, 0.01, 0.5}, {1, 0.005, 0.25}, {0.5, 0.0025, 0.125}}
	for si, st := range steps {
		useMid := nM > 1 && si < 3
		eval := func(t xform) float64 {
			if useMid {
				return warpIoU(dm, rm, mw, mh, float64(nM), t)
			}
			return warpIoU(drawn, ref, w, h, 1, t)
		}
		curV := eval(cur)
		for range 80 {
			cands := []xform{
				{cur.dx + st.t, cur.dy, cur.s, cur.th}, {cur.dx - st.t, cur.dy, cur.s, cur.th},
				{cur.dx, cur.dy + st.t, cur.s, cur.th}, {cur.dx, cur.dy - st.t, cur.s, cur.th},
				{cur.dx, cur.dy, cur.s + st.s, cur.th}, {cur.dx, cur.dy, cur.s - st.s, cur.th},
			}
			if rotate {
				r := st.r * math.Pi / 180
				cands = append(cands, xform{cur.dx, cur.dy, cur.s, cur.th + r}, xform{cur.dx, cur.dy, cur.s, cur.th - r})
			}
			bi, bv := -1, curV
			for i, c := range cands {
				if c.s < 0.5 || c.s > 2 {
					continue
				}
				if v := eval(c); v > bv+1e-9 {
					bi, bv = i, v
				}
			}
			if bi < 0 {
				break
			}
			cur, curV = cands[bi], bv
		}
	}
	final := warpIoU(drawn, ref, w, h, 1, cur)
	if final <= iouBefore+0.002 {
		return id
	}
	id.DX, id.DY = r1(cur.dx*fx), r1(cur.dy*fy)
	id.Scale = math.Round(cur.s*1000) / 1000
	id.Rotation = r1(cur.th * 180 / math.Pi)
	id.IoUAfter = r3(final)
	id.Significant = final-iouBefore >= 0.02
	return id
}

func coarseSearch(ref, drawn []bool, w, h int, rotate bool) xform {
	n := max(1, (max(w, h)+127)/128)
	dm, cw, ch := shrink(drawn, w, h, n, 0.3)
	rm, _, _ := shrink(ref, w, h, n, 0.3)
	var pts []int
	for i, v := range dm {
		if v {
			pts = append(pts, i)
		}
	}
	nRef := countTrue(rm)
	if len(pts) == 0 || nRef == 0 {
		return xform{s: 1}
	}
	nDrawn := len(pts)
	if len(pts) > 3000 {
		stride := (len(pts) + 2999) / 3000
		var sub []int
		for i := 0; i < len(pts); i += stride {
			sub = append(sub, pts[i])
		}
		pts = sub
	}
	weight := float64(nDrawn) / float64(len(pts))
	R := max(2, max(cw, ch)/4)
	scales := []float64{1, 0.9, 1.1, 0.8, 1.25}
	thetas := []float64{0}
	if rotate {
		thetas = []float64{0, -5, 5, -10, 10}
		scales = []float64{1, 0.9, 1.1}
		R = max(2, max(cw, ch)/6)
	}
	var offs [][2]int
	for dy := -R; dy <= R; dy++ {
		for dx := -R; dx <= R; dx++ {
			offs = append(offs, [2]int{dx, dy})
		}
	}
	sort.SliceStable(offs, func(i, j int) bool {
		return offs[i][0]*offs[i][0]+offs[i][1]*offs[i][1] < offs[j][0]*offs[j][0]+offs[j][1]*offs[j][1]
	})
	ox, oy := float64(cw)/2, float64(ch)/2
	bestV, best := -1.0, xform{s: 1}
	bx := make([]int, len(pts))
	by := make([]int, len(pts))
	for _, thDeg := range thetas {
		th := thDeg * math.Pi / 180
		cs, sn := math.Cos(th), math.Sin(th)
		for _, s := range scales {
			for i, p := range pts {
				x, y := float64(p%cw)+0.5-ox, float64(p/cw)+0.5-oy
				bx[i] = int(math.Floor(ox + s*(x*cs-y*sn)))
				by[i] = int(math.Floor(oy + s*(x*sn+y*cs)))
			}
			area := s * s
			for _, o := range offs {
				dx, dy := o[0], o[1]
				hits := 0
				for i := range pts {
					x, y := bx[i]+dx, by[i]+dy
					if x >= 0 && y >= 0 && x < cw && y < ch && rm[y*cw+x] {
						hits++
					}
				}
				inter := float64(hits) * weight * area
				uni := float64(nDrawn)*area + float64(nRef) - inter
				v := inter / uni
				if v > bestV+1e-9 {
					bestV, best = v, xform{dx: float64(dx * n), dy: float64(dy * n), s: s, th: th}
				}
			}
		}
	}
	return best
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	_ = enc.Encode(&buf, img)
	return buf.Bytes()
}
