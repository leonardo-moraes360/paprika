package vision

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"math"
	"sort"
	"strings"

	xdraw "golang.org/x/image/draw"
)

// Compare measures how close a drawing is to a reference. Both are rasterized onto the same
// canvas (the frame, at most compareMaxSide px on the long side) and reduced to ink masks: the
// pixels that differ from each image's own background. Shape scores use only those masks, so a
// large empty background cannot inflate them.
const (
	compareMaxSide    = 800
	inkThreshold      = 0.06 // OKLab distance from the background that counts as ink
	rawMatchThreshold = 0.04 // OKLab distance under which two pixels count as equal (raw match)
	DefaultTarget     = 0.9
	DefaultTop        = 8
)

// NodeBox is a node's painted box in frame coordinates (corners after rotation: TL, TR, BR, BL).
type NodeBox struct {
	ID, Name, Type string
	Corners        [4]Point
	Ellipse        bool
}

// CompareInput carries the two images and what is known about the frame.
type CompareInput struct {
	Drawn, Ref     image.Image
	FrameW, FrameH float64
	Placed         Rect // where the reference sits in the frame (fitted and centered)
	Nodes          []NodeBox
	Target         float64
	EdgeTarget     float64 // edge score the drawing must reach to pass (0 = the edge metric is reported but does not decide pass)
	Top            int
	Rotate         bool // also search a small rotation in the global alignment
}

type ColorMatch struct {
	Reference string  `json:"reference"`
	Drawn     string  `json:"drawn"`
	DeltaE    float64 `json:"deltaE"`
	Share     float64 `json:"share"` // of the reference's ink
}

type ColorExtra struct {
	Color   string  `json:"color"`
	Share   float64 `json:"share"` // of the drawn ink
	Nearest string  `json:"nearestReference"`
	DeltaE  float64 `json:"deltaE"`
}

type ColorScore struct {
	DeltaE      float64      `json:"deltaE"`      // mean OKLab distance x100 between matched dominant colors, weighted by reference share
	PixelDeltaE float64      `json:"pixelDeltaE"` // mean distance x100 over the pixels both images paint (catches swapped colors)
	Score       float64      `json:"score"`       // 1 - max(deltaE, pixelDeltaE)/30, floored at 0
	Matches     []ColorMatch `json:"matches"`
	Unmatched   []ColorExtra `json:"unmatchedDrawn"`
}

type RawMatch struct {
	Value float64 `json:"value"`
	Note  string  `json:"note"`
}

type Region struct {
	Kind      string  `json:"kind"` // missing or extra
	Box       Rect    `json:"box"`
	AreaShare float64 `json:"areaShare"` // of the frame
	Color     string  `json:"color,omitempty"`
}

type Move struct {
	DX float64 `json:"dx"`
	DY float64 `json:"dy"`
}

type NodeCoverage struct {
	ID            string  `json:"id"`
	Name          string  `json:"name,omitempty"`
	Type          string  `json:"type"`
	Box           Rect    `json:"box"`
	OnReference   float64 `json:"onReference"`  // share of the node's painted pixels that sit on reference ink
	Extra         float64 `json:"extra"`        // 1 - onReference
	OffAreaShare  float64 `json:"offAreaShare"` // painted pixels off the reference, as a share of the frame
	SuggestedMove *Move   `json:"suggestedMove,omitempty"`
}

type Alignment struct {
	DX          float64 `json:"dx"` // move the drawing by this, in frame units (right, down)
	DY          float64 `json:"dy"`
	Scale       float64 `json:"scale"`    // then scale it by this around origin
	Rotation    float64 `json:"rotation"` // degrees clockwise around origin (0 unless rotation was asked for)
	Origin      Point   `json:"origin"`   // the frame center
	IoUBefore   float64 `json:"iouBefore"`
	IoUAfter    float64 `json:"iouAfter"`
	Significant bool    `json:"significant"` // the move gains at least 0.02 IoU
}

