package vision

import (
	"fmt"
	"image"
	"math"
	"sort"
)

// Region kinds and the tool each one is best drawn with.
const (
	KindPhoto    = "photo"
	KindGradient = "gradient"
	KindFlat     = "flat"
	KindText     = "text"
)

type GradientStop struct {
	Color  string  `json:"color"`
	Offset float64 `json:"offset"`
}

// Gradient is a node's gradient field, ready to paste: linear (angle, CSS degrees) or radial
// (center and radius as fractions of the box).
type Gradient struct {
	Type   string         `json:"type"`
	Angle  *float64       `json:"angle,omitempty"`
	Cx     *float64       `json:"cx,omitempty"`
	Cy     *float64       `json:"cy,omitempty"`
	Radius *float64       `json:"radius,omitempty"`
	Stops  []GradientStop `json:"stops"`
}

// ImageRegion is a rectangle of the image of one kind, with the tool that draws it best. Regions
// cover the analyzed area without overlapping; a flat area may come as several rectangles.
type ImageRegion struct {
	ID       string    `json:"id"`
	Kind     string    `json:"kind"`    // photo, gradient, flat, text
	Box      Rect      `json:"box"`     // output coordinates (like blobs)
	Share    float64   `json:"share"`   // of the analyzed area
	Suggest  string    `json:"suggest"` // import_image, gradient, primitive, trace_image, text
	Why      string    `json:"why"`
	BlobIDs  []string  `json:"blobIds"`
	Gradient *Gradient `json:"gradient,omitempty"` // gradient: the node field
	FontSize float64   `json:"fontSize,omitempty"` // text: estimated size of the type
	Lines    int       `json:"lines,omitempty"`    // text: lines in the block
}

// rawRegion is a region in analysis pixels, before blobs are assigned to it.
type rawRegion struct {
	kind     string
	rect     image.Rectangle
	grad     *Gradient
	fontSize float64
	lines    int
	why      string
	members  map[int]bool // text: indexes of the glyph comps
	gband    bool         // gradient: set when the group fitted a ramp
}

const (
	grainDelta   = 3.0  // luminance steps from the blurred image that count as grain
	grainPhoto   = 0.35 // share of grainy pixels of a photo tile
	coverPhoto   = 0.55 // the 6 commonest colours of a photo tile cover less than this
	minPhotoTile = 4    // connected photo tiles that make a photo region
	sharpStep    = 14   // channel difference between neighbours that is an edge, not a ramp
)

type tileStat struct {
	x0, y0, x1, y1 int
	n              int
	grain, cover   float64
	edge           float64
	photo, smooth  bool
	photoComp      int // index of the photo component, -1 none
	group          int // smooth group, -1 none
	gradient       bool
}

