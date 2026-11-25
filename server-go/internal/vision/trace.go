package vision

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"math"
	"sort"
	"strconv"
	"strings"

	xdraw "golang.org/x/image/draw"
)

const (
	DefaultCorner    = 50.0 // degrees of turning that make a corner
	DefaultTolerance = 1.0  // px, largest distance between a curve and the contour it follows
	DefaultMaxPaths  = 60
	traceMaxSide     = 640
	// the contours are sub-pixel accurate, so the fit may use only part of the tolerance: a straight
	// side fitted with the whole of it shows as a gentle wave when zoomed
	fitTolShare = 0.4
	cornerSlack = 0.88 // share of the corner angle the sub-pixel contour has to show
)

// TraceOptions tunes Trace. Zero values pick the defaults.
type TraceOptions struct {
	MaxColors         int
	MinArea           float64  // smallest blob, as a fraction of the analyzed area (default 0.0005)
	Region            *Rect    // sub-rectangle of the image, in source pixels
	Corner            float64  // turning angle in degrees from which a point is a corner (default 50)
	Tolerance         float64  // output px (default 1)
	Colors            []string // palette subset to trace (hex); empty = all
	IncludeBackground bool
	MaxPaths          int // default 60
	// BlobIDs traces only these blobs, named as analyze_image names them (b1, b2...: the same
	// segmentation, so the same ids for the same image, region, MaxColors and MinArea). Colors and
	// IncludeBackground are ignored then.
	BlobIDs []string
	// Exclude skips the blobs whose box lies inside any of these rectangles, in the output space.
	Exclude []Rect
	// Scale and Offset place the image in the output space, as in Options.
	Scale, OffsetX, OffsetY float64
}

// TracedPath is one blob as a single path: the outer contour plus the holes, to be filled with
// the even-odd rule. D is in the output space.
type TracedPath struct {
	BlobID   string  `json:"blobId,omitempty"` // as analyze_image numbers it (the background that touches the border has none)
	Color    string  `json:"color"`
	D        string  `json:"d,omitempty"`
	BBox     Rect    `json:"bbox"`
	Share    float64 `json:"share"` // of the analyzed area, holes excluded
	Rings    int     `json:"rings"` // 1 + holes
	Holes    int     `json:"holes"`
	Points   int     `json:"points"`   // anchors
	Segments int     `json:"segments"` // lines + cubics
	Curves   int     `json:"curves"`
	Lines    int     `json:"lines"`
	Corners  int     `json:"corners"`
	Error    float64 `json:"error"` // largest distance from the contour to the fit, output px
}

// Skipped counts the blobs that blobIds or exclude left out (they are not in pathCount).
type Skipped struct {
	Excluded  int `json:"excluded"`  // box inside an exclude rectangle
	NotListed int `json:"notListed"` // not in blobIds
	Slivers   int `json:"slivers"`   // anti-aliasing rims between two colors, absorbed by the shapes on both sides
}

type TraceResult struct {
	Size       Size           `json:"size"`
	Region     Rect           `json:"region"`
	Placed     *Rect          `json:"placed,omitempty"`
	Scale      float64        `json:"scale"`
	Background Background     `json:"background"`
	Palette    []PaletteEntry `json:"palette"`
	Paths      []TracedPath   `json:"paths"`
	PathCount  int            `json:"pathCount"` // found, before the maxPaths cut
	Truncated  bool           `json:"truncated"`
	Dropped    int            `json:"dropped"`    // found but not drawn (maxPaths)
	DroppedIDs []string       `json:"droppedIds"` // their blob ids, most important first
	Skipped    Skipped        `json:"skipped"`
	Points     int            `json:"points"`   // anchors over all paths
	Segments   int            `json:"segments"` // segments over all paths
	MaxError   float64        `json:"maxError"`
	Warnings   []string       `json:"warnings"`
}

func parseHex(s string) (lab, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) == 3 {
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	}
	if len(s) != 6 {
		return lab{}, false
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return lab{}, false
	}
	return labFromBytes(uint8(v>>16), uint8(v>>8), uint8(v)), true
}

