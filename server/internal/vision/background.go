package vision

import (
	"image/color"
	"math"
	"sort"
)

const (
	bgGrid         = 12
	bgFitSide      = 128
	bgStep         = 0.02
	bgMinCell      = 3
	bgFlatSpread   = 0.02
	bgMinCoverage  = 0.05
	bgBorderOK     = 0.9
	bgMinPopulated = 0.5
	bgMinSurface   = 0.35
	bgBin          = 0.003
	bgBlockyColors = 10
	bgBlockyShare  = 0.8
	bgFlatShare    = 0.85
	bgRefine       = 2
)

type BackgroundInfo struct {
	Kind    string   `json:"kind"`
	Color   string   `json:"color"`
	Corners []string `json:"corners,omitempty"`
	Spread  float64  `json:"spread"`
	Border  float64  `json:"borderMatch"`
}

type bgModel struct {
	cells [bgGrid * bgGrid]lab
	pop   [bgGrid * bgGrid]bool
	mean  lab
}

func (m *bgModel) at(u, v float64) lab {
	fx := math.Max(0, math.Min(bgGrid-1, u*bgGrid-0.5))
	fy := math.Max(0, math.Min(bgGrid-1, v*bgGrid-0.5))
	x0, y0 := int(fx), int(fy)
	x1, y1 := min(x0+1, bgGrid-1), min(y0+1, bgGrid-1)
	tx, ty := fx-float64(x0), fy-float64(y0)
	mix := func(a, b lab, t float64) lab {
		return lab{a.L + (b.L-a.L)*t, a.A + (b.A-a.A)*t, a.B + (b.B-a.B)*t}
	}
	top := mix(m.cells[y0*bgGrid+x0], m.cells[y0*bgGrid+x1], tx)
	bot := mix(m.cells[y1*bgGrid+x0], m.cells[y1*bgGrid+x1], tx)
	return mix(top, bot, ty)
}

type bgFit struct {
	info  bgInfo
	model *bgModel
	desc  BackgroundInfo
}

type bgMap struct {
	ox, oy, sx, sy float64
}

func (m bgMap) uv(x, y int) (float64, float64) {
	return math.Max(0, math.Min(1, (float64(x)+0.5-m.ox)/m.sx)), math.Max(0, math.Min(1, (float64(y)+0.5-m.oy)/m.sy))
}