type Comparison struct {
	IoU        float64        `json:"iou"`     // ink intersection over union
	Missing    float64        `json:"missing"` // share of the reference's ink the drawing does not cover
	Extra      float64        `json:"extra"`   // share of the drawn ink that is not in the reference
	Target     float64        `json:"target"`
	Pass       bool           `json:"pass"`
	Edge       *Edge          `json:"edge,omitempty"` // contour distance between the reference ink and the drawn ink
	InkShare   InkShare       `json:"ink"`
	Color      ColorScore     `json:"color"`
	RawMatch   RawMatch       `json:"rawPixelMatch"`
	Regions    []Region       `json:"regions"`
	Nodes      []NodeCoverage `json:"nodes"`
	Alignment  *Alignment     `json:"alignment,omitempty"`
	Warnings   []string       `json:"warnings"`
	Background Backgrounds    `json:"background"`

	diff []byte
	// Canvas is the working size the masks were measured at.
	Canvas Size `json:"canvas"`
}

type InkShare struct {
	Reference float64 `json:"reference"` // share of the frame
	Drawn     float64 `json:"drawn"`
}

type Backgrounds struct {
	Reference      string         `json:"reference"` // hex (the mean color of a gradient), or "transparent"
	Drawn          string         `json:"drawn"`
	ReferenceModel BackgroundInfo `json:"referenceModel"` // flat, gradient or transparent, with the fit
	DrawnModel     BackgroundInfo `json:"drawnModel"`
}

// DiffPNG is the diff image: missing in red, extra in blue, matched in gray, on white.
func (c *Comparison) DiffPNG() []byte { return c.diff }

// plane is one image rasterized on the working canvas.
type plane struct {
	w, h int
	img  *image.NRGBA
	bg   bgInfo
	fit  bgFit // the background model; ink is the distance from it
	at   bgMap
	ink  []bool
	lab  []labf
	op   []bool // opaque pixel (alpha >= 128)
}

type bgInfo struct {
	transparent bool
	r, g, b     uint8
}

func (b bgInfo) hex() string {
	if b.transparent {
		return "transparent"
	}
	return hexOf([3]float64{float64(b.r), float64(b.g), float64(b.b)})
}

func estimateBG(at func(x, y int) color.NRGBA, w, h int) bgInfo {
	type acc struct{ n, r, g, b int }
	buckets := map[uint16]*acc{}
	nT, n := 0, 0
	visit := func(x, y int) {
		c := at(x, y)
		n++
		if c.A < 128 {
			nT++
			return
		}
		k := uint16(c.R>>3)<<10 | uint16(c.G>>3)<<5 | uint16(c.B>>3)
		a := buckets[k]
		if a == nil {
			a = &acc{}
			buckets[k] = a
		}
		a.n++
		a.r += int(c.R)
		a.g += int(c.G)
		a.b += int(c.B)
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
	bestK, bestN := uint16(0), 0
	keys := make([]int, 0, len(buckets))
	for k := range buckets {
		keys = append(keys, int(k))
	}
	sort.Ints(keys)
	for _, k := range keys {
		if a := buckets[uint16(k)]; a.n > bestN {
			bestK, bestN = uint16(k), a.n
		}
	}
	if nT >= bestN {
		return bgInfo{transparent: true}
	}
	a := buckets[bestK]
	return bgInfo{r: uint8(a.r / a.n), g: uint8(a.g / a.n), b: uint8(a.b / a.n)}
}

func fillNRGBA(img *image.NRGBA, c color.NRGBA) {
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, c.A
	}
}

