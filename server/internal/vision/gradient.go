package vision

import (
	"image"
	"math"
)

const (
	rampMinSpan = 8.0
	rampMaxRMS  = 5.0
	rampBins    = 10
)

type sample struct {
	x, y float64
	c    [3]float64
}

type rampFit struct {
	radial bool
	dx, dy float64
	cx, cy float64
	rms    float64
	span   float64
	bbox   image.Rectangle
	gw, gh float64
}

func fitRamp(px *pixels, tiles []tileStat, members []int, tx int) *rampFit {
	bb := image.Rectangle{Min: image.Pt(px.w, px.h)}
	total := 0
	for _, m := range members {
		t := tiles[m]
		bb = bb.Union(image.Rect(t.x0, t.y0, t.x1, t.y1))
		total += (t.x1 - t.x0) * (t.y1 - t.y0)
	}
	stride := max(1, int(math.Ceil(math.Sqrt(float64(total)/12000))))
	var ss []sample
	for _, m := range members {
		t := tiles[m]
		for y := t.y0; y < t.y1; y += stride {
			for x := t.x0; x < t.x1; x += stride {
				i := y*px.w + x
				if px.opaque[i] {
					ss = append(ss, sample{float64(x) + 0.5, float64(y) + 0.5, [3]float64{float64(px.rgb[i*3]), float64(px.rgb[i*3+1]), float64(px.rgb[i*3+2])}})
				}
			}
		}
	}
	n := float64(len(ss))
	if n < 32 {
		return nil
	}
	var xm, ym float64
	var cm [3]float64
	for _, s := range ss {
		xm += s.x
		ym += s.y
		for c := range 3 {
			cm[c] += s.c[c]
		}
	}
	xm, ym = xm/n, ym/n
	for c := range 3 {
		cm[c] /= n
	}
	var sxx, sxy, syy float64
	var sxc, syc, scc [3]float64
	for _, s := range ss {
		dx, dy := s.x-xm, s.y-ym
		sxx += dx * dx
		sxy += dx * dy
		syy += dy * dy
		for c := range 3 {
			dc := s.c[c] - cm[c]
			sxc[c] += dx * dc
			syc[c] += dy * dc
			scc[c] += dc * dc
		}
	}
	det := sxx*syy - sxy*sxy
	if det < 1e-6 {
		return nil
	}
	var b, cc [3]float64
	var sse float64
	var m11, m12, m22 float64
	for c := range 3 {
		b[c] = (sxc[c]*syy - syc[c]*sxy) / det
		cc[c] = (syc[c]*sxx - sxc[c]*sxy) / det
		sse += math.Max(0, scc[c]-b[c]*sxc[c]-cc[c]*syc[c])
		m11 += b[c] * b[c]
		m12 += b[c] * cc[c]
		m22 += cc[c] * cc[c]
	}
	rmsLin := math.Sqrt(sse / (3 * n))
	th := 0.5 * math.Atan2(2*m12, m11-m22)
	vx, vy := math.Cos(th), math.Sin(th)
	var gsum float64
	for c := range 3 {
		gsum += b[c]*vx + cc[c]*vy
	}
	if gsum < 0 {
		vx, vy = -vx, -vy
	}
	bw, bh := float64(bb.Dx()), float64(bb.Dy())
	L := math.Abs(bw*vx) + math.Abs(bh*vy)
	spanLin := 0.0
	for c := range 3 {
		spanLin = math.Max(spanLin, math.Abs(b[c]*vx+cc[c]*vy)*L)
	}
	lin := &rampFit{dx: vx, dy: vy, rms: rmsLin, span: spanLin, bbox: bb, gw: bw, gh: bh}

	var rad *rampFit
	if len(members) >= 4 {
		rad = fitRadial(px, tiles, members, tx, ss, bb)
	}
	switch {
	case rad != nil && rad.rms < 0.7*rmsLin && rad.rms <= rampMaxRMS && rad.span >= rampMinSpan:
		return rad
	case rmsLin <= rampMaxRMS && spanLin >= rampMinSpan:
		return lin
	}
	return nil
}