// classifyRegions classifies the analyzed raster. comps are the connected palette regions that
// survived the area filter (they carry the glyph candidates for text).
func classifyRegions(px *pixels, comps []comp) []rawRegion {
	w, h := px.w, px.h
	ts := max(8, int(math.Round(float64(w)/16)))
	tx, ty := (w+ts-1)/ts, (h+ts-1)/ts
	lum := make([]float32, w*h)
	for i := range lum {
		if px.opaque[i] {
			lum[i] = 0.299*float32(px.rgb[i*3]) + 0.587*float32(px.rgb[i*3+1]) + 0.114*float32(px.rgb[i*3+2])
		}
	}
	blur := gaussBlur(lum, w, h, 1.2)

	tiles := make([]tileStat, tx*ty)
	for j := range ty {
		for i := range tx {
			t := &tiles[j*tx+i]
			*t = tileStat{x0: i * ts, y0: j * ts, x1: min(w, (i+1)*ts), y1: min(h, (j+1)*ts), photoComp: -1, group: -1}
			tileFeatures(px, lum, blur, t)
			t.photo = t.n >= (t.x1-t.x0)*(t.y1-t.y0)/2 && t.grain > grainPhoto && t.cover < coverPhoto
			t.smooth = !t.photo && t.n >= (t.x1-t.x0)*(t.y1-t.y0)/2 && t.edge <= 0.012
		}
	}

	// photo regions: connected photo tiles, at least minPhotoTile of them
	type photoComp struct {
		tiles []int
		rect  image.Rectangle
		box   bool // claim the whole bounding box
	}
	var photos []photoComp
	seen := make([]bool, len(tiles))
	for s := range tiles {
		if !tiles[s].photo || seen[s] {
			continue
		}
		stack := []int{s}
		seen[s] = true
		var members []int
		for len(stack) > 0 {
			c := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			members = append(members, c)
			ci, cj := c%tx, c/tx
			for _, d := range [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				ni, nj := ci+d[0], cj+d[1]
				if ni < 0 || nj < 0 || ni >= tx || nj >= ty {
					continue
				}
				if k := nj*tx + ni; tiles[k].photo && !seen[k] {
					seen[k] = true
					stack = append(stack, k)
				}
			}
		}
		if len(members) < minPhotoTile {
			for _, m := range members {
				tiles[m].photo = false
			}
			continue
		}
		r := image.Rectangle{Min: image.Pt(w, h)}
		for _, m := range members {
			r = r.Union(image.Rect(tiles[m].x0, tiles[m].y0, tiles[m].x1, tiles[m].y1))
		}
		photos = append(photos, photoComp{tiles: members, rect: r})
	}
	// photo components whose boxes touch become one
	for merged := true; merged; {
		merged = false
		for i := 0; i < len(photos) && !merged; i++ {
			for j := i + 1; j < len(photos) && !merged; j++ {
				if photos[i].rect.Overlaps(photos[j].rect) {
					photos[i].tiles = append(photos[i].tiles, photos[j].tiles...)
					photos[i].rect = photos[i].rect.Union(photos[j].rect)
					photos = append(photos[:j], photos[j+1:]...)
					merged = true
				}
			}
		}
	}
	for i := range photos {
		area := 0
		for _, m := range photos[i].tiles {
			t := tiles[m]
			area += (t.x1 - t.x0) * (t.y1 - t.y0)
			tiles[m].photoComp = i
		}
		photos[i].box = float64(area) >= 0.5*float64(photos[i].rect.Dx()*photos[i].rect.Dy())
		if photos[i].box {
			for j := range tiles {
				t := tiles[j]
				if image.Rect(t.x0, t.y0, t.x1, t.y1).In(photos[i].rect) {
					tiles[j].photoComp = i
					tiles[j].photo = true
					tiles[j].smooth = false
				}
			}
		}
	}

	// text blocks from the glyph-like comps outside the photos
	inPhoto := func(c comp) bool {
		cx, cy := (c.minX+c.maxX)/2, (c.minY+c.maxY)/2
		for _, p := range photos {
			if p.box {
				if image.Pt(cx, cy).In(p.rect) {
					return true
				}
			} else if t := tiles[min(cy/ts, ty-1)*tx+min(cx/ts, tx-1)]; t.photoComp >= 0 {
				return true
			}
		}
		return false
	}
	blocks := findText(comps, w, h, inPhoto)

	// smooth tiles that continue into each other form a group; a group that changes color is a
	// gradient
	parent := make([]int, len(tiles))
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
	for j := range ty {
		for i := range tx {
			a := j*tx + i
			if !tiles[a].smooth {
				continue
			}
			if i+1 < tx && tiles[a+1].smooth && seamOK(px, tiles[a], tiles[a+1], true) {
				parent[find(a+1)] = find(a)
			}
			if j+1 < ty && tiles[a+tx].smooth && seamOK(px, tiles[a], tiles[a+tx], false) {
				parent[find(a+tx)] = find(a)
			}
		}
	}
	groupTiles := map[int][]int{}
	for i := range tiles {
		if tiles[i].smooth {
			r := find(i)
			groupTiles[r] = append(groupTiles[r], i)
		}
	}
	var roots []int
	for r := range groupTiles {
		roots = append(roots, r)
	}
	sort.Ints(roots)
	type gradGroup struct {
		fit *rampFit
		ref image.Rectangle // rectangular group: its box grown to the pixel where the ramp ends
	}
	var groups []gradGroup
	for _, r := range roots {
		ms := groupTiles[r]
		if len(ms) < 2 {
			continue
		}
		fit := fitRamp(px, tiles, ms, tx)
		if fit == nil {
			continue
		}
		gi := len(groups)
		gg := gradGroup{fit: fit}
		area := 0
		for _, m := range ms {
			area += (tiles[m].x1 - tiles[m].x0) * (tiles[m].y1 - tiles[m].y0)
		}
		if float64(area) >= 0.9*float64(fit.bbox.Dx()*fit.bbox.Dy()) {
			gg.ref = growRamp(px, fit.bbox, ts)
		}
		groups = append(groups, gg)
		for _, m := range ms {
			tiles[m].group = gi
			tiles[m].gradient = true
		}
	}

	// partition: a grid cut along the tile lines and the text boxes; each cell takes the label
	// of the strongest claim on it (photo, then text, then gradient, else flat)
	xs := map[int]bool{0: true, w: true}
	ys := map[int]bool{0: true, h: true}
	for i := 0; i <= tx; i++ {
		xs[min(i*ts, w)] = true
	}
	for j := 0; j <= ty; j++ {
		ys[min(j*ts, h)] = true
	}
	for _, b := range blocks {
		xs[b.rect.Min.X], xs[b.rect.Max.X] = true, true
		ys[b.rect.Min.Y], ys[b.rect.Max.Y] = true, true
	}
	for _, g := range groups {
		if !g.ref.Empty() {
			xs[g.ref.Min.X], xs[g.ref.Max.X] = true, true
			ys[g.ref.Min.Y], ys[g.ref.Max.Y] = true, true
		}
	}
	for _, p := range photos {
		if p.box {
			xs[p.rect.Min.X], xs[p.rect.Max.X] = true, true
			ys[p.rect.Min.Y], ys[p.rect.Max.Y] = true, true
		}
	}
	X, Y := sortedKeys(xs), sortedKeys(ys)
	nx, ny := len(X)-1, len(Y)-1
	label := make([]int, nx*ny)
	const (
		labFlat  = 1
		labPhoto = 1000
		labText  = 2000
		labGrad  = 3000
	)
	for j := range ny {
		for i := range nx {
			cx, cy := (X[i]+X[i+1])/2, (Y[j]+Y[j+1])/2
			t := tiles[min(cy/ts, ty-1)*tx+min(cx/ts, tx-1)]
			l := labFlat
			switch {
			case t.photoComp >= 0 && (photos[t.photoComp].box && image.Pt(cx, cy).In(photos[t.photoComp].rect) || !photos[t.photoComp].box && t.photo):
				l = labPhoto + t.photoComp
			default:
				for bi, b := range blocks {
					if image.Pt(cx, cy).In(b.rect) {
						l = labText + bi
						break
					}
				}
				if l == labFlat {
					for gi, g := range groups {
						if !g.ref.Empty() && image.Pt(cx, cy).In(g.ref) {
							l = labGrad + gi
							break
						}
					}
				}
				if l == labFlat && t.gradient {
					l = labGrad + t.group
				}
			}
			label[j*nx+i] = l
		}
	}
	// photos whose bounding box claims cells that hold another photo's tiles keep their own
	for pi, p := range photos {
		if !p.box {
			continue
		}
		for j := range ny {
			for i := range nx {
				if image.Pt((X[i]+X[i+1])/2, (Y[j]+Y[j+1])/2).In(p.rect) {
					label[j*nx+i] = labPhoto + pi
				}
			}
		}
	}

	var out []rawRegion
	for _, cell := range decompose(label, nx, ny) {
		r := image.Rect(X[cell.x0], Y[cell.y0], X[cell.x1], Y[cell.y1])
		if r.Empty() {
			continue
		}
		rr := rawRegion{rect: r}
		switch {
		case cell.label >= labGrad:
			rr.kind = KindGradient
			g := groups[cell.label-labGrad]
			rr.grad = rampGradient(px, r, g.fit)
			if rr.grad != nil {
				rr.gband = true
				rr.why = fmt.Sprintf("smooth %s ramp (fit error %.1f levels, %d colour steps over %d px)", rr.grad.Type, g.fit.rms, len(rr.grad.Stops), max(r.Dx(), r.Dy()))
			} else {
				rr.why = "smooth change of colour that is neither a linear nor a radial ramp"
			}
		case cell.label >= labText:
			b := blocks[cell.label-labText]
			rr.kind = KindText
			rr.fontSize, rr.lines, rr.members = b.fontSize, b.lines, b.members
			rr.why = fmt.Sprintf("%d glyph-like blobs on %d baseline(s), glyph height about %.0f px: set them as a text node, no OCR here", len(b.members), b.lines, b.glyphH)
		case cell.label >= labPhoto:
			rr.kind = KindPhoto
			rr.why = photoWhy(tiles, photos[cell.label-labPhoto].tiles)
		default:
			rr.kind = KindFlat
		}
		if rr.kind == KindFlat && (min(r.Dx(), r.Dy()) <= 3 || float64(r.Dx()*r.Dy()) < 0.0005*float64(w*h)) {
			continue // a sliver left between two other regions
		}
		out = append(out, rr)
	}
	sort.SliceStable(out, func(i, j int) bool {
		ai, aj := out[i].rect.Dx()*out[i].rect.Dy(), out[j].rect.Dx()*out[j].rect.Dy()
		return ai > aj
	})
	return out
}