type traceBlob struct {
	c     comp
	mask  []bool // local to the box, holes still in
	fill  []bool
	w, h  int
	areaF int
	holes [][]int // local pixel indexes of every hole
}

// holesOf floods the background from outside the padded box (4-connected) and returns the
// enclosed regions.
func holesOf(mask []bool, w, h int) (filled []bool, holes [][]int) {
	pw, ph := w+2, h+2
	seen := make([]bool, pw*ph)
	at := func(x, y int) bool {
		x, y = x-1, y-1
		return x >= 0 && y >= 0 && x < w && y < h && mask[y*w+x]
	}
	var q []int
	flood := func(sx, sy int, on func(x, y int)) {
		q = append(q[:0], sy*pw+sx)
		seen[sy*pw+sx] = true
		for len(q) > 0 {
			i := q[len(q)-1]
			q = q[:len(q)-1]
			x, y := i%pw, i/pw
			if on != nil {
				on(x, y)
			}
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				nx, ny := x+d[0], y+d[1]
				if nx < 0 || ny < 0 || nx >= pw || ny >= ph {
					continue
				}
				if j := ny*pw + nx; !seen[j] && !at(nx, ny) {
					seen[j] = true
					q = append(q, j)
				}
			}
		}
	}
	flood(0, 0, nil)
	filled = append([]bool(nil), mask...)
	for y := range ph {
		for x := range pw {
			if seen[y*pw+x] || at(x, y) {
				continue
			}
			var cells []int
			flood(x, y, func(cx, cy int) {
				cells = append(cells, (cy-1)*w+cx-1)
				filled[(cy-1)*w+cx-1] = true
			})
			holes = append(holes, cells)
		}
	}
	return filled, holes
}