func fitRadial(px *pixels, tiles []tileStat, members []int, tx int, ss []sample, bb image.Rectangle) *rampFit {
	in := map[int]bool{}
	mean := map[int]float64{}
	for _, m := range members {
		in[m] = true
		t := tiles[m]
		var s float64
		n := 0
		for y := t.y0; y < t.y1; y++ {
			for x := t.x0; x < t.x1; x++ {
				if i := y*px.w + x; px.opaque[i] {
					s += 0.299*float64(px.rgb[i*3]) + 0.587*float64(px.rgb[i*3+1]) + 0.114*float64(px.rgb[i*3+2])
					n++
				}
			}
		}
		if n > 0 {
			mean[m] = s / float64(n)
		}
	}
	var a11, a12, a22, b1, b2 float64
	for _, m := range members {
		t := tiles[m]
		pcx, pcy := float64(t.x0+t.x1)/2, float64(t.y0+t.y1)/2
		grad := func(lo, hi int, dist float64) float64 {
			l, lok := mean[lo]
			h, hok := mean[hi]
			switch {
			case in[lo] && in[hi] && lok && hok:
				return (h - l) / (2 * dist)
			case in[hi] && hok:
				return (h - mean[m]) / dist
			case in[lo] && lok:
				return (mean[m] - l) / dist
			}
			return 0
		}
		gx := grad(m-1, m+1, float64(t.x1-t.x0))
		gy := grad(m-tx, m+tx, float64(t.y1-t.y0))
		mag := math.Hypot(gx, gy)
		if mag < 1e-3 {
			continue
		}
		ux, uy := gx/mag, gy/mag
		w := mag * mag
		p11, p12, p22 := 1-ux*ux, -ux*uy, 1-uy*uy
		a11 += w * p11
		a12 += w * p12
		a22 += w * p22
		b1 += w * (p11*pcx + p12*pcy)
		b2 += w * (p12*pcx + p22*pcy)
	}
	det := a11*a22 - a12*a12
	if det < 1e-9 {
		return nil
	}
	cx := (b1*a22 - b2*a12) / det
	cy := (a11*b2 - a12*b1) / det
	bw, bh := float64(bb.Dx()), float64(bb.Dy())
	if cx < float64(bb.Min.X)-0.5*bw || cx > float64(bb.Max.X)+0.5*bw || cy < float64(bb.Min.Y)-0.5*bh || cy > float64(bb.Max.Y)+0.5*bh {
		return nil
	}
	const nb = 16
	rho := make([]float64, len(ss))
	rmax := 0.0
	for i, s := range ss {
		rho[i] = math.Hypot((s.x-cx)/bw, (s.y-cy)/bh)
		rmax = math.Max(rmax, rho[i])
	}
	if rmax <= 0 {
		return nil
	}
	var sum [nb][3]float64
	var sq [nb][3]float64
	var cnt [nb]float64
	for i, s := range ss {
		k := min(int(rho[i]/rmax*nb), nb-1)
		cnt[k]++
		for c := range 3 {
			sum[k][c] += s.c[c]
			sq[k][c] += s.c[c] * s.c[c]
		}
	}
	var sse, n float64
	lo := [3]float64{255, 255, 255}
	hi := [3]float64{}
	for k := range nb {
		if cnt[k] == 0 {
			continue
		}
		for c := range 3 {
			mu := sum[k][c] / cnt[k]
			sse += sq[k][c] - cnt[k]*mu*mu
			lo[c], hi[c] = math.Min(lo[c], mu), math.Max(hi[c], mu)
		}
		n += cnt[k]
	}
	span := 0.0
	for c := range 3 {
		span = math.Max(span, hi[c]-lo[c])
	}
	return &rampFit{radial: true, cx: cx, cy: cy, rms: math.Sqrt(math.Max(0, sse) / (3 * n)), span: span, bbox: bb, gw: bw, gh: bh}
}