// growRamp extends the box of a group of ramp tiles, a pixel at a time, while the next line of
// pixels continues the ramp (no sharp jump from the line before): tiles cut by the edge of the
// ramp are not smooth, but the ramp itself reaches it.
func growRamp(px *pixels, r image.Rectangle, limit int) image.Rectangle {
	continues := func(a, b image.Rectangle) bool { // line a (outside) against line b (inside)
		bad, n := 0, 0
		for y := a.Min.Y; y < a.Max.Y; y++ {
			for x := a.Min.X; x < a.Max.X; x++ {
				i := y*px.w + x
				j := (y+b.Min.Y-a.Min.Y)*px.w + x + b.Min.X - a.Min.X
				if !px.opaque[i] || !px.opaque[j] {
					bad++
				} else if chanDiff(px, i, j) > sharpStep {
					bad++
				}
				n++
			}
		}
		return n > 0 && float64(bad)/float64(n) <= 0.1
	}
	for k := 0; k < limit && r.Min.X > 0; k++ {
		if !continues(image.Rect(r.Min.X-1, r.Min.Y, r.Min.X, r.Max.Y), image.Rect(r.Min.X, r.Min.Y, r.Min.X+1, r.Max.Y)) {
			break
		}
		r.Min.X--
	}
	for k := 0; k < limit && r.Max.X < px.w; k++ {
		if !continues(image.Rect(r.Max.X, r.Min.Y, r.Max.X+1, r.Max.Y), image.Rect(r.Max.X-1, r.Min.Y, r.Max.X, r.Max.Y)) {
			break
		}
		r.Max.X++
	}
	for k := 0; k < limit && r.Min.Y > 0; k++ {
		if !continues(image.Rect(r.Min.X, r.Min.Y-1, r.Max.X, r.Min.Y), image.Rect(r.Min.X, r.Min.Y, r.Max.X, r.Min.Y+1)) {
			break
		}
		r.Min.Y--
	}
	for k := 0; k < limit && r.Max.Y < px.h; k++ {
		if !continues(image.Rect(r.Min.X, r.Max.Y, r.Max.X, r.Max.Y+1), image.Rect(r.Min.X, r.Max.Y-1, r.Max.X, r.Max.Y)) {
			break
		}
		r.Max.Y++
	}
	return r
}

