package vision

import (
	"image"
	"math"
	"sort"
)

const (
	edgeThreshold  = 0.06 // OKLab distance between neighbours that marks a color transition
	edgeWeight     = 0.3  // transition pixels count less when looking for the palette
	mergeThreshold = 0.045
	transitionDist = 0.035
)

type labf struct{ L, A, B float32 }

func (p labf) lab() lab { return lab{float64(p.L), float64(p.A), float64(p.B)} }

func (p labf) dist2(q lab) float32 {
	dl, da, db := p.L-float32(q.L), p.A-float32(q.A), p.B-float32(q.B)
	return dl*dl + da*da + db*db
}

// pixels is the working copy of the analyzed raster: OKLab per pixel plus which pixels are
// opaque enough to count and which sit on a color transition (anti-aliasing, edges).
type pixels struct {
	w, h   int
	lab    []labf
	opaque []bool
	edge   []bool
	rgb    []uint8 // r,g,b triples
}

func prepare(img *image.NRGBA) *pixels {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	p := &pixels{w: w, h: h, lab: make([]labf, w*h), opaque: make([]bool, w*h), edge: make([]bool, w*h), rgb: make([]uint8, w*h*3)}
	for y := range h {
		row := img.Pix[y*img.Stride : y*img.Stride+w*4]
		for x := range w {
			i := y*w + x
			r, g, bl, a := row[x*4], row[x*4+1], row[x*4+2], row[x*4+3]
			if a < 128 {
				continue
			}
			p.opaque[i] = true
			p.rgb[i*3], p.rgb[i*3+1], p.rgb[i*3+2] = r, g, bl
			c := labFromBytes(r, g, bl)
			p.lab[i] = labf{float32(c.L), float32(c.A), float32(c.B)}
		}
	}
	thr := float32(edgeThreshold * edgeThreshold)
	mark := func(i, j int) {
		if p.opaque[i] != p.opaque[j] {
			if p.opaque[i] {
				p.edge[i] = true
			}
			if p.opaque[j] {
				p.edge[j] = true
			}
			return
		}
		if !p.opaque[i] {
			return
		}
		if p.lab[i].dist2(p.lab[j].lab()) > thr {
			p.edge[i], p.edge[j] = true, true
		}
	}
	for y := range h {
		for x := range w {
			i := y*w + x
			if x+1 < w {
				mark(i, i+1)
			}
			if y+1 < h {
				mark(i, i+w)
			}
		}
	}
	return p
}

type bucket struct {
	n, ne float64
	sum   [3]float64
	sumNE [3]float64
	lab   lab
	w     float64
}

type cluster struct {
	c     lab
	n, ne float64
	sum   [3]float64
	sumNE [3]float64
}

func (c *cluster) absorb(o *cluster) {
	t := c.n + o.n
	if t > 0 {
		c.c = lab{(c.c.L*c.n + o.c.L*o.n) / t, (c.c.A*c.n + o.c.A*o.n) / t, (c.c.B*c.n + o.c.B*o.n) / t}
	}
	c.n += o.n
	c.ne += o.ne
	for i := range 3 {
		c.sum[i] += o.sum[i]
		c.sumNE[i] += o.sumNE[i]
	}
}

func (c *cluster) rgb() [3]float64 {
	var out [3]float64
	neN := c.n - c.ne
	switch {
	case neN > 0:
		for i := range 3 {
			out[i] = c.sumNE[i] / neN
		}
	case c.n > 0:
		for i := range 3 {
			out[i] = c.sum[i] / c.n
		}
	}
	return out
}

type paletteColor struct {
	lab lab
	rgb [3]float64
	hex string
}

// quantize returns the palette (largest first) for the opaque pixels. It clusters a 5-bit
// histogram with a deterministic weighted k-means in OKLab, throws away clusters that are only
// anti-aliasing between two other colors, merges near-identical ones and trims to maxColors.
func quantize(p *pixels, maxColors int, minShare float64) []paletteColor {
	hist := make([]bucket, 32768)
	total := 0.0
	for i := range p.opaque {
		if !p.opaque[i] {
			continue
		}
		r, g, b := p.rgb[i*3], p.rgb[i*3+1], p.rgb[i*3+2]
		k := int(r>>3)<<10 | int(g>>3)<<5 | int(b>>3)
		bk := &hist[k]
		bk.n++
		bk.sum[0] += float64(r)
		bk.sum[1] += float64(g)
		bk.sum[2] += float64(b)
		if p.edge[i] {
			bk.ne++
		} else {
			bk.sumNE[0] += float64(r)
			bk.sumNE[1] += float64(g)
			bk.sumNE[2] += float64(b)
		}
		total++
	}
	if total == 0 {
		return nil
	}
	var bs []bucket
	for k := range hist {
		bk := hist[k]
		if bk.n == 0 {
			continue
		}
		bk.lab = labFromRGBf(bk.sum[0]/bk.n, bk.sum[1]/bk.n, bk.sum[2]/bk.n)
		bk.w = (bk.n - bk.ne) + edgeWeight*bk.ne
		bs = append(bs, bk)
	}
	k := min(len(bs), min(maxColors*2, 16))
	clusters := kmeans(bs, k)
	clusters = dropTransitions(clusters)
	clusters = mergeClose(clusters)
	sort.SliceStable(clusters, func(i, j int) bool { return clusters[i].n > clusters[j].n })
	kept := clusters[:0]
	for i, c := range clusters {
		if i == 0 || c.n/total >= minShare {
			kept = append(kept, c)
		}
	}
	clusters = kept
	if len(clusters) > maxColors {
		clusters = clusters[:maxColors]
	}
	out := make([]paletteColor, len(clusters))
	for i := range clusters {
		rgb := clusters[i].rgb()
		out[i] = paletteColor{lab: labFromRGBf(rgb[0], rgb[1], rgb[2]), rgb: rgb, hex: hexOf(rgb)}
	}
	return out
}