func rampGradient(px *pixels, r image.Rectangle, f *rampFit, on func(x, y int) bool) *Gradient {
	rw, rh := float64(r.Dx()), float64(r.Dy())
	if rw < 2 || rh < 2 {
		return nil
	}
	type acc struct {
		sum [3]float64
		n   float64
	}
	var bins [rampBins]acc
	g := &Gradient{}
	var tOf func(x, y float64) float64
	if f.radial {
		cx, cy := f.cx, f.cy
		rmax := 0.0
		for y := r.Min.Y; y < r.Max.Y; y++ {
			for x := r.Min.X; x < r.Max.X; x++ {
				rmax = math.Max(rmax, math.Hypot((float64(x)+0.5-cx)/rw, (float64(y)+0.5-cy)/rh))
			}
		}
		rmax = math.Min(2, math.Max(rmax, 0.05))
		tOf = func(x, y float64) float64 { return math.Hypot((x-cx)/rw, (y-cy)/rh) / rmax }
		g.Type = "radial"
		ccx := math.Min(1, math.Max(0, (cx-float64(r.Min.X))/rw))
		ccy := math.Min(1, math.Max(0, (cy-float64(r.Min.Y))/rh))
		g.Cx, g.Cy, g.Radius = new(r3(ccx)), new(r3(ccy)), new(r3(rmax))
	} else {
		dx, dy := f.dx, f.dy
		L := math.Abs(rw*dx) + math.Abs(rh*dy)
		mx, my := float64(r.Min.X)+rw/2, float64(r.Min.Y)+rh/2
		tOf = func(x, y float64) float64 { return ((x-mx)*dx+(y-my)*dy)/L + 0.5 }
		ang := math.Atan2(dx, -dy) * 180 / math.Pi
		ang = math.Mod(ang+360, 360)
		for _, s := range []float64{0, 45, 90, 135, 180, 225, 270, 315, 360} {
			if math.Abs(ang-s) < 2 {
				ang = math.Mod(s, 360)
			}
		}
		g.Type = "linear"
		g.Angle = new(math.Round(ang*10) / 10)
	}
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			i := y*px.w + x
			if !px.opaque[i] || (on != nil && !on(x, y)) {
				continue
			}
			t := tOf(float64(x)+0.5, float64(y)+0.5)
			k := min(max(int(t*rampBins), 0), rampBins-1)
			bins[k].n++
			for c := range 3 {
				bins[k].sum[c] += float64(px.rgb[i*3+c])
			}
		}
	}
	var ts []float64
	var cols [][3]float64
	for k, b := range bins {
		if b.n < 3 {
			continue
		}
		ts = append(ts, (float64(k)+0.5)/rampBins)
		cols = append(cols, [3]float64{b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n})
	}
	if len(ts) < 2 {
		return nil
	}
	ext := func(t0 float64, c0, c1 [3]float64, t1, to float64) [3]float64 {
		var o [3]float64
		for c := range 3 {
			o[c] = math.Min(255, math.Max(0, c0[c]+(c1[c]-c0[c])*(to-t0)/(t1-t0)))
		}
		return o
	}
	n := len(ts)
	startC := ext(ts[0], cols[0], cols[1], ts[1], 0)
	endC := ext(ts[n-1], cols[n-1], cols[n-2], ts[n-2], 1)
	ts = append(append([]float64{0}, ts...), 1)
	cols = append(append([][3]float64{startC}, cols...), endC)
	keep := []int{0, len(ts) - 1}
	keep = stopPolyline(ts, cols, 0, len(ts)-1, 3, keep)
	sortInts(keep)
	for _, k := range keep {
		g.Stops = append(g.Stops, GradientStop{Color: hexOf(cols[k]), Offset: r3(ts[k])})
	}
	return g
}

func sortInts(a []int) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func stopPolyline(ts []float64, cols [][3]float64, i, j int, tol float64, keep []int) []int {
	if j-i < 2 {
		return keep
	}
	worst, wk := 0.0, -1
	for k := i + 1; k < j; k++ {
		f := (ts[k] - ts[i]) / (ts[j] - ts[i])
		d := 0.0
		for c := range 3 {
			d = math.Max(d, math.Abs(cols[k][c]-(cols[i][c]+(cols[j][c]-cols[i][c])*f)))
		}
		if d > worst {
			worst, wk = d, k
		}
	}
	if wk < 0 || worst <= tol {
		return keep
	}
	keep = append(keep, wk)
	keep = stopPolyline(ts, cols, i, wk, tol, keep)
	return stopPolyline(ts, cols, wk, j, tol, keep)
}