// buildPlane computes the ink mask of img (already on the canvas) against its own background.
func buildPlane(img *image.NRGBA, fit bgFit, at bgMap) *plane {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	bg := fit.info
	p := &plane{w: w, h: h, img: img, bg: bg, fit: fit, at: at, ink: make([]bool, w*h), lab: make([]labf, w*h), op: make([]bool, w*h)}
	bgLab := labFromBytes(bg.r, bg.g, bg.b)
	thr := inkThreshold * inkThreshold
	for y := range h {
		row := img.Pix[y*img.Stride : y*img.Stride+w*4]
		for x := range w {
			i := y*w + x
			r, g, b, a := row[x*4], row[x*4+1], row[x*4+2], row[x*4+3]
			if bg.transparent {
				if a < 128 {
					continue
				}
				p.op[i] = true
				p.ink[i] = true
				c := labFromBytes(r, g, b)
				p.lab[i] = labf{float32(c.L), float32(c.A), float32(c.B)}
				continue
			}
			p.op[i] = true
			if fit.model != nil {
				u, v := at.uv(x, y)
				m := fit.model.at(u, v)
				c := labFromBytes(r, g, b)
				if a < 255 {
					f := float64(a) / 255
					c = lab{c.L*f + m.L*(1-f), c.A*f + m.A*(1-f), c.B*f + m.B*(1-f)}
				}
				p.lab[i] = labf{float32(c.L), float32(c.A), float32(c.B)}
				p.ink[i] = c.dist2(m) > thr
				continue
			}
			if a < 255 {
				f := float64(a) / 255
				r = uint8(math.Round(float64(r)*f + float64(bg.r)*(1-f)))
				g = uint8(math.Round(float64(g)*f + float64(bg.g)*(1-f)))
				b = uint8(math.Round(float64(b)*f + float64(bg.b)*(1-f)))
			}
			c := labFromBytes(r, g, b)
			p.lab[i] = labf{float32(c.L), float32(c.A), float32(c.B)}
			p.ink[i] = c.dist2(bgLab) > thr
		}
	}
	return p
}

func countTrue(m []bool) int {
	n := 0
	for _, v := range m {
		if v {
			n++
		}
	}
	return n
}

// canvasPlanes is the drawing and the reference on one working canvas, reduced to ink masks.
type canvasPlanes struct {
	w, h           int
	fx, fy         float64 // frame units per working pixel
	refBG, drawnBG bgInfo  // flat color, or the mean color of a gradient
	refFit, drwFit bgFit
	rp, dp         *plane
}