func photoWhy(tiles []tileStat, members []int) string {
	var grain, cover float64
	for _, m := range members {
		grain += tiles[m].grain
		cover += tiles[m].cover
	}
	n := float64(len(members))
	return fmt.Sprintf("textured: %.0f%% of the pixels are grain and the 6 commonest colours cover only %.0f%%; tracing it would posterize it, crop it and use import_image or place_reference", grain/n*100, cover/n*100)
}

func sortedKeys(m map[int]bool) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

type cellRect struct{ x0, y0, x1, y1, label int }

// decompose cuts the labelled grid into rectangles of one label each, row by row or column by
// column, whichever gives fewer.
func decompose(label []int, nx, ny int) []cellRect {
	a := greedyRects(label, nx, ny)
	tr := make([]int, len(label))
	for j := range ny {
		for i := range nx {
			tr[i*ny+j] = label[j*nx+i]
		}
	}
	b := greedyRects(tr, ny, nx)
	if len(b) < len(a) {
		a = a[:0]
		for _, r := range b {
			a = append(a, cellRect{r.y0, r.x0, r.y1, r.x1, r.label})
		}
	}
	return a
}

func greedyRects(label []int, nx, ny int) []cellRect {
	done := make([]bool, len(label))
	var out []cellRect
	for j := range ny {
		for i := range nx {
			if done[j*nx+i] {
				continue
			}
			l := label[j*nx+i]
			i1 := i + 1
			for i1 < nx && !done[j*nx+i1] && label[j*nx+i1] == l {
				i1++
			}
			j1 := j + 1
		rows:
			for j1 < ny {
				for k := i; k < i1; k++ {
					if done[j1*nx+k] || label[j1*nx+k] != l {
						break rows
					}
				}
				j1++
			}
			for y := j; y < j1; y++ {
				for x := i; x < i1; x++ {
					done[y*nx+x] = true
				}
			}
			out = append(out, cellRect{i, j, i1, j1, l})
		}
	}
	return out
}

