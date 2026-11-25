package vision

import (
	"math"
	"sort"
)

// Layout holds the structure found among the blobs: shapes that repeat, grids they sit on and
// rings they are spread around. Ids refer to Result.Blobs.
type Layout struct {
	Repeats []Repeat `json:"repeats"`
	Grids   []Grid   `json:"grids"`
	Radials []Radial `json:"radials"`
}

// Repeat is a set of blobs with the same color and the same fit within tolerance.
type Repeat struct {
	IDs    []string `json:"ids"`
	Count  int      `json:"count"`
	Kind   string   `json:"kind"`
	Color  string   `json:"color"`
	Width  float64  `json:"width"`
	Height float64  `json:"height"`
}

// Grid is a set of repeated blobs on rows and columns (rows or cols may be 1: a line).
// IDs run row by row. Pitch is the distance between centers; Gap is the space between cells.
type Grid struct {
	IDs    []string `json:"ids"`
	Rows   int      `json:"rows"`
	Cols   int      `json:"cols"`
	Origin Point    `json:"origin"` // center of the first cell
	PitchX float64  `json:"pitchX"`
	PitchY float64  `json:"pitchY"`
	CellW  float64  `json:"cellWidth"`
	CellH  float64  `json:"cellHeight"`
	GapX   float64  `json:"gapX"`
	GapY   float64  `json:"gapY"`
	Filled int      `json:"filled"`
}

// Radial is a set of repeated blobs spread around a center. Angles are degrees, clockwise from
// +x (y points down). IDs run by increasing angle.
type Radial struct {
	IDs          []string `json:"ids"`
	Count        int      `json:"count"`
	Center       Point    `json:"center"`
	Radius       float64  `json:"radius"`
	StartAngle   float64  `json:"startAngle"`
	StepAngle    float64  `json:"stepAngle"`
	Alignment    string   `json:"alignment,omitempty"`    // radial: major axis points at the center; tangential: across
	MemberOffset *float64 `json:"memberOffset,omitempty"` // major axis angle minus the blob's angle around the center
	CenterBlob   string   `json:"centerBlob,omitempty"`
}

func rel(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol*math.Max(math.Abs(a), math.Abs(b))+1
}

func similar(a, b *Blob) bool {
	if a.pal != b.pal || a.Fit.Kind != b.Fit.Kind {
		return false
	}
	if a.Fit.Kind == "polygon" {
		return a.Fit.Sides == b.Fit.Sides && rel(a.dimA, b.dimA, 0.1)
	}
	if a.Fit.Kind == "freeform" {
		return rel(a.area, b.area, 0.12) && rel(a.dimA, b.dimA, 0.12) && rel(a.dimB, b.dimB, 0.12) &&
			math.Abs(a.solidity-b.solidity) < 0.07 && math.Abs(a.Elongation-b.Elongation) < 0.15*math.Max(a.Elongation, b.Elongation)
	}
	return rel(a.dimA, b.dimA, 0.1) && rel(a.dimB, b.dimB, 0.1)
}

func findLayout(blobs []Blob) Layout {
	lay := Layout{Repeats: []Repeat{}, Grids: []Grid{}, Radials: []Radial{}}
	n := len(blobs)
	if n < 2 {
		return lay
	}
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	find := func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	for i := range n {
		for j := i + 1; j < n; j++ {
			if similar(&blobs[i], &blobs[j]) {
				a, b := find(i), find(j)
				if a != b {
					parent[max(a, b)] = min(a, b)
				}
			}
		}
	}
	groups := map[int][]int{}
	var roots []int
	for i := range n {
		r := find(i)
		if _, ok := groups[r]; !ok {
			roots = append(roots, r)
		}
		groups[r] = append(groups[r], i)
	}
	sort.SliceStable(roots, func(a, b int) bool {
		ga, gb := groups[roots[a]], groups[roots[b]]
		if len(ga) != len(gb) {
			return len(ga) > len(gb)
		}
		return roots[a] < roots[b]
	})
	for _, r := range roots {
		idx := groups[r]
		if len(idx) < 2 || len(lay.Repeats) >= 8 {
			continue
		}
		first := &blobs[idx[0]]
		w, h := first.dimA, first.dimB
		if nd := first.Fit.Node; nd != nil && nd.Width != nil && nd.Height != nil {
			w, h = *nd.Width, *nd.Height
		}
		rp := Repeat{Count: len(idx), Kind: first.Fit.Kind, Color: first.Color, Width: r1(w), Height: r1(h)}
		for _, i := range idx {
			rp.IDs = append(rp.IDs, blobs[i].ID)
		}
		lay.Repeats = append(lay.Repeats, rp)
		if len(idx) < 3 {
			continue
		}
		// A ring of five or more is read as radial first: a 3x3 grid with a hole in the middle
		// has the same occupancy, but its distances to the center are not equal.
		if len(idx) >= 5 {
			if rd, ok := detectRadial(blobs, idx); ok {
				lay.Radials = append(lay.Radials, rd)
				continue
			}
		}
		if g, ok := detectGrid(blobs, idx); ok {
			lay.Grids = append(lay.Grids, g)
		} else if rd, ok := detectRadial(blobs, idx); ok {
			lay.Radials = append(lay.Radials, rd)
		}
	}
	return lay
}