// fillBackground paints the whole canvas with the background: the flat color, or the model.
func fillBackground(img *image.NRGBA, fit bgFit, at bgMap) {
	if fit.model == nil {
		fillNRGBA(img, color.NRGBA{fit.info.r, fit.info.g, fit.info.b, 255})
		return
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	for y := range h {
		for x := range w {
			u, v := at.uv(x, y)
			r, g, b := labToRGB(fit.model.at(u, v))
			o := y*img.Stride + x*4
			img.Pix[o], img.Pix[o+1], img.Pix[o+2], img.Pix[o+3] = uint8(math.Round(r)), uint8(math.Round(g)), uint8(math.Round(b)), 255
		}
	}
}

// buildPlanes rasterizes both images on a canvas of the frame's proportions (at most maxSide px
// on the long side) and builds their ink masks, each against its own background model.
func buildPlanes(drawnSrc, refSrc image.Image, frameW, frameH float64, placed Rect, maxSide float64) canvasPlanes {
	k := math.Min(1, maxSide/math.Max(frameW, frameH))
	w, h := max(1, int(math.Round(frameW*k))), max(1, int(math.Round(frameH*k)))
	fx, fy := frameW/float64(w), frameH/float64(h)

	rb := refSrc.Bounds()
	dst := image.Rect(
		int(math.Round(placed.X/fx)), int(math.Round(placed.Y/fy)),
		int(math.Round((placed.X+placed.Width)/fx)), int(math.Round((placed.Y+placed.Height)/fy)),
	)
	if dst.Empty() {
		dst = image.Rect(0, 0, w, h)
	}
	// the reference on the canvas, over nothing: its background is fitted at the same resolution
	// as the drawing's, so an identical picture gets an identical model
	scaled := image.NewNRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(scaled, dst, refSrc, rb, xdraw.Src, nil)
	refFit := fitBackground(func(x, y int) color.NRGBA { return scaled.NRGBAAt(dst.Min.X+x, dst.Min.Y+y) }, dst.Dx(), dst.Dy())
	refMap := bgMap{ox: float64(dst.Min.X), oy: float64(dst.Min.Y), sx: float64(dst.Dx()), sy: float64(dst.Dy())}
	refImg := scaled
	if !refFit.info.transparent {
		refImg = image.NewNRGBA(image.Rect(0, 0, w, h))
		fillBackground(refImg, refFit, refMap)
		xdraw.Draw(refImg, refImg.Bounds(), scaled, image.Point{}, xdraw.Over)
	}

	drawn := image.NewNRGBA(image.Rect(0, 0, w, h))
	db := drawnSrc.Bounds()
	xdraw.CatmullRom.Scale(drawn, drawn.Bounds(), drawnSrc, db, xdraw.Src, nil)
	drwFit := fitBackground(func(x, y int) color.NRGBA { return drawn.NRGBAAt(x, y) }, w, h)
	drwMap := bgMap{sx: float64(w), sy: float64(h)}
	if drwFit.info.transparent && !refFit.info.transparent {
		// a drawing on a transparent frame sits on the reference's background
		base := image.NewNRGBA(image.Rect(0, 0, w, h))
		fillBackground(base, refFit, refMap)
		xdraw.Draw(base, base.Bounds(), drawn, image.Point{}, xdraw.Over)
		drawn = base
		drwFit, drwMap = refFit, refMap
	}

	return canvasPlanes{
		w: w, h: h, fx: fx, fy: fy, refBG: refFit.info, drawnBG: drwFit.info, refFit: refFit, drwFit: drwFit,
		rp: buildPlane(refImg, refFit, refMap), dp: buildPlane(drawn, drwFit, drwMap),
	}
}

// Compare runs the whole comparison.
func Compare(in CompareInput) (*Comparison, error) {
	if in.Drawn == nil || in.Ref == nil {
		return nil, errors.New("compare needs a drawing and a reference")
	}
	if in.FrameW <= 0 || in.FrameH <= 0 {
		return nil, errors.New("the frame has no size")
	}
	if in.Target <= 0 {
		in.Target = DefaultTarget
	}
	if in.Top <= 0 {
		in.Top = DefaultTop
	}
	cv := buildPlanes(in.Drawn, in.Ref, in.FrameW, in.FrameH, in.Placed, compareMaxSide)
	w, h, fx, fy := cv.w, cv.h, cv.fx, cv.fy
	total := float64(w * h)
	rp, dp := cv.rp, cv.dp
	res := &Comparison{
		Target: in.Target, Regions: []Region{}, Nodes: []NodeCoverage{}, Warnings: []string{},
		Canvas: Size{Width: w, Height: h},
		Background: Backgrounds{
			Reference: cv.refBG.hex(), Drawn: cv.drawnBG.hex(),
			ReferenceModel: cv.refFit.desc, DrawnModel: cv.drwFit.desc,
		},
	}

	inter, uni := 0, 0
	nRef, nDrawn := 0, 0
	rawEq := 0
	rawThr := float32(rawMatchThreshold * rawMatchThreshold)
	for i := range w * h {
		a, b := rp.ink[i], dp.ink[i]
		if a {
			nRef++
		}
		if b {
			nDrawn++
		}
		if a && b {
			inter++
		}
		if a || b {
			uni++
		}
		switch {
		case !rp.op[i] && !dp.op[i]:
			rawEq++
		case rp.op[i] && dp.op[i] && rp.lab[i].dist2(dp.lab[i].lab()) <= rawThr:
			rawEq++
		}
	}
	res.InkShare = InkShare{Reference: r3(float64(nRef) / total), Drawn: r3(float64(nDrawn) / total)}
	res.RawMatch = RawMatch{Value: r3(float64(rawEq) / total), Note: "context only, not a quality score: the background dominates, so unrelated drawings still read 85-95%; act on iou"}
	res.Warnings = append(res.Warnings, backgroundWarnings("reference", cv.refFit.desc)...)
	res.Warnings = append(res.Warnings, backgroundWarnings("drawing", cv.drwFit.desc)...)
	if nRef == 0 {
		res.Warnings = append(res.Warnings, "the reference has no ink (it is one flat color): nothing to compare")
	}
	if nDrawn == 0 {
		res.Warnings = append(res.Warnings, "the drawing has no ink (it is one flat color): nothing drawn yet?")
	}
	if uni > 0 {
		res.IoU = r3(float64(inter) / float64(uni))
	}
	if nRef > 0 {
		res.Missing = r3(float64(nRef-inter) / float64(nRef))
	}
	if nDrawn > 0 {
		res.Extra = r3(float64(nDrawn-inter) / float64(nDrawn))
	}
	res.Pass = res.IoU >= in.Target
	if nRef > 0 && nDrawn > 0 {
		res.Edge = edgeOf(in, cv)
		if res.Edge != nil && in.EdgeTarget > 0 {
			res.Pass = res.Pass && res.Edge.Pass
		}
	}

	res.Color = compareColors(rp, dp, nRef, nDrawn)
	res.Regions = findRegions(rp, dp, fx, fy, in.Top)
	res.Nodes = nodeCoverage(rp, dp, in.Nodes, fx, fy, in.Top)
	if nRef > 0 && nDrawn > 0 {
		res.Alignment = align(rp.ink, dp.ink, w, h, fx, fy, res.IoU, in.Rotate)
	}
	res.diff = diffPNG(rp.ink, dp.ink, w, h)
	return res, nil
}

func backgroundWarnings(side string, d BackgroundInfo) []string {
	var out []string
	if d.Kind == "gradient" {
		out = append(out, fmt.Sprintf("the %s background is a gradient (corners %s): ink is measured against the modelled background, not one color", side, strings.Join(d.Corners, " ")))
	}
	if d.Kind != "transparent" && d.Border < bgBorderOK {
		out = append(out, fmt.Sprintf("the %s border is not uniform (%.0f%% of it matches the background): content touching the edge may be counted as ink or as background", side, d.Border*100))
	}
	return out
}

func maskedImage(img *image.NRGBA, ink []bool) *image.NRGBA {
	out := image.NewNRGBA(img.Bounds())
	w := img.Bounds().Dx()
	for i, v := range ink {
		if !v {
			continue
		}
		y, x := i/w, i%w
		copy(out.Pix[y*out.Stride+x*4:y*out.Stride+x*4+4], img.Pix[y*img.Stride+x*4:y*img.Stride+x*4+4])
		out.Pix[y*out.Stride+x*4+3] = 255
	}
	return out
}

type shaded struct {
	pal    []paletteColor
	shares []float64
}

func inkPalette(p *plane, n int) shaded {
	if n == 0 {
		return shaded{}
	}
	px := prepare(maskedImage(p.img, p.ink))
	pal := quantize(px, DefaultMaxColors, 0.002)
	if len(pal) == 0 {
		return shaded{}
	}
	labels := assignLabels(px, pal)
	counts := make([]int, len(pal))
	tot := 0
	for _, l := range labels {
		if l != 255 {
			counts[l]++
			tot++
		}
	}
	s := shaded{pal: pal, shares: make([]float64, len(pal))}
	for i, c := range counts {
		if tot > 0 {
			s.shares[i] = float64(c) / float64(tot)
		}
	}
	return s
}

func compareColors(rp, dp *plane, nRef, nDrawn int) ColorScore {
	cs := ColorScore{Matches: []ColorMatch{}, Unmatched: []ColorExtra{}}
	rpal, dpal := inkPalette(rp, nRef), inkPalette(dp, nDrawn)
	if len(rpal.pal) > 0 && len(dpal.pal) > 0 {
		for i, rc := range rpal.pal {
			bj, bd := 0, math.MaxFloat64
			for j, dc := range dpal.pal {
				if d := rc.lab.dist2(dc.lab); d < bd {
					bj, bd = j, d
				}
			}
			de := math.Sqrt(bd) * 100
			cs.DeltaE += de * rpal.shares[i]
			cs.Matches = append(cs.Matches, ColorMatch{Reference: rc.hex, Drawn: dpal.pal[bj].hex, DeltaE: r1(de), Share: r3(rpal.shares[i])})
		}
		for j, dc := range dpal.pal {
			bi, bd := 0, math.MaxFloat64
			for i, rc := range rpal.pal {
				if d := dc.lab.dist2(rc.lab); d < bd {
					bi, bd = i, d
				}
			}
			if de := math.Sqrt(bd) * 100; de > 8 && dpal.shares[j] >= 0.02 {
				cs.Unmatched = append(cs.Unmatched, ColorExtra{Color: dc.hex, Share: r3(dpal.shares[j]), Nearest: rpal.pal[bi].hex, DeltaE: r1(de)})
			}
		}
	}
	// positional: pixels painted by both, away from edges (anti-aliasing)
	w, h := rp.w, rp.h
	both := make([]bool, w*h)
	for i := range both {
		both[i] = rp.ink[i] && dp.ink[i]
	}
	sum, n := 0.0, 0
	for y := 1; y < h-1; y++ {
		for x := 1; x < w-1; x++ {
			i := y*w + x
			if both[i] && both[i-1] && both[i+1] && both[i-w] && both[i+w] {
				sum += math.Sqrt(float64(rp.lab[i].dist2(dp.lab[i].lab())))
				n++
			}
		}
	}
	if n > 0 {
		cs.PixelDeltaE = sum / float64(n) * 100
	}
	cs.Score = math.Max(0, 1-math.Max(cs.DeltaE, cs.PixelDeltaE)/30)
	cs.DeltaE, cs.PixelDeltaE, cs.Score = r1(cs.DeltaE), r1(cs.PixelDeltaE), r3(cs.Score)
	return cs
}

func modeColor(p *plane, idx []int) string {
	type acc struct{ n, r, g, b int }
	m := map[uint16]*acc{}
	for _, i := range idx {
		y, x := i/p.w, i%p.w
		o := y*p.img.Stride + x*4
		r, g, b := p.img.Pix[o], p.img.Pix[o+1], p.img.Pix[o+2]
		k := uint16(r>>4)<<8 | uint16(g>>4)<<4 | uint16(b>>4)
		a := m[k]
		if a == nil {
			a = &acc{}
			m[k] = a
		}
		a.n++
		a.r += int(r)
		a.g += int(g)
		a.b += int(b)
	}
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, int(k))
	}
	sort.Ints(keys)
	var best *acc
	for _, k := range keys {
		if a := m[uint16(k)]; best == nil || a.n > best.n {
			best = a
		}
	}
	if best == nil {
		return ""
	}
	return hexOf([3]float64{float64(best.r) / float64(best.n), float64(best.g) / float64(best.n), float64(best.b) / float64(best.n)})
}