func gaussBlur(src []float32, w, h int, sigma float64) []float32 {
	r := int(math.Ceil(sigma * 2.5))
	k := make([]float32, 2*r+1)
	sum := float32(0)
	for i := range k {
		d := float64(i - r)
		k[i] = float32(math.Exp(-d * d / (2 * sigma * sigma)))
		sum += k[i]
	}
	for i := range k {
		k[i] /= sum
	}
	tmp := make([]float32, len(src))
	out := make([]float32, len(src))
	for y := range h {
		for x := range w {
			var a float32
			for i := -r; i <= r; i++ {
				a += k[i+r] * src[y*w+min(max(x+i, 0), w-1)]
			}
			tmp[y*w+x] = a
		}
	}
	for y := range h {
		for x := range w {
			var a float32
			for i := -r; i <= r; i++ {
				a += k[i+r] * tmp[min(max(y+i, 0), h-1)*w+x]
			}
			out[y*w+x] = a
		}
	}
	return out
}

// tileFeatures fills the counts of a tile: opaque pixels, share of grainy ones, how much of the
// tile its 6 commonest colours (of a 64-colour grid fitted to the tile's own range) cover, and
// the share of neighbour pairs that are sharp edges.
func tileFeatures(px *pixels, lum, blur []float32, t *tileStat) {
	w := px.w
	var lo, hi [3]int
	lo = [3]int{255, 255, 255}
	grainy, pairs, sharp := 0, 0, 0
	for y := t.y0; y < t.y1; y++ {
		for x := t.x0; x < t.x1; x++ {
			i := y*w + x
			if !px.opaque[i] {
				continue
			}
			t.n++
			for c := range 3 {
				v := int(px.rgb[i*3+c])
				lo[c], hi[c] = min(lo[c], v), max(hi[c], v)
			}
			d := lum[i] - blur[i]
			if d > grainDelta || d < -grainDelta {
				grainy++
			}
			if x+1 < t.x1 && px.opaque[i+1] {
				pairs++
				if chanDiff(px, i, i+1) > sharpStep {
					sharp++
				}
			}
			if y+1 < t.y1 && px.opaque[i+w] {
				pairs++
				if chanDiff(px, i, i+w) > sharpStep {
					sharp++
				}
			}
		}
	}
	if t.n == 0 {
		return
	}
	t.grain = float64(grainy) / float64(t.n)
	if pairs > 0 {
		t.edge = float64(sharp) / float64(pairs)
	}
	var counts [64]int
	for y := t.y0; y < t.y1; y++ {
		for x := t.x0; x < t.x1; x++ {
			i := y*w + x
			if !px.opaque[i] {
				continue
			}
			b := 0
			for c := range 3 {
				span := hi[c] - lo[c] + 1
				q := (int(px.rgb[i*3+c]) - lo[c]) * 4 / span
				b = b*4 + min(q, 3)
			}
			counts[b]++
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(counts[:])))
	top := 0
	for _, c := range counts[:6] {
		top += c
	}
	t.cover = float64(top) / float64(t.n)
}

func chanDiff(px *pixels, i, j int) int {
	d := 0
	for c := range 3 {
		v := int(px.rgb[i*3+c]) - int(px.rgb[j*3+c])
		if v < 0 {
			v = -v
		}
		d = max(d, v)
	}
	return d
}