func median(v []float64) float64 {
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	return s[len(s)/2]
}

// cluster1D groups sorted values: a new group starts when a value is farther than tol from the
// running mean of the current one. It returns the group index of every input.
func cluster1D(vals []float64, tol float64) ([]int, []float64) {
	order := make([]int, len(vals))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return vals[order[a]] < vals[order[b]] })
	group := make([]int, len(vals))
	var means []float64
	var sum float64
	cnt := 0
	for _, i := range order {
		if cnt > 0 && vals[i]-sum/float64(cnt) > tol {
			means = append(means, sum/float64(cnt))
			sum, cnt = 0, 0
		}
		group[i] = len(means)
		sum += vals[i]
		cnt++
	}
	if cnt > 0 {
		means = append(means, sum/float64(cnt))
	}
	return group, means
}

func pitch(means []float64) (float64, bool) {
	if len(means) < 2 {
		return 0, true
	}
	var gaps []float64
	for i := 1; i < len(means); i++ {
		gaps = append(gaps, means[i]-means[i-1])
	}
	mean := 0.0
	for _, g := range gaps {
		mean += g
	}
	mean /= float64(len(gaps))
	if mean <= 0 {
		return 0, false
	}
	if len(gaps) >= 2 {
		v := 0.0
		for _, g := range gaps {
			v += (g - mean) * (g - mean)
		}
		if math.Sqrt(v/float64(len(gaps)))/mean > 0.2 {
			return mean, false
		}
	}
	return mean, true
}

func detectGrid(blobs []Blob, idx []int) (Grid, bool) {
	var xs, ys, ws, hs []float64
	for _, i := range idx {
		xs = append(xs, blobs[i].Centroid.X)
		ys = append(ys, blobs[i].Centroid.Y)
		ws = append(ws, blobs[i].BBox.Width)
		hs = append(hs, blobs[i].BBox.Height)
	}
	cellW, cellH := median(ws), median(hs)
	rowOf, rowMeans := cluster1D(ys, 0.5*cellH)
	colOf, colMeans := cluster1D(xs, 0.5*cellW)
	R, C := len(rowMeans), len(colMeans)
	if R == 1 && C == 1 {
		return Grid{}, false
	}
	if R > 1 && C > 1 && float64(len(idx)) < 0.75*float64(R*C) {
		return Grid{}, false
	}
	seen := map[[2]int]bool{}
	for k := range idx {
		cell := [2]int{rowOf[k], colOf[k]}
		if seen[cell] {
			return Grid{}, false
		}
		seen[cell] = true
	}
	px, okx := pitch(colMeans)
	py, oky := pitch(rowMeans)
	if !okx || !oky {
		return Grid{}, false
	}
	order := make([]int, len(idx))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		ka, kb := order[a], order[b]
		if rowOf[ka] != rowOf[kb] {
			return rowOf[ka] < rowOf[kb]
		}
		return colOf[ka] < colOf[kb]
	})
	g := Grid{Rows: R, Cols: C, Origin: Point{r1(colMeans[0]), r1(rowMeans[0])}, PitchX: r1(px), PitchY: r1(py),
		CellW: r1(cellW), CellH: r1(cellH), Filled: len(idx)}
	if C > 1 {
		g.GapX = r1(px - cellW)
	}
	if R > 1 {
		g.GapY = r1(py - cellH)
	}
	for _, k := range order {
		g.IDs = append(g.IDs, blobs[idx[k]].ID)
	}
	return g, true
}