func findRegions(rp, dp *plane, fx, fy float64, top int) []Region {
	w, h := rp.w, rp.h
	total := w * h
	minPx := max(6, int(math.Round(0.0001*float64(total))))
	var out []Region
	for _, kind := range []string{"missing", "extra"} {
		mask := make([]bool, total)
		for i := range mask {
			if kind == "missing" {
				mask[i] = rp.ink[i] && !dp.ink[i]
			} else {
				mask[i] = dp.ink[i] && !rp.ink[i]
			}
		}
		labels := make([]uint8, total)
		for i, v := range mask {
			if v {
				labels[i] = 1
			} else {
				labels[i] = 255
			}
		}
		ids, comps := components(labels, w, h)
		core := make([]int, len(comps)+1)
		for y := 1; y < h-1; y++ {
			for x := 1; x < w-1; x++ {
				i := y*w + x
				if mask[i] && mask[i-1] && mask[i+1] && mask[i-w] && mask[i+w] {
					core[ids[i]]++
				}
			}
		}
		keep := map[int32]bool{}
		for _, c := range comps {
			// slivers thinner than ~2 px are resampling fringes, not missing or extra shapes
			if c.area >= minPx && core[c.id] > 0 {
				keep[c.id] = true
			}
		}
		pix := map[int32][]int{}
		for i, id := range ids {
			if keep[id] {
				pix[id] = append(pix[id], i)
			}
		}
		for _, c := range comps {
			if !keep[c.id] {
				continue
			}
			src := rp
			if kind == "extra" {
				src = dp
			}
			out = append(out, Region{
				Kind: kind,
				Box: Rect{
					X: r1(float64(c.minX) * fx), Y: r1(float64(c.minY) * fy),
					Width: r1(float64(c.maxX-c.minX+1) * fx), Height: r1(float64(c.maxY-c.minY+1) * fy),
				},
				AreaShare: r3(float64(c.area) / float64(total)),
				Color:     modeColor(src, pix[c.id]),
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].AreaShare != out[j].AreaShare {
			return out[i].AreaShare > out[j].AreaShare
		}
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		if out[i].Box.Y != out[j].Box.Y {
			return out[i].Box.Y < out[j].Box.Y
		}
		return out[i].Box.X < out[j].Box.X
	})
	// the top N of each kind, so a long list of extras cannot hide what is missing
	var res []Region
	count := map[string]int{}
	for _, r := range out {
		if count[r.Kind] < top {
			count[r.Kind]++
			res = append(res, r)
		}
	}
	if res == nil {
		res = []Region{}
	}
	return res
}

// quad tests membership in a node's box (or inscribed ellipse) from its corners.
type quad struct {
	cx, cy         float64
	ux, uy, vx, vy float64
	uu, vv         float64
	ellipse        bool
}

func newQuad(c [4]Point, ellipse bool, fx, fy float64) (quad, bool) {
	// corners are in frame units; work in canvas pixels
	tl, tr, bl := c[0], c[1], c[3]
	q := quad{ellipse: ellipse}
	q.cx = (c[0].X + c[2].X) / 2 / fx
	q.cy = (c[0].Y + c[2].Y) / 2 / fy
	q.ux, q.uy = (tr.X-tl.X)/2/fx, (tr.Y-tl.Y)/2/fy
	q.vx, q.vy = (bl.X-tl.X)/2/fx, (bl.Y-tl.Y)/2/fy
	q.uu, q.vv = q.ux*q.ux+q.uy*q.uy, q.vx*q.vx+q.vy*q.vy
	return q, q.uu > 1e-9 && q.vv > 1e-9
}

func (q quad) contains(x, y float64) bool {
	dx, dy := x-q.cx, y-q.cy
	a := (dx*q.ux + dy*q.uy) / q.uu
	b := (dx*q.vx + dy*q.vy) / q.vv
	if q.ellipse {
		return a*a+b*b <= 1
	}
	return math.Abs(a) <= 1 && math.Abs(b) <= 1
}

func nodeCoverage(rp, dp *plane, nodes []NodeBox, fx, fy float64, top int) []NodeCoverage {
	w, h := rp.w, rp.h
	owner := make([]int32, w*h)
	type nb struct {
		q              quad
		x0, y0, x1, y1 int
		box            Rect
	}
	boxes := make([]nb, len(nodes))
	for ni, n := range nodes {
		q, ok := newQuad(n.Corners, n.Ellipse, fx, fy)
		if !ok {
			continue
		}
		minX, minY, maxX, maxY := math.MaxFloat64, math.MaxFloat64, -math.MaxFloat64, -math.MaxFloat64
		for _, c := range n.Corners {
			minX, maxX = math.Min(minX, c.X), math.Max(maxX, c.X)
			minY, maxY = math.Min(minY, c.Y), math.Max(maxY, c.Y)
		}
		b := nb{q: q, box: Rect{X: r1(minX), Y: r1(minY), Width: r1(maxX - minX), Height: r1(maxY - minY)}}
		b.x0, b.x1 = max(0, int(math.Floor(minX/fx))), min(w-1, int(math.Ceil(maxX/fx)))
		b.y0, b.y1 = max(0, int(math.Floor(minY/fy))), min(h-1, int(math.Ceil(maxY/fy)))
		boxes[ni] = b
		// later nodes paint over earlier ones: the owner of a pixel is the topmost
		for y := b.y0; y <= b.y1; y++ {
			for x := b.x0; x <= b.x1; x++ {
				if q.contains(float64(x)+0.5, float64(y)+0.5) {
					owner[y*w+x] = int32(ni + 1)
				}
			}
		}
	}
	type acc struct{ painted, on int }
	accs := make([]acc, len(nodes))
	pts := make([][]int, len(nodes))
	for i, o := range owner {
		if o == 0 || !dp.ink[i] {
			continue
		}
		a := &accs[o-1]
		a.painted++
		if rp.ink[i] {
			a.on++
		}
		pts[o-1] = append(pts[o-1], i)
	}
	total := float64(w * h)
	minPainted := max(6, int(math.Round(0.0001*total)))
	var out []NodeCoverage
	type ranked struct {
		NodeCoverage
		off int
		idx int
	}
	var rk []ranked
	for ni, n := range nodes {
		a := accs[ni]
		if a.painted < minPainted {
			continue
		}
		off := a.painted - a.on
		on := float64(a.on) / float64(a.painted)
		if 1-on < 0.05 {
			continue
		}
		rk = append(rk, ranked{NodeCoverage: NodeCoverage{
			ID: n.ID, Name: n.Name, Type: n.Type, Box: boxes[ni].box,
			OnReference: r3(on), Extra: r3(1 - on), OffAreaShare: r3(float64(off) / total),
		}, off: off, idx: ni})
	}
	sort.SliceStable(rk, func(i, j int) bool {
		if rk[i].off != rk[j].off {
			return rk[i].off > rk[j].off
		}
		return rk[i].ID < rk[j].ID
	})
	if len(rk) > top {
		rk = rk[:top]
	}
	for _, r := range rk {
		nc := r.NodeCoverage
		nc.SuggestedMove = suggestMove(rp.ink, w, h, pts[r.idx], boxes[r.idx].box, fx, fy)
		out = append(out, nc)
	}
	if out == nil {
		out = []NodeCoverage{}
	}
	return out
}

// suggestMove finds the shift of a node's painted pixels that lands the most on reference ink.
func suggestMove(ref []bool, w, h int, pts []int, box Rect, fx, fy float64) *Move {
	if len(pts) == 0 {
		return nil
	}
	step := max(1, len(pts)/400)
	var xs, ys []int
	for i := 0; i < len(pts); i += step {
		xs = append(xs, pts[i]%w)
		ys = append(ys, pts[i]/w)
	}
	R := int(math.Min(40, math.Max(6, 0.5*math.Max(box.Width/fx, box.Height/fy))))
	score := func(dx, dy int) int {
		n := 0
		for i := range xs {
			x, y := xs[i]+dx, ys[i]+dy
			if x >= 0 && y >= 0 && x < w && y < h && ref[y*w+x] {
				n++
			}
		}
		return n
	}
	base := score(0, 0)
	bestN, bdx, bdy := base, 0, 0
	for dy := -R; dy <= R; dy++ {
		for dx := -R; dx <= R; dx++ {
			if n := score(dx, dy); n > bestN || (n == bestN && n > base && dx*dx+dy*dy < bdx*bdx+bdy*bdy) {
				bestN, bdx, bdy = n, dx, dy
			}
		}
	}
	if float64(bestN-base)/float64(len(xs)) < 0.15 {
		return nil
	}
	return &Move{DX: r1(float64(bdx) * fx), DY: r1(float64(bdy) * fy)}
}

func diffPNG(ref, drawn []bool, w, h int) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range ref {
		c := color.NRGBA{255, 255, 255, 255}
		switch {
		case ref[i] && drawn[i]:
			c = color.NRGBA{154, 154, 154, 255}
		case ref[i]:
			c = color.NRGBA{230, 40, 40, 255}
		case drawn[i]:
			c = color.NRGBA{40, 90, 230, 255}
		}
		o := i * 4
		img.Pix[o], img.Pix[o+1], img.Pix[o+2], img.Pix[o+3] = c.R, c.G, c.B, c.A
	}
	return encodePNG(img)
}

// edgeOf measures the contour distance on a canvas at least as sharp as the drawing (up to
// edgeMaxSide px), so an error of a pixel or two at the frame's size is not rounded away.
func edgeOf(in CompareInput, cv canvasPlanes) *Edge {
	db := in.Drawn.Bounds()
	side := math.Min(edgeMaxSide, math.Max(float64(db.Dx()), float64(db.Dy())))
	if side > float64(max(cv.w, cv.h)) && side > compareMaxSide {
		cv = buildPlanes(in.Drawn, in.Ref, in.FrameW, in.FrameH, in.Placed, side)
	}
	return edgeMetrics(cv.rp.ink, cv.dp.ink, cv.w, cv.h, (cv.fx+cv.fy)/2, in.EdgeTarget)
}