// seamOK is true when the pixels along the border between two neighbouring tiles continue into
// each other (a ramp), instead of jumping (an edge).
func seamOK(px *pixels, a, b tileStat, horizontal bool) bool {
	w := px.w
	bad, n := 0, 0
	if horizontal {
		for y := a.y0; y < a.y1; y++ {
			i, j := y*w+a.x1-1, y*w+b.x0
			if px.opaque[i] && px.opaque[j] {
				n++
				if chanDiff(px, i, j) > sharpStep {
					bad++
				}
			}
		}
	} else {
		for x := a.x0; x < a.x1; x++ {
			i, j := (a.y1-1)*w+x, b.y0*w+x
			if px.opaque[i] && px.opaque[j] {
				n++
				if chanDiff(px, i, j) > sharpStep {
					bad++
				}
			}
		}
	}
	return n > 0 && float64(bad)/float64(n) <= 0.03
}

// ---- text ----

type textBlock struct {
	rect     image.Rectangle
	fontSize float64
	lines    int
	glyphH   float64
	members  map[int]bool
}

type glyph struct {
	idx            int
	x0, y0, x1, y1 int
	label          uint8
}

func (g glyph) h() float64  { return float64(g.y1 - g.y0 + 1) }
func (g glyph) w() float64  { return float64(g.x1 - g.x0 + 1) }
func (g glyph) cy() float64 { return float64(g.y0+g.y1) / 2 }

type textLine struct {
	g      []glyph
	label  uint8
	sumH   float64
	sumB   float64
	sumC   float64
	right  int
	rect   image.Rectangle
	absorb []int
}

func (l *textLine) add(g glyph) {
	l.g = append(l.g, g)
	l.sumH += g.h()
	l.sumB += float64(g.y1)
	l.sumC += g.cy()
	l.right = max(l.right, g.x1)
	r := image.Rect(g.x0, g.y0, g.x1+1, g.y1+1)
	if len(l.g) == 1 {
		l.rect = r
	} else {
		l.rect = l.rect.Union(r)
	}
}
func (l *textLine) mh() float64 { return l.sumH / float64(len(l.g)) }