func detectRadial(blobs []Blob, idx []int) (Radial, bool) {
	n := float64(len(idx))
	var mx, my float64
	for _, i := range idx {
		mx += blobs[i].Centroid.X
		my += blobs[i].Centroid.Y
	}
	mx /= n
	my /= n
	var suu, suv, svv, suuu, svvv, suvv, svuu float64
	for _, i := range idx {
		u, v := blobs[i].Centroid.X-mx, blobs[i].Centroid.Y-my
		suu += u * u
		suv += u * v
		svv += v * v
		suuu += u * u * u
		svvv += v * v * v
		suvv += u * v * v
		svuu += v * u * u
	}
	det := suu*svv - suv*suv
	if math.Abs(det) < 1e-6*math.Max(1, suu*svv) {
		return Radial{}, false
	}
	b1, b2 := 0.5*(suuu+suvv), 0.5*(svvv+svuu)
	uc := (b1*svv - b2*suv) / det
	vc := (suu*b2 - suv*b1) / det
	cx, cy := mx+uc, my+vc
	radius := 0.0
	rs := make([]float64, len(idx))
	for k, i := range idx {
		rs[k] = math.Hypot(blobs[i].Centroid.X-cx, blobs[i].Centroid.Y-cy)
		radius += rs[k]
	}
	radius /= n
	size := 0.0
	for _, i := range idx {
		size = math.Max(size, blobs[i].BBox.Width)
		size = math.Max(size, blobs[i].BBox.Height)
	}
	if radius < 0.5*size {
		return Radial{}, false
	}
	for _, r := range rs {
		if math.Abs(r-radius) > 0.08*radius+1.5 {
			return Radial{}, false
		}
	}
	type member struct {
		i   int
		ang float64
	}
	ms := make([]member, len(idx))
	for k, i := range idx {
		a := math.Atan2(blobs[i].Centroid.Y-cy, blobs[i].Centroid.X-cx) * 180 / math.Pi
		if a < 0 {
			a += 360
		}
		ms[k] = member{i, a}
	}
	sort.SliceStable(ms, func(a, b int) bool { return ms[a].ang < ms[b].ang })
	var gaps []float64
	for k := range ms {
		next := ms[(k+1)%len(ms)].ang
		d := next - ms[k].ang
		if d <= 0 {
			d += 360
		}
		gaps = append(gaps, d)
	}
	mean := 360 / n
	v := 0.0
	for _, d := range gaps {
		v += (d - mean) * (d - mean)
	}
	if math.Sqrt(v/n)/mean > 0.25 {
		return Radial{}, false
	}
	rd := Radial{Count: len(idx), Center: Point{r1(cx), r1(cy)}, Radius: r1(radius), StartAngle: r1(ms[0].ang), StepAngle: r1(mean)}
	var sr, si float64
	used := 0
	inGroup := map[int]bool{}
	for _, m := range ms {
		inGroup[m.i] = true
		rd.IDs = append(rd.IDs, blobs[m.i].ID)
		if blobs[m.i].Elongation >= 1.15 {
			d := (blobs[m.i].Orientation - m.ang) * math.Pi / 180
			sr += math.Cos(2 * d)
			si += math.Sin(2 * d)
			used++
		}
	}
	if used > 0 && math.Hypot(sr, si)/float64(used) > 0.9 {
		off := r1(math.Atan2(si, sr) / 2 * 180 / math.Pi)
		rd.MemberOffset = &off
		switch {
		case math.Abs(off) <= 15:
			rd.Alignment = "radial"
		case math.Abs(off) >= 75:
			rd.Alignment = "tangential"
		}
	}
	best := -1
	for i := range blobs {
		// the smallest blob at the center: a backdrop panel centered there is not "the center"
		if !inGroup[i] && math.Hypot(blobs[i].Centroid.X-cx, blobs[i].Centroid.Y-cy) <= 0.2*radius && (best < 0 || blobs[i].area < blobs[best].area) {
			best = i
		}
	}
	if best >= 0 {
		rd.CenterBlob = blobs[best].ID
	}
	return rd, true
}