func fitBackground(at func(x, y int) color.NRGBA, w, h int) bgFit {
	flat := estimateBG(at, w, h)
	f := bgFit{info: flat}
	if flat.transparent {
		f.desc = BackgroundInfo{Kind: "transparent", Color: "transparent", Border: 1}
		return f
	}
	flatLab := labFromBytes(flat.r, flat.g, flat.b)
	f.desc = BackgroundInfo{Kind: "flat", Color: flat.hex()}
	thr := inkThreshold * inkThreshold

	k := math.Min(1, float64(bgFitSide)/float64(max(w, h)))
	sw, sh := max(1, int(math.Round(float64(w)*k))), max(1, int(math.Round(float64(h)*k)))
	labs := make([]lab, sw*sh)
	op := make([]bool, sw*sh)
	for y := range sh {
		y0, y1 := y*h/sh, max((y+1)*h/sh, y*h/sh+1)
		for x := range sw {
			x0, x1 := x*w/sw, max((x+1)*w/sw, x*w/sw+1)
			var r, g, b, n float64
			ys, xs := max(1, (y1-y0)/3), max(1, (x1-x0)/3)
			for yy := y0; yy < y1; yy += ys {
				for xx := x0; xx < x1; xx += xs {
					c := at(xx, yy)
					if c.A < 128 {
						continue
					}
					r += float64(c.R)
					g += float64(c.G)
					b += float64(c.B)
					n++
				}
			}
			if n > 0 {
				op[y*sw+x] = true
				labs[y*sw+x] = labFromRGBf(r/n, g/n, b/n)
			}
		}
	}

	reach := make([]bool, sw*sh)
	comp := make([]int32, sw*sh)
	var sizes []int
	queue := make([]int, 0, sw*sh)
	step2 := bgStep * bgStep
	grow := func(seed int) {
		if !op[seed] || reach[seed] {
			return
		}
		id := int32(len(sizes))
		sizes = append(sizes, 0)
		queue = append(queue[:0], seed)
		reach[seed], comp[seed] = true, id
		for qi := 0; qi < len(queue); qi++ {
			i := queue[qi]
			sizes[id]++
			x, y := i%sw, i/sw
			try := func(j int) {
				if op[j] && !reach[j] && labs[i].dist2(labs[j]) <= step2 {
					reach[j], comp[j] = true, id
					queue = append(queue, j)
				}
			}
			if x > 0 {
				try(i - 1)
			}
			if x < sw-1 {
				try(i + 1)
			}
			if y > 0 {
				try(i - sw)
			}
			if y < sh-1 {
				try(i + sw)
			}
		}
	}
	for x := range sw {
		grow(x)
		grow((sh-1)*sw + x)
	}
	for y := range sh {
		grow(y * sw)
		grow(y*sw + sw - 1)
	}
	onBorder := make([]int, len(sizes))
	for x := range sw {
		for _, i := range []int{x, (sh-1)*sw + x} {
			if reach[i] {
				onBorder[comp[i]]++
			}
		}
	}
	for y := 1; y < sh-1; y++ {
		for _, i := range []int{y * sw, y*sw + sw - 1} {
			if reach[i] {
				onBorder[comp[i]]++
			}
		}
	}
	biggest, covered := -1, 0
	for id, n := range sizes {
		if biggest < 0 || onBorder[id] > onBorder[biggest] || (onBorder[id] == onBorder[biggest] && n > sizes[biggest]) {
			biggest = id
		}
		covered += n
	}
	cand := make([]bool, sw*sh)
	for i := range cand {
		cand[i] = biggest >= 0 && reach[i] && comp[i] == int32(biggest)
	}

	borderMatch := func(model *bgModel) float64 {
		hit, tot := 0, 0
		visit := func(x, y int) {
			c := at(x, y)
			if c.A < 128 {
				return
			}
			tot++
			ref := flatLab
			if model != nil {
				ref = model.at((float64(x)+0.5)/float64(w), (float64(y)+0.5)/float64(h))
			}
			if labFromBytes(c.R, c.G, c.B).dist2(ref) <= thr {
				hit++
			}
		}
		for x := range w {
			visit(x, 0)
			if h > 1 {
				visit(x, h-1)
			}
		}
		for y := 1; y < h-1; y++ {
			visit(0, y)
			if w > 1 {
				visit(w-1, y)
			}
		}
		if tot == 0 {
			return 1
		}
		return float64(hit) / float64(tot)
	}

	if float64(covered) < bgMinCoverage*float64(sw*sh) {
		f.desc.Border = r3(borderMatch(nil))
		return f
	}

	model := fitGrid(labs, cand, sw, sh)
	for range bgRefine {
		next := make([]bool, len(cand))
		cnt := 0
		for i := range reach {
			if !reach[i] {
				continue
			}
			u, v := (float64(i%sw)+0.5)/float64(sw), (float64(i/sw)+0.5)/float64(sh)
			if labs[i].dist2(model.at(u, v)) <= thr {
				next[i] = true
				cnt++
			}
		}
		if float64(cnt) < bgMinCoverage*float64(sw*sh) {
			break
		}
		model = fitGrid(labs, next, sw, sh)
		cand = next
	}

	spread := 0.0
	for _, c := range model.cells {
		spread = math.Max(spread, math.Sqrt(c.dist2(model.mean)))
	}
	popN := 0
	for _, p := range model.pop {
		if p {
			popN++
		}
	}
	nCand, nFlat := 0, 0
	bins := map[[3]int32]int{}
	for i := range cand {
		if !cand[i] {
			continue
		}
		nCand++
		bins[[3]int32{int32(math.Round(labs[i].L / bgBin)), int32(math.Round(labs[i].A / bgBin)), int32(math.Round(labs[i].B / bgBin))}]++
		if labs[i].dist2(flatLab) <= thr {
			nFlat++
		}
	}
	counts := make([]int, 0, len(bins))
	for _, n := range bins {
		counts = append(counts, n)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(counts)))
	top := 0
	for _, n := range counts[:min(bgBlockyColors, len(counts))] {
		top += n
	}
	blocky := nCand > 0 && float64(top) >= bgBlockyShare*float64(nCand)
	if blocky || spread <= bgFlatSpread || popN < bgMinPopulated*bgGrid*bgGrid || float64(nCand) < bgMinSurface*float64(sw*sh) || (nCand > 0 && float64(nFlat) >= bgFlatShare*float64(nCand)) {
		f.desc.Border = r3(borderMatch(nil))
		return f
	}
	f.model = model
	corner := func(u, v float64) string {
		r, g, b := labToRGB(model.at(u, v))
		return hexOf([3]float64{r, g, b})
	}
	mr, mg, mb := labToRGB(model.mean)
	f.info = bgInfo{r: uint8(math.Round(mr)), g: uint8(math.Round(mg)), b: uint8(math.Round(mb))}
	f.desc = BackgroundInfo{
		Kind: "gradient", Color: f.info.hex(),
		Corners: []string{corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)},
		Spread:  r1(spread * 100), Border: r3(borderMatch(model)),
	}
	return f
}

