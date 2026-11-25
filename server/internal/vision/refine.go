package vision

import (
	"image"
	"math"
	"slices"
	"sort"
)

const (
	traceHiMax   = 2000
	pureDist     = 0.03
	blendTol     = 0.05
	thinRadius   = 1
	thinShare    = 0.85
	sliverSide   = 0.25
	sliverBlend  = 0.045
	absorbRounds = 8
	edgeIso      = 0.4
	candRadius   = 2
)

func sliverComps(ids []int32, labels []uint8, comps []comp, pal []paletteColor, px *pixels, aw, ah, minPx int) []bool {
	sliver := make([]bool, len(comps)+1)
	thin := make([]int, len(comps)+1)
	sums := make([][3]float64, len(comps)+1)
	contacts := make([]map[uint8]int, len(comps)+1)
	for y := range ah {
		for x := range aw {
			id := ids[y*aw+x]
			if id == 0 || comps[id-1].area < minPx {
				continue
			}
			for c := range 3 {
				sums[id][c] += float64(px.rgb[(y*aw+x)*3+c])
			}
			isThin := false
			for dy := -thinRadius; dy <= thinRadius && !isThin; dy++ {
				for dx := -thinRadius; dx <= thinRadius; dx++ {
					nx, ny := x+dx, y+dy
					if nx < 0 || ny < 0 || nx >= aw || ny >= ah {
						continue
					}
					if ids[ny*aw+nx] != id {
						isThin = true
						break
					}
				}
			}
			if isThin {
				thin[id]++
			}
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nx, ny := x+d[0], y+d[1]
				if nx < 0 || ny < 0 || nx >= aw || ny >= ah {
					continue
				}
				if l := labels[ny*aw+nx]; l != 255 && ids[ny*aw+nx] != id {
					if contacts[id] == nil {
						contacts[id] = map[uint8]int{}
					}
					contacts[id][l]++
				}
			}
		}
	}
	for i, c := range comps {
		id := i + 1
		if c.area < minPx || float64(thin[id]) < thinShare*float64(c.area) || len(contacts[id]) < 2 {
			continue
		}
		total := 0
		for _, n := range contacts[id] {
			total += n
		}
		var sides []uint8
		for l, n := range contacts[id] {
			if float64(n) >= sliverSide*float64(total) {
				sides = append(sides, l)
			}
		}
		slices.Sort(sides)
		n := float64(c.area)
		mean := [3]float64{sums[id][0] / n, sums[id][1] / n, sums[id][2] / n}
	pairs:
		for a := 0; a < len(sides); a++ {
			for b := a + 1; b < len(sides); b++ {
				pa, pb := pal[sides[a]], pal[sides[b]]
				if pa.hex == pb.hex {
					continue
				}
				if t, res := blendFit(mean, pa.rgb, pb.rgb); t > 0.1 && t < 0.9 && res < sliverBlend {
					sliver[id] = true
					break pairs
				}
			}
		}
	}
	return sliver
}

func blendFit(c, a, b [3]float64) (t, resid float64) {
	var ab, ac [3]float64
	den, num := 0.0, 0.0
	for i := range 3 {
		ab[i], ac[i] = b[i]-a[i], c[i]-a[i]
		den += ab[i] * ab[i]
		num += ab[i] * ac[i]
	}
	if den < 1 {
		return 0, math.MaxFloat64
	}
	t = math.Max(0, math.Min(1, num/den))
	mix := [3]float64{a[0] + t*ab[0], a[1] + t*ab[1], a[2] + t*ab[2]}
	return t, math.Sqrt(labFromRGBf(mix[0], mix[1], mix[2]).dist2(labFromRGBf(c[0], c[1], c[2])))
}

func absorb(ids []int32, real []bool, comps []comp, px *pixels, pal []paletteColor, aw, ah int) []int32 {
	out := append([]int32(nil), ids...)
	isReal := func(id int32) bool { return id != 0 && real[id] }
	var todo []int
	for i, id := range ids {
		if id != 0 && !real[id] {
			todo = append(todo, i)
		}
	}
	for range absorbRounds {
		if len(todo) == 0 {
			break
		}
		next := make(map[int]int32, len(todo))
		var left []int
		for _, i := range todo {
			x, y := i%aw, i/aw
			best, bd := int32(0), float32(math.MaxFloat32)
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := x+dx, y+dy
					if nx < 0 || ny < 0 || nx >= aw || ny >= ah {
						continue
					}
					if nid := out[ny*aw+nx]; isReal(nid) {
						if d := px.lab[i].dist2(pal[comps[nid-1].label].lab); d < bd {
							best, bd = nid, d
						}
					}
				}
			}
			if best != 0 {
				next[i] = best
			} else {
				left = append(left, i)
			}
		}
		for i, id := range next {
			out[i] = id
		}
		todo = left
	}
	return out
}