// Trace vectorizes img: every palette-color blob becomes one path (outer contour and holes as
// bezier subpaths, to be filled even-odd), largest silhouette first so nested shapes land on top.
func Trace(img image.Image, opt TraceOptions) (*TraceResult, error) {
	b := img.Bounds()
	if b.Dx() < 1 || b.Dy() < 1 {
		return nil, errors.New("image has no pixels")
	}
	if opt.MaxColors <= 0 {
		opt.MaxColors = DefaultMaxColors
	}
	opt.MaxColors = min(opt.MaxColors, 16)
	if opt.MinArea <= 0 {
		opt.MinArea = DefaultMinArea
	}
	if opt.MinArea >= 1 {
		return nil, errors.New("minArea is a fraction of the image (0..1)")
	}
	if opt.Corner <= 0 {
		opt.Corner = DefaultCorner
	}
	if opt.Tolerance <= 0 {
		opt.Tolerance = DefaultTolerance
	}
	if opt.MaxPaths <= 0 {
		opt.MaxPaths = DefaultMaxPaths
	}
	if opt.Scale <= 0 {
		opt.Scale = 1
	}
	reg := image.Rect(0, 0, b.Dx(), b.Dy())
	if opt.Region != nil {
		reg = reg.Intersect(image.Rect(int(math.Floor(opt.Region.X)), int(math.Floor(opt.Region.Y)),
			int(math.Ceil(opt.Region.X+opt.Region.Width)), int(math.Ceil(opt.Region.Y+opt.Region.Height))))
		if reg.Empty() {
			return nil, errors.New("region is outside the image")
		}
	}
	rw, rh := reg.Dx(), reg.Dy()
	s := math.Min(1, float64(traceMaxSide)/float64(max(rw, rh)))
	aw, ah := max(1, int(math.Round(float64(rw)*s))), max(1, int(math.Round(float64(rh)*s)))
	nrgba := image.NewNRGBA(image.Rect(0, 0, aw, ah))
	src := image.Rect(b.Min.X+reg.Min.X, b.Min.Y+reg.Min.Y, b.Min.X+reg.Max.X, b.Min.Y+reg.Max.Y)
	if aw == rw && ah == rh {
		draw.Draw(nrgba, nrgba.Bounds(), img, src.Min, draw.Src)
	} else {
		xdraw.BiLinear.Scale(nrgba, nrgba.Bounds(), img, src, xdraw.Src, nil)
	}
	kx, ky := opt.Scale*float64(rw)/float64(aw), opt.Scale*float64(rh)/float64(ah)
	ox, oy := opt.OffsetX+float64(reg.Min.X)*opt.Scale, opt.OffsetY+float64(reg.Min.Y)*opt.Scale

	res := &TraceResult{
		Size:     Size{Width: b.Dx(), Height: b.Dy()},
		Region:   Rect{X: float64(reg.Min.X), Y: float64(reg.Min.Y), Width: float64(rw), Height: float64(rh)},
		Scale:    r3(opt.Scale),
		Palette:  []PaletteEntry{},
		Paths:    []TracedPath{},
		Warnings: []string{},
	}
	px := prepare(nrgba)
	pal := quantize(px, opt.MaxColors, opt.MinArea)
	total := float64(aw * ah)
	if len(pal) == 0 {
		res.Background = Background{Transparent: true, BorderShare: 1}
		res.Warnings = append(res.Warnings, "the image is fully transparent")
		return res, nil
	}
	labels := assignLabels(px, pal)
	counts := make([]int, len(pal)+1)
	for _, l := range labels {
		if l == 255 {
			counts[len(pal)]++
		} else {
			counts[l]++
		}
	}
	for i, p := range pal {
		res.Palette = append(res.Palette, PaletteEntry{Color: p.hex, Share: r3(float64(counts[i]) / total)})
	}
	border := make([]int, len(pal)+1)
	nb := 0
	visit := func(x, y int) {
		l := labels[y*aw+x]
		if l == 255 {
			l = uint8(len(pal))
		}
		border[l]++
		nb++
	}
	for x := range aw {
		visit(x, 0)
		if ah > 1 {
			visit(x, ah-1)
		}
	}
	for y := 1; y < ah-1; y++ {
		visit(0, y)
		if aw > 1 {
			visit(aw-1, y)
		}
	}
	bgLabel := 0
	for i := range border {
		if border[i] > border[bgLabel] {
			bgLabel = i
		}
	}
	res.Background.BorderShare = r3(float64(border[bgLabel]) / float64(nb))
	bgSolid := res.Background.BorderShare >= 0.5
	if bgLabel == len(pal) {
		res.Background.Transparent = true
	} else {
		res.Background.Color = pal[bgLabel].hex
	}

	// which palette colors to trace
	want := make([]bool, len(pal))
	for i := range want {
		want[i] = len(opt.Colors) == 0
	}
	for _, c := range opt.Colors {
		l, ok := parseHex(c)
		if !ok {
			return nil, fmt.Errorf("colors: %q is not a hex color", c)
		}
		bi, bd := 0, math.MaxFloat64
		for i, p := range pal {
			if d := p.lab.dist2(l); d < bd {
				bi, bd = i, d
			}
		}
		if bd > 0.02*0.02*4 { // about 0.04 OKLab: further than a rounding of the hex
			res.Warnings = append(res.Warnings, fmt.Sprintf("color %s is not in the palette (nearest %s): traced that one", c, pal[bi].hex))
		}
		want[bi] = true
	}

	ids, comps := components(labels, aw, ah)
	minPx := max(4, int(math.Round(opt.MinArea*total)))
	// anti-aliasing rims between two colors are not shapes: they keep their id (the numbering is
	// analyze_image's) but are not traced, and their pixels go to the shapes on both sides
	sliver := sliverComps(ids, labels, comps, pal, px, aw, ah, minPx)
	real := make([]bool, len(comps)+1)
	for i, c := range comps {
		real[i+1] = c.area >= minPx && !sliver[i+1]
	}
	eids := absorb(ids, real, comps, px, pal, aw, ah)
	// analyze_image's numbering: blobs that pass minArea and are not the background touching the
	// border, largest first, b1, b2... (the analysis side is the same, so the segmentation is too).
	var numbered []comp
	for _, c := range comps {
		if c.area < minPx || (bgSolid && bgLabel < len(pal) && int(c.label) == bgLabel && c.touches) {
			continue
		}
		numbered = append(numbered, c)
	}
	sort.SliceStable(numbered, func(i, j int) bool { return numbered[i].area > numbered[j].area })
	// blobs analyze_image leaves out (specks inside a photo region) are not numbered
	{
		raws := classifyRegions(px, grainRaster(img, src, px), numbered)
		pick := listedBlobs(raws, assignRegions(raws, numbered), len(numbered))
		listedNum := make([]comp, len(pick))
		for n, i := range pick {
			listedNum[n] = numbered[i]
		}
		numbered = listedNum
	}
	blobID := make(map[int32]string, len(numbered))
	byID := make(map[string]comp, len(numbered))
	for i, c := range numbered {
		id := fmt.Sprintf("b%d", i+1)
		blobID[c.id] = id
		byID[id] = c
	}
	listed := map[int32]bool{}
	for _, id := range opt.BlobIDs {
		c, ok := byID[id]
		if !ok {
			res.Warnings = append(res.Warnings, fmt.Sprintf("blobIds: %q matches no blob (analyze_image with the same src, region, maxColors and minArea gives the ids)", id))
			continue
		}
		listed[c.id] = true
	}
	// contrast against the background decides what to keep when there are too many
	var bgLab *lab
	if bgLabel < len(pal) {
		bgLab = &pal[bgLabel].lab
	}
	importance := func(c comp) float64 {
		k := 1.0
		if bgLab != nil {
			k = math.Max(0.02, math.Sqrt(pal[c.label].lab.dist2(*bgLab)))
		}
		return float64(c.area) * k
	}
	inExclude := func(c comp) bool {
		x0, y0 := ox+float64(c.minX)*kx, oy+float64(c.minY)*ky
		x1, y1 := ox+float64(c.maxX+1)*kx, oy+float64(c.maxY+1)*ky
		for _, e := range opt.Exclude {
			if x0 >= e.X-1 && y0 >= e.Y-1 && x1 <= e.X+e.Width+1 && y1 <= e.Y+e.Height+1 {
				return true
			}
		}
		return false
	}
	var sel []comp
	for _, c := range comps {
		if c.area < minPx {
			continue
		}
		if len(opt.BlobIDs) > 0 {
			if blobID[c.id] == "" {
				continue
			}
			if !listed[c.id] {
				res.Skipped.NotListed++
				continue
			}
		} else if !want[c.label] || (!opt.IncludeBackground && bgSolid && bgLabel < len(pal) && int(c.label) == bgLabel) {
			continue
		}
		if sliver[c.id] {
			res.Skipped.Slivers++
			if len(opt.BlobIDs) > 0 {
				res.Warnings = append(res.Warnings, fmt.Sprintf("blobIds: %s is an anti-aliasing rim between two colors, not a shape: the shapes on both sides take its pixels", blobID[c.id]))
			}
			continue
		}
		if inExclude(c) {
			res.Skipped.Excluded++
			continue
		}
		sel = append(sel, c)
	}
	sort.SliceStable(sel, func(i, j int) bool { return importance(sel[i]) > importance(sel[j]) })
	res.PathCount = len(sel)
	var rest []comp
	if len(sel) > 2*opt.MaxPaths { // the silhouette order only matters among the most important
		rest = sel[2*opt.MaxPaths:]
		sel = sel[:2*opt.MaxPaths]
	}
	traced := make(map[int32]bool, len(sel))
	blobs := make([]*traceBlob, len(sel))
	for i, c := range sel {
		tb := &traceBlob{c: c, w: c.maxX - c.minX + 1, h: c.maxY - c.minY + 1}
		tb.mask = make([]bool, tb.w*tb.h)
		for y := range tb.h {
			row := (c.minY+y)*aw + c.minX
			for x := range tb.w {
				tb.mask[y*tb.w+x] = ids[row+x] == c.id
			}
		}
		tb.fill, tb.holes = holesOf(tb.mask, tb.w, tb.h)
		for _, v := range tb.fill {
			if v {
				tb.areaF++
			}
		}
		blobs[i] = tb
	}
	filledImp := func(tb *traceBlob) float64 { return importance(tb.c) * float64(tb.areaF) / float64(tb.c.area) }
	sort.SliceStable(blobs, func(i, j int) bool { return filledImp(blobs[i]) > filledImp(blobs[j]) })
	var cut []*traceBlob
	if len(blobs) > opt.MaxPaths {
		blobs, cut = blobs[:opt.MaxPaths], blobs[opt.MaxPaths:]
	}
	res.Truncated = res.PathCount > len(blobs)
	res.DroppedIDs = []string{}
	res.Dropped = len(cut) + len(rest)
	for _, tb := range cut {
		if id := blobID[tb.c.id]; id != "" {
			res.DroppedIDs = append(res.DroppedIDs, id)
		}
	}
	for _, c := range rest {
		if id := blobID[c.id]; id != "" {
			res.DroppedIDs = append(res.DroppedIDs, id)
		}
	}
	// drawn largest silhouette first, so nested shapes land on top
	sort.SliceStable(blobs, func(i, j int) bool { return blobs[i].areaF > blobs[j].areaF })
	for _, tb := range blobs {
		traced[tb.c.id] = true
	}

	// the contours come from the source at up to traceHiMax px, read against the blobs
	hs := math.Min(1, float64(traceHiMax)/float64(max(rw, rh)))
	hw, hh := max(aw, int(math.Round(float64(rw)*hs))), max(ah, int(math.Round(float64(rh)*hs)))
	hi := nrgba
	if hw != aw || hh != ah {
		hi = image.NewNRGBA(image.Rect(0, 0, hw, hh))
		if hw == rw && hh == rh {
			draw.Draw(hi, hi.Bounds(), img, src.Min, draw.Src)
		} else {
			xdraw.BiLinear.Scale(hi, hi.Bounds(), img, src, xdraw.Src, nil)
		}
	}
	khx, khy := opt.Scale*float64(rw)/float64(hw), opt.Scale*float64(rh)/float64(hh)
	khs := (khx + khy) / 2
	field := buildHiField(hi, eids, real, comps, pal, aw, ah)
	rank := make(map[int32]int, len(blobs))
	for i, tb := range blobs {
		rank[tb.c.id] = i
	}
	reach := min(4, max(1, int(math.Ceil(1/khs))))
	tolHi := math.Max(fitTolShare*opt.Tolerance/khs, 0.3)
	kc := min(10, max(4, int(math.Round(5/khs))))
	// marching squares cuts a sharp corner by about a pixel, which lowers the turn measured there
	thr := cornerSlack * opt.Corner * math.Pi / 180
	holeFloor := max(3, minPx/4)
	sx, sy := float64(aw)/float64(hw), float64(ah)/float64(hh)
	to := func(p pt) pt { return pt{ox + p.x*khx, oy + p.y*khy} }
	for _, tb := range blobs {
		c := tb.c
		mx := int(math.Ceil(2*float64(hw)/float64(aw))) + reach
		x0, y0 := max(0, int(math.Floor(float64(c.minX)/sx))-mx), max(0, int(math.Floor(float64(c.minY)/sy))-mx)
		x1, y1 := min(hw, int(math.Ceil(float64(c.maxX+1)/sx))+mx), min(hh, int(math.Ceil(float64(c.maxY+1)/sy))+mx)
		fld, fw, fh := field.fieldOf(c.id, rank, x0, y0, x1, y1, reach)
		if fld == nil {
			continue
		}
		var loops [][]pt
		for _, lp := range contourLoops(fld, fw, fh) {
			for i := range lp {
				lp[i] = pt{lp[i].x + float64(x0-1), lp[i].y + float64(y0-1)}
			}
			loops = append(loops, lp)
		}
		outer, big := 1.0, 0.0
		for _, lp := range loops {
			if a := ringArea(lp); math.Abs(a) > big {
				big, outer = math.Abs(a), math.Copysign(1, a)
			}
		}
		var rings [][]pt
		for _, lp := range loops {
			a := ringArea(lp)
			if math.Abs(a)*sx*sy < float64(holeFloor) {
				continue
			}
			if a*outer < 0 {
				// a hole stays open when it shows the background or an untraced area; one that
				// another traced blob fills is closed, so the blob drawn on top leaves no seam.
				total, covered := 0, 0
				scanLoop(lp, sx, sy, aw, ah, func(i int) {
					total++
					if traced[eids[i]] {
						covered++
					}
				})
				if total < holeFloor || covered*2 >= total {
					continue
				}
			}
			rings = append(rings, lp)
		}
		if len(rings) == 0 {
			continue
		}
		tp := TracedPath{BlobID: blobID[c.id], Color: pal[c.label].hex, Rings: len(rings), Holes: len(rings) - 1, Share: r3(float64(tb.areaF) / total)}
		var d strings.Builder
		minX, minY, maxX, maxY := math.MaxFloat64, math.MaxFloat64, -math.MaxFloat64, -math.MaxFloat64
		grow := func(p pt) {
			minX, minY = math.Min(minX, p.x), math.Min(minY, p.y)
			maxX, maxY = math.Max(maxX, p.x), math.Max(maxY, p.y)
		}
		for _, lp := range rings {
			f := fitRing(lp, thr, tolHi, kc)
			p0 := to(f.start)
			fmt.Fprintf(&d, "M%s %s", num2(p0.x), num2(p0.y))
			grow(p0)
			cur := f.start
			for _, sg := range f.segs {
				if sg.line {
					e := to(sg.b[3])
					fmt.Fprintf(&d, "L%s %s", num2(e.x), num2(e.y))
					grow(e)
					tp.Lines++
				} else {
					b := bez{cur, sg.b[1], sg.b[2], sg.b[3]}
					var o bez
					for i := range b {
						o[i] = to(b[i])
					}
					fmt.Fprintf(&d, "C%s %s %s %s %s %s", num2(o[1].x), num2(o[1].y), num2(o[2].x), num2(o[2].y), num2(o[3].x), num2(o[3].y))
					for i := 0; i <= 32; i++ {
						grow(bezPoint(o, float64(i)/32))
					}
					tp.Curves++
				}
				cur = sg.b[3]
			}
			d.WriteString("Z")
			tp.Points += len(f.segs)
			tp.Corners += f.corners
			tp.Error = math.Max(tp.Error, f.err*khs)
		}
		tp.Segments = tp.Lines + tp.Curves
		tp.D = d.String()
		tp.BBox = Rect{X: r1(minX), Y: r1(minY), Width: r1(maxX - minX), Height: r1(maxY - minY)}
		tp.Error = r3(tp.Error)
		res.Points += tp.Points
		res.Segments += tp.Segments
		res.MaxError = math.Max(res.MaxError, tp.Error)
		res.Paths = append(res.Paths, tp)
	}
	return res, nil
}