func fitGrid(labs []lab, cand []bool, sw, sh int) *bgModel {
	var cellPx [bgGrid * bgGrid][]int
	var all []int
	for i, c := range cand {
		if !c {
			continue
		}
		cx := min(bgGrid-1, (i%sw)*bgGrid/sw)
		cy := min(bgGrid-1, (i/sw)*bgGrid/sh)
		cellPx[cy*bgGrid+cx] = append(cellPx[cy*bgGrid+cx], i)
		all = append(all, i)
	}
	med := func(idx []int) lab {
		ch := func(get func(lab) float64) float64 {
			v := make([]float64, len(idx))
			for j, i := range idx {
				v[j] = get(labs[i])
			}
			sort.Float64s(v)
			return v[len(v)/2]
		}
		return lab{ch(func(l lab) float64 { return l.L }), ch(func(l lab) float64 { return l.A }), ch(func(l lab) float64 { return l.B })}
	}
	m := &bgModel{}
	if len(all) > 0 {
		m.mean = med(all)
	}
	filled := make([]bool, bgGrid*bgGrid)
	for c := range m.cells {
		if len(cellPx[c]) >= bgMinCell {
			m.cells[c] = med(cellPx[c])
			filled[c] = true
			m.pop[c] = true
		}
	}
	for {
		var add []int
		var vals []lab
		for c := range m.cells {
			if filled[c] {
				continue
			}
			cx, cy := c%bgGrid, c/bgGrid
			var s lab
			cnt := 0
			for _, d := range [][2]int{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
				nx, ny := cx+d[0], cy+d[1]
				if nx < 0 || ny < 0 || nx >= bgGrid || ny >= bgGrid || !filled[ny*bgGrid+nx] {
					continue
				}
				v := m.cells[ny*bgGrid+nx]
				s.L += v.L
				s.A += v.A
				s.B += v.B
				cnt++
			}
			if cnt > 0 {
				add = append(add, c)
				vals = append(vals, lab{s.L / float64(cnt), s.A / float64(cnt), s.B / float64(cnt)})
			}
		}
		if len(add) == 0 {
			break
		}
		for j, c := range add {
			m.cells[c] = vals[j]
			filled[c] = true
		}
	}
	return m
}

func labToRGB(c lab) (r, g, b float64) {
	l := c.L + 0.3963377774*c.A + 0.2158037573*c.B
	m := c.L - 0.1055613458*c.A - 0.0638541728*c.B
	s := c.L - 0.0894841775*c.A - 1.2914855480*c.B
	l, m, s = l*l*l, m*m*m, s*s*s
	lr := 4.0767416621*l - 3.3077115913*m + 0.2309699292*s
	lg := -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
	lb := -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
	enc := func(v float64) float64 {
		v = math.Max(0, math.Min(1, v))
		if v <= 0.0031308 {
			return 12.92 * v * 255
		}
		return (1.055*math.Pow(v, 1/2.4) - 0.055) * 255
	}
	return enc(lr), enc(lg), enc(lb)
}