type hiField struct {
	w, h       int
	own1, own2 []int32
	w1         []uint8
}

type hiCand struct {
	id    int32
	label uint8
	d     float64
	pos   float64
}

func buildHiField(hi *image.NRGBA, eids []int32, real []bool, comps []comp, pal []paletteColor, aw, ah int) *hiField {
	hw, hh := hi.Bounds().Dx(), hi.Bounds().Dy()
	f := &hiField{w: hw, h: hh, own1: make([]int32, hw*hh), own2: make([]int32, hw*hh), w1: make([]uint8, hw*hh)}
	pureSq := pureDist * pureDist
	cands := make([]hiCand, 0, 9)
	for hy := range hh {
		v := (float64(hy)+0.5)*float64(ah)/float64(hh) - 0.5
		ay := int(math.Round(v))
		for hx := range hw {
			i := hy*hw + hx
			f.own2[i] = -1
			f.w1[i] = 255
			o := hy*hi.Stride + hx*4
			alpha := hi.Pix[o+3]
			if alpha <= 2 {
				f.own1[i] = 0
				continue
			}
			u := (float64(hx)+0.5)*float64(aw)/float64(hw) - 0.5
			ax := int(math.Round(u))
			cands = cands[:0]
			hasTransparent := false
			c := labFromBytes(hi.Pix[o], hi.Pix[o+1], hi.Pix[o+2])
			for dy := -candRadius; dy <= candRadius; dy++ {
				for dx := -candRadius; dx <= candRadius; dx++ {
					nx, ny := min(max(ax+dx, 0), aw-1), min(max(ay+dy, 0), ah-1)
					id := eids[ny*aw+nx]
					if id == 0 {
						hasTransparent = true
						continue
					}
					if !real[id] {
						continue
					}
					lb := comps[id-1].label
					pos := math.Hypot(float64(nx)-u, float64(ny)-v)
					dup := false
					for k := range cands {
						if cands[k].label == lb {
							if pos < cands[k].pos {
								cands[k].id, cands[k].pos = id, pos
							}
							dup = true
							break
						}
					}
					if !dup {
						cands = append(cands, hiCand{id: id, label: lb, d: c.dist2(pal[lb].lab), pos: pos})
					}
				}
			}
			if len(cands) == 0 {
				f.own1[i] = 0
				continue
			}
			sort.SliceStable(cands, func(a, b int) bool { return cands[a].d < cands[b].d })
			f.own1[i] = cands[0].id
			if len(cands) > 1 && cands[0].d >= pureSq {
				rgb := [3]float64{float64(hi.Pix[o]), float64(hi.Pix[o+1]), float64(hi.Pix[o+2])}
				a, b := pal[cands[0].label], pal[cands[1].label]
				if t, res := blendFit(rgb, a.rgb, b.rgb); res <= blendTol {
					f.own2[i] = cands[1].id
					f.w1[i] = uint8(math.Round((1 - t) * 255))
				}
			}
			if alpha < 250 && hasTransparent {
				f.own2[i] = 0
				f.w1[i] = alpha
			}
		}
	}
	return f
}

func (f *hiField) fieldOf(id int32, rank map[int32]int, x0, y0, x1, y1, reach int) (fld []float32, w, h int) {
	w, h = x1-x0+2, y1-y0+2
	fld = make([]float32, w*h)
	any := false
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			i := y*f.w + x
			var v float32
			switch id {
			case f.own1[i]:
				v = float32(f.w1[i]) / 255
			case f.own2[i]:
				v = 1 - float32(f.w1[i])/255
			}
			if v > 0 {
				fld[(y-y0+1)*w+x-x0+1] = v
				any = true
			}
		}
	}
	if !any {
		return nil, 0, 0
	}
	myRank, ok := rank[id]
	if !ok || reach <= 0 {
		return fld, w, h
	}
	in := make([]bool, w*h)
	for i, v := range fld {
		in[i] = v >= edgeIso
	}
	dil := dilate(in, w, h, reach)
	for y := range h {
		for x := range w {
			i := y*w + x
			if !dil[i] || fld[i] >= edgeIso {
				continue
			}
			hx, hy := x0+x-1, y0+y-1
			if hx < 0 || hy < 0 || hx >= f.w || hy >= f.h {
				continue
			}
			if r, ok := rank[f.own1[hy*f.w+hx]]; ok && r > myRank {
				fld[i] = 1
			}
		}
	}
	return fld, w, h
}