// scanLoop calls fn with the index of every analysis pixel whose center lies inside the loop
// (hi-res coordinates; sx, sy convert them to analysis pixels), even-odd.
func scanLoop(lp []pt, sx, sy float64, aw, ah int, fn func(i int)) {
	minY, maxY := math.MaxFloat64, -math.MaxFloat64
	for _, p := range lp {
		minY, maxY = math.Min(minY, p.y*sy), math.Max(maxY, p.y*sy)
	}
	var xs []float64
	for y := max(0, int(math.Floor(minY))); y <= min(ah-1, int(math.Ceil(maxY))); y++ {
		yc := float64(y) + 0.5
		xs = xs[:0]
		for i := range lp {
			a, b := lp[i], lp[(i+1)%len(lp)]
			ay, by := a.y*sy, b.y*sy
			if (ay > yc) != (by > yc) {
				xs = append(xs, (a.x+(yc-ay)/(by-ay)*(b.x-a.x))*sx)
			}
		}
		sort.Float64s(xs)
		for k := 0; k+1 < len(xs); k += 2 {
			for x := max(0, int(math.Ceil(xs[k]-0.5))); x <= min(aw-1, int(math.Floor(xs[k+1]-0.5))); x++ {
				fn(y*aw + x)
			}
		}
	}
}

func num2(v float64) string {
	return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64)
}