// findText groups small blobs of similar height that sit on a common baseline into lines (at
// least 4 glyph-like blobs, with the gaps of words, not of icons), and lines of the same type
// into blocks.
func findText(comps []comp, w, h int, skip func(comp) bool) []textBlock {
	var cands []glyph
	for i, c := range comps {
		g := glyph{idx: i, x0: c.minX, y0: c.minY, x1: c.maxX, y1: c.maxY, label: c.label}
		if g.h() < 3 || g.h() > 0.3*float64(h) || g.w() > 3*g.h() || skip(c) {
			continue
		}
		cands = append(cands, g)
	}
	// holes of letters ('o', 'e') are comps of their own inside another candidate
	var glyphs []glyph
	for i, g := range cands {
		inside := false
		for j, o := range cands {
			if i != j && g.x0 >= o.x0 && g.x1 <= o.x1 && g.y0 >= o.y0 && g.y1 <= o.y1 && (g.w()*g.h() < o.w()*o.h() || (g.w()*g.h() == o.w()*o.h() && i > j)) {
				inside = true
				break
			}
		}
		if !inside {
			glyphs = append(glyphs, g)
		}
	}
	if len(glyphs) < 4 {
		return nil
	}
	sort.SliceStable(glyphs, func(i, j int) bool { return glyphs[i].x0 < glyphs[j].x0 })
	var lines []*textLine
	for _, g := range glyphs {
		var best *textLine
		bestD := math.MaxFloat64
		for _, l := range lines {
			if l.label != g.label {
				continue
			}
			mh := l.mh()
			if r := g.h() / mh; r < 0.55 || r > 1.8 {
				continue
			}
			if float64(g.x0-l.right) > 3.5*mh {
				continue
			}
			n := float64(len(l.g))
			d := math.Min(math.Abs(float64(g.y1)-l.sumB/n), math.Abs(g.cy()-l.sumC/n))
			if d > 0.25*mh || d >= bestD {
				continue
			}
			best, bestD = l, d
		}
		if best == nil {
			best = &textLine{label: g.label}
			lines = append(lines, best)
		}
		best.add(g)
	}
	var good []*textLine
	for _, l := range lines {
		if len(l.g) < 4 || !glyphLike(l) {
			continue
		}
		good = append(good, l)
	}
	// small marks (dots, accents, holes) inside the line's box belong to it
	for _, l := range good {
		mh := l.mh()
		box := image.Rect(l.rect.Min.X, l.rect.Min.Y-int(0.6*mh), l.rect.Max.X, l.rect.Max.Y+int(0.6*mh))
		inLine := map[int]bool{}
		for _, g := range l.g {
			inLine[g.idx] = true
		}
		for i, c := range comps {
			if inLine[i] || skip(c) {
				continue
			}
			cc := image.Pt((c.minX+c.maxX)/2, (c.minY+c.maxY)/2)
			if cc.In(box) && float64(c.maxY-c.minY+1) <= 1.4*mh && float64(c.maxX-c.minX+1) <= 3*mh {
				l.absorb = append(l.absorb, i)
				l.rect = l.rect.Union(image.Rect(c.minX, c.minY, c.maxX+1, c.maxY+1))
			}
		}
	}
	sort.SliceStable(good, func(i, j int) bool { return good[i].rect.Min.Y < good[j].rect.Min.Y })
	var blocks [][]*textLine
	for _, l := range good {
		placed := false
		for bi, b := range blocks {
			last := b[len(b)-1]
			if last.label != l.label {
				continue
			}
			if r := l.mh() / last.mh(); r < 0.7 || r > 1.4 {
				continue
			}
			if float64(l.rect.Min.Y-last.rect.Max.Y) > 1.1*last.mh() {
				continue
			}
			ov := min(l.rect.Max.X, last.rect.Max.X) - max(l.rect.Min.X, last.rect.Min.X)
			if float64(ov) < 0.4*float64(min(l.rect.Dx(), last.rect.Dx())) {
				continue
			}
			blocks[bi] = append(b, l)
			placed = true
			break
		}
		if !placed {
			blocks = append(blocks, []*textLine{l})
		}
	}
	var out []textBlock
	for _, b := range blocks {
		tb := textBlock{members: map[int]bool{}, lines: len(b)}
		var hs []float64
		for _, l := range b {
			if tb.rect.Empty() {
				tb.rect = l.rect
			} else {
				tb.rect = tb.rect.Union(l.rect)
			}
			for _, g := range l.g {
				tb.members[g.idx] = true
				hs = append(hs, g.h())
			}
			for _, i := range l.absorb {
				tb.members[i] = true
			}
		}
		sort.Float64s(hs)
		tb.glyphH = hs[len(hs)*3/4]
		tb.fontSize = tb.glyphH / 0.72
		tb.rect = tb.rect.Inset(-1).Intersect(image.Rect(0, 0, w, h))
		out = append(out, tb)
	}
	// blocks must not overlap: drop the smaller of two that do
	sort.SliceStable(out, func(i, j int) bool { return len(out[i].members) > len(out[j].members) })
	var kept []textBlock
	for _, b := range out {
		ok := true
		for _, k := range kept {
			if b.rect.Overlaps(k.rect) {
				ok = false
				break
			}
		}
		if ok {
			kept = append(kept, b)
		}
	}
	return kept
}

// glyphLike is false for rows of near-identical, widely spaced blobs (dots, icons, buttons).
func glyphLike(l *textLine) bool {
	n := float64(len(l.g))
	var mw, mhh float64
	for _, g := range l.g {
		mw += g.w()
		mhh += g.h()
	}
	mw, mhh = mw/n, mhh/n
	var vw, vh float64
	for _, g := range l.g {
		vw += (g.w() - mw) * (g.w() - mw)
		vh += (g.h() - mhh) * (g.h() - mhh)
	}
	cvw, cvh := math.Sqrt(vw/n)/mw, math.Sqrt(vh/n)/mhh
	if cvw < 0.07 && cvh < 0.07 {
		return false
	}
	// word gaps are a fraction of the glyph height, icon gaps are not
	gaps, ng := 0.0, 0
	gl := append([]glyph(nil), l.g...)
	sort.SliceStable(gl, func(i, j int) bool { return gl[i].x0 < gl[j].x0 })
	for i := 1; i < len(gl); i++ {
		gaps += math.Max(0, float64(gl[i].x0-gl[i-1].x1-1))
		ng++
	}
	return ng == 0 || gaps/float64(ng) <= 1.6*l.mh()
}