func dilate(m []bool, w, h, r int) []bool {
	tmp := make([]bool, w*h)
	for y := range h {
		for x := range w {
			if !m[y*w+x] {
				continue
			}
			for k := max(0, x-r); k <= min(w-1, x+r); k++ {
				tmp[y*w+k] = true
			}
		}
	}
	out := make([]bool, w*h)
	for y := range h {
		for x := range w {
			if !tmp[y*w+x] {
				continue
			}
			for k := max(0, y-r); k <= min(h-1, y+r); k++ {
				out[k*w+x] = true
			}
		}
	}
	return out
}

func contourLoops(fld []float32, w, h int) [][]pt {
	type segm struct{ a, b int }
	pos := map[int]pt{}
	var segs []segm
	at := func(x, y int) float32 { return fld[y*w+x] }
	cross := func(x0, y0, x1, y1 int) int {
		k := 2 * (y0*w + x0)
		if y1 != y0 {
			k++
		}
		if _, ok := pos[k]; !ok {
			a, b := at(x0, y0), at(x1, y1)
			t := float64((edgeIso - a) / (b - a))
			pos[k] = pt{float64(x0) + 0.5 + t*float64(x1-x0), float64(y0) + 0.5 + t*float64(y1-y0)}
		}
		return k
	}
	for y := 0; y+1 < h; y++ {
		for x := 0; x+1 < w; x++ {
			tl, tr, br, bl := at(x, y), at(x+1, y), at(x+1, y+1), at(x, y+1)
			idx := 0
			if tl >= edgeIso {
				idx |= 1
			}
			if tr >= edgeIso {
				idx |= 2
			}
			if br >= edgeIso {
				idx |= 4
			}
			if bl >= edgeIso {
				idx |= 8
			}
			if idx == 0 || idx == 15 {
				continue
			}
			top := func() int { return cross(x, y, x+1, y) }
			right := func() int { return cross(x+1, y, x+1, y+1) }
			bottom := func() int { return cross(x, y+1, x+1, y+1) }
			left := func() int { return cross(x, y, x, y+1) }
			add := func(a, b int) { segs = append(segs, segm{a, b}) }
			switch idx {
			case 1:
				add(top(), left())
			case 2:
				add(right(), top())
			case 3:
				add(right(), left())
			case 4:
				add(bottom(), right())
			case 5:
				if (tl+tr+br+bl)/4 >= edgeIso {
					add(top(), right())
					add(bottom(), left())
				} else {
					add(top(), left())
					add(bottom(), right())
				}
			case 6:
				add(bottom(), top())
			case 7:
				add(bottom(), left())
			case 8:
				add(left(), bottom())
			case 9:
				add(top(), bottom())
			case 10:
				if (tl+tr+br+bl)/4 >= edgeIso {
					add(left(), top())
					add(right(), bottom())
				} else {
					add(right(), top())
					add(left(), bottom())
				}
			case 11:
				add(right(), bottom())
			case 12:
				add(left(), right())
			case 13:
				add(top(), right())
			case 14:
				add(left(), top())
			}
		}
	}
	next := make(map[int][]int, len(segs))
	for i, s := range segs {
		next[s.a] = append(next[s.a], i)
	}
	used := make([]bool, len(segs))
	var loops [][]pt
	for i := range segs {
		if used[i] {
			continue
		}
		var loop []pt
		cur := i
		for cur >= 0 && !used[cur] {
			used[cur] = true
			loop = append(loop, pos[segs[cur].a])
			nx := -1
			for _, j := range next[segs[cur].b] {
				if !used[j] {
					nx = j
					break
				}
			}
			cur = nx
		}
		if len(loop) >= 3 {
			loops = append(loops, loop)
		}
	}
	return loops
}