func kmeans(bs []bucket, k int) []cluster {
	centers := make([]lab, 0, k)
	dmin := make([]float64, len(bs))
	first := 0
	for i := range bs {
		if bs[i].w > bs[first].w {
			first = i
		}
		dmin[i] = math.MaxFloat64
	}
	centers = append(centers, bs[first].lab)
	for len(centers) < k {
		last := centers[len(centers)-1]
		best, bestV := -1, 0.0
		for i := range bs {
			if d := bs[i].lab.dist2(last); d < dmin[i] {
				dmin[i] = d
			}
			if v := bs[i].w * dmin[i]; v > bestV {
				best, bestV = i, v
			}
		}
		if best < 0 {
			break
		}
		centers = append(centers, bs[best].lab)
	}
	assignTo := make([]int, len(bs))
	for i := range assignTo {
		assignTo[i] = -1
	}
	for range 20 {
		changed := false
		for i := range bs {
			bi, bd := 0, math.MaxFloat64
			for c := range centers {
				if d := bs[i].lab.dist2(centers[c]); d < bd {
					bi, bd = c, d
				}
			}
			if assignTo[i] != bi {
				assignTo[i] = bi
				changed = true
			}
		}
		if !changed {
			break
		}
		sums := make([]lab, len(centers))
		ws := make([]float64, len(centers))
		for i := range bs {
			c := assignTo[i]
			sums[c].L += bs[i].lab.L * bs[i].w
			sums[c].A += bs[i].lab.A * bs[i].w
			sums[c].B += bs[i].lab.B * bs[i].w
			ws[c] += bs[i].w
		}
		for c := range centers {
			if ws[c] > 0 {
				centers[c] = lab{sums[c].L / ws[c], sums[c].A / ws[c], sums[c].B / ws[c]}
			}
		}
	}
	cl := make([]cluster, len(centers))
	for c := range cl {
		cl[c].c = centers[c]
	}
	for i := range bs {
		c := &cl[assignTo[i]]
		c.n += bs[i].n
		c.ne += bs[i].ne
		for j := range 3 {
			c.sum[j] += bs[i].sum[j]
			c.sumNE[j] += bs[i].sumNE[j]
		}
	}
	out := cl[:0]
	for _, c := range cl {
		if c.n > 0 {
			out = append(out, c)
		}
	}
	return out
}

// dropTransitions removes clusters made almost only of transition pixels whose color lies on
// the line between two other clusters: the gray rim between black and white shapes.
func dropTransitions(cl []cluster) []cluster {
	order := make([]int, len(cl))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return cl[order[a]].n < cl[order[b]].n })
	dropped := make([]bool, len(cl))
	for _, ci := range order {
		c := cl[ci]
		if c.n == 0 || c.ne/c.n < 0.6 {
			continue
		}
		var alive []int
		for j := range cl {
			if j != ci && !dropped[j] {
				alive = append(alive, j)
			}
		}
		found := false
		for a := 0; a < len(alive) && !found; a++ {
			for b := a + 1; b < len(alive); b++ {
				if onBlend(&c, &cl[alive[a]], &cl[alive[b]]) {
					found = true
					break
				}
			}
		}
		if found {
			dropped[ci] = true
		}
	}
	out := make([]cluster, 0, len(cl))
	for i := range cl {
		if !dropped[i] {
			out = append(out, cl[i])
		}
	}
	return out
}

// onBlend reports whether cluster c has the color of a mix of a and b. Anti-aliasing and
// resampling blend sRGB values, so the test projects c onto the a-b segment in sRGB and compares
// the blended color with c in OKLab.
func onBlend(c, a, b *cluster) bool {
	ca, cb, cc := a.sumAll(), b.sumAll(), c.sumAll()
	var ab, ac [3]float64
	den, num := 0.0, 0.0
	for i := range 3 {
		ab[i], ac[i] = cb[i]-ca[i], cc[i]-ca[i]
		den += ab[i] * ab[i]
		num += ab[i] * ac[i]
	}
	if den < 1 {
		return false
	}
	t := math.Max(0, math.Min(1, num/den))
	mix := [3]float64{ca[0] + t*ab[0], ca[1] + t*ab[1], ca[2] + t*ab[2]}
	return labFromRGBf(mix[0], mix[1], mix[2]).dist2(labFromRGBf(cc[0], cc[1], cc[2])) < transitionDist*transitionDist
}

func (c *cluster) sumAll() [3]float64 {
	return [3]float64{c.sum[0] / c.n, c.sum[1] / c.n, c.sum[2] / c.n}
}

func mergeClose(cl []cluster) []cluster {
	for {
		bi, bj, bd := -1, -1, mergeThreshold*mergeThreshold
		for i := range cl {
			for j := i + 1; j < len(cl); j++ {
				if d := cl[i].c.dist2(cl[j].c); d < bd {
					bi, bj, bd = i, j, d
				}
			}
		}
		if bi < 0 {
			return cl
		}
		cl[bi].absorb(&cl[bj])
		cl = append(cl[:bj], cl[bj+1:]...)
	}
}

// assignLabels gives every opaque pixel its nearest palette color (255 = transparent).
func assignLabels(p *pixels, pal []paletteColor) []uint8 {
	labels := make([]uint8, p.w*p.h)
	for i := range labels {
		if !p.opaque[i] {
			labels[i] = 255
			continue
		}
		bi, bd := 0, float32(math.MaxFloat32)
		for c := range pal {
			if d := p.lab[i].dist2(pal[c].lab); d < bd {
				bi, bd = c, d
			}
		}
		labels[i] = uint8(bi)
	}
	return labels
}
