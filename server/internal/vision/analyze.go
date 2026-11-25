// Package vision measures raster images: palette, background, connected color regions
// ("blobs") with the primitive that best fits each one, and layout hints (grids, repeated
// shapes, radial repetition). It is pure Go and deterministic: the same pixels and options give
// the same result. analyze_image is its first user; compare_reference, trace_image and
// fit_to_reference are meant to reuse the same pieces.
package vision

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"math"
	"sort"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/core"

	xdraw "golang.org/x/image/draw"
)

const (
	DefaultMaxColors = 8
	DefaultMinArea   = 0.0005
	DefaultMaxBlobs  = 40
	DefaultMaxPoints = 24
	maxAnalysisSide  = 640
	maxGrainSide     = 1600 // grain (photo detection) is measured at up to this size
)

// Options tunes Analyze. Zero values pick the defaults.
type Options struct {
	MaxColors int     // palette size cap (default 8, max 16)
	MinArea   float64 // smallest blob, as a fraction of the analyzed area (default 0.0005)
	MaxBlobs  int     // blobs returned (default 40)
	MaxPoints int     // outline points for freeform blobs (default 24)
	Region    *Rect   // sub-rectangle of the image, in source pixels
	// Scale and Offset place the image in the output space: a source pixel (x, y) is reported
	// at (OffsetX + x*Scale, OffsetY + y*Scale). Scale defaults to 1.
	Scale, OffsetX, OffsetY float64
}

type Rect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type PaletteEntry struct {
	Color string  `json:"color"`
	Share float64 `json:"share"`
}

type Background struct {
	Color       string  `json:"color,omitempty"`
	Transparent bool    `json:"transparent,omitempty"`
	BorderShare float64 `json:"borderShare"`
}

// NodeSpec is a node ready for create_nodes (relative to the same parent as the output space).
type NodeSpec struct {
	Type     string   `json:"type"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	Width    *float64 `json:"width,omitempty"`
	Height   *float64 `json:"height,omitempty"`
	Rotation float64  `json:"rotation,omitempty"`
	Radius   any      `json:"radius,omitempty"` // number, or [tl, tr, br, bl] when the corners differ
	D        string   `json:"d,omitempty"`
	Fill     string   `json:"fill"`
}

type Fit struct {
	Kind         string     `json:"kind"` // circle, ellipse, rect, roundRect, polygon, freeform
	IoU          float64    `json:"iou"`
	Node         *NodeSpec  `json:"node"`
	Center       *Point     `json:"center,omitempty"`
	Sides        int        `json:"sides,omitempty"`
	Radius       float64    `json:"radius,omitempty"`       // polygon: circumradius
	CornerRadius float64    `json:"cornerRadius,omitempty"` // polygon: rounding of the corners (0 = sharp)
	Radii        []float64  `json:"radii,omitempty"`        // roundRect with different corners: tl, tr, br, bl
	Simplicity   Simplicity `json:"simplicity"`
	Rotation     float64    `json:"rotation,omitempty"` // polygon: direction of the first vertex, degrees
	Nearest      string     `json:"nearest,omitempty"`  // freeform: the primitive that came closest
	NearestIoU   float64    `json:"nearestIou,omitempty"`
	Outline      []Point    `json:"outline,omitempty"` // freeform: simplified polygon
	HolesFilled  bool       `json:"holesFilled,omitempty"`
}

// Simplicity is what the fit costs to draw: one node, and how many numbers describe it.
type Simplicity struct {
	Nodes  int `json:"nodes"`
	Params int `json:"params"`
}

type Symmetry struct {
	MirrorX float64 `json:"mirrorX"` // left-right: 1 = identical to its mirror image
	MirrorY float64 `json:"mirrorY"` // top-bottom
}

type Blob struct {
	ID          string   `json:"id"`
	Color       string   `json:"color"`
	AreaPx      float64  `json:"areaPx"`
	Share       float64  `json:"share"`
	BBox        Rect     `json:"bbox"`
	Centroid    Point    `json:"centroid"`
	Holes       int      `json:"holes"`
	HoleBoxes   []Rect   `json:"holeBoxes,omitempty"`
	Orientation float64  `json:"orientation"` // major axis, degrees, clockwise from +x, in (-90, 90]
	Elongation  float64  `json:"elongation"`  // major/minor axis, 1 = round
	Symmetry    Symmetry `json:"symmetry"`
	Fit         Fit      `json:"fit"`
	Suggest     string   `json:"suggest"` // primitive, trace_image, skip-in-photo, skip-in-gradient, text
	Region      string   `json:"region"`  // id of the region the blob sits in

	pal      int
	dimA     float64 // fit dimensions, long then short (output units)
	dimB     float64
	solidity float64
	area     float64 // output units²
}

type Result struct {
	Size             Size           `json:"size"`
	Region           Rect           `json:"region"`
	Placed           *Rect          `json:"placed,omitempty"` // the whole image's box in the output space when a frame is given
	Scale            float64        `json:"scale"`
	AnalysisScale    float64        `json:"analysisScale"`
	Background       Background     `json:"background"`
	Palette          []PaletteEntry `json:"palette"`
	TransparentShare float64        `json:"transparentShare"`
	Blobs            []Blob         `json:"blobs"`
	BlobCount        int            `json:"blobCount"`
	Truncated        bool           `json:"truncated"`
	Layout           Layout         `json:"layout"`
	Regions          []ImageRegion  `json:"regions"`
	Warnings         []string       `json:"warnings"`
}

func r1(v float64) float64 { return math.Round(v*10) / 10 }
func r3(v float64) float64 { return math.Round(v*1000) / 1000 }
func fp(v float64) *float64 {
	v = r1(v)
	return &v
}

// Analyze measures img. It is safe to call concurrently.
func Analyze(img image.Image, opt Options) (*Result, error) {
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
	if opt.MaxBlobs <= 0 {
		opt.MaxBlobs = DefaultMaxBlobs
	}
	if opt.MaxPoints < 3 {
		opt.MaxPoints = DefaultMaxPoints
	}
	if opt.Scale <= 0 {
		opt.Scale = 1
	}
	reg := image.Rect(0, 0, b.Dx(), b.Dy())
	if opt.Region != nil {
		x0 := int(math.Floor(opt.Region.X))
		y0 := int(math.Floor(opt.Region.Y))
		x1 := int(math.Ceil(opt.Region.X + opt.Region.Width))
		y1 := int(math.Ceil(opt.Region.Y + opt.Region.Height))
		reg = reg.Intersect(image.Rect(x0, y0, x1, y1))
		if reg.Empty() {
			return nil, errors.New("region is outside the image")
		}
	}
	rw, rh := reg.Dx(), reg.Dy()
	s := math.Min(1, float64(maxAnalysisSide)/float64(max(rw, rh)))
	aw, ah := max(1, int(math.Round(float64(rw)*s))), max(1, int(math.Round(float64(rh)*s)))
	nrgba := image.NewNRGBA(image.Rect(0, 0, aw, ah))
	src := image.Rect(b.Min.X+reg.Min.X, b.Min.Y+reg.Min.Y, b.Min.X+reg.Max.X, b.Min.Y+reg.Max.Y)
	if aw == rw && ah == rh {
		draw.Draw(nrgba, nrgba.Bounds(), img, src.Min, draw.Src)
	} else {
		xdraw.BiLinear.Scale(nrgba, nrgba.Bounds(), img, src, xdraw.Src, nil)
	}

	t := transform{
		kx: opt.Scale * float64(rw) / float64(aw), ky: opt.Scale * float64(rh) / float64(ah),
		ox: opt.OffsetX + float64(reg.Min.X)*opt.Scale, oy: opt.OffsetY + float64(reg.Min.Y)*opt.Scale,
		src: float64(rw) / float64(aw), // source px per analysis px along x (area conversion uses the mean)
	}
	t.src = (float64(rw)/float64(aw) + float64(rh)/float64(ah)) / 2

	res := &Result{
		Size:          Size{Width: b.Dx(), Height: b.Dy()},
		Region:        Rect{X: float64(reg.Min.X), Y: float64(reg.Min.Y), Width: float64(rw), Height: float64(rh)},
		Scale:         r3(opt.Scale),
		AnalysisScale: r3(float64(aw) / float64(rw)),
		Palette:       []PaletteEntry{},
		Blobs:         []Blob{},
		Warnings:      []string{},
		Layout:        Layout{Grids: []Grid{}, Repeats: []Repeat{}, Radials: []Radial{}},
		Regions:       []ImageRegion{},
	}

	px := prepare(nrgba)
	hi := grainRaster(img, src, px)
	pal := quantize(px, opt.MaxColors, opt.MinArea)
	total := float64(aw * ah)
	if len(pal) == 0 {
		res.TransparentShare = 1
		res.Background = Background{Transparent: true, BorderShare: 1}
		res.Warnings = append(res.Warnings, "the image is fully transparent")
		return res, nil
	}
	labels := assignLabels(px, pal)
	counts := make([]int, len(pal)+1) // last = transparent
	for _, l := range labels {
		if l == 255 {
			counts[len(pal)]++
		} else {
			counts[l]++
		}
	}
	res.TransparentShare = r3(float64(counts[len(pal)]) / total)
	for i, p := range pal {
		res.Palette = append(res.Palette, PaletteEntry{Color: p.hex, Share: r3(float64(counts[i]) / total)})
	}

	// background: the label that owns most of the border
	border := make([]int, len(pal)+1)
	nb := 0
	visit := func(x, y int) {
		l := labels[y*aw+x]
		if l == 255 {
			border[len(pal)]++
		} else {
			border[l]++
		}
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

	ids, comps := components(labels, aw, ah)
	minPx := max(4, int(math.Round(opt.MinArea*total)))
	var kept []comp
	for _, c := range comps {
		if c.area < minPx {
			continue
		}
		if bgSolid && bgLabel < len(pal) && int(c.label) == bgLabel && c.touches {
			continue
		}
		kept = append(kept, c)
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].area > kept[j].area })
	// regions: what each part of the image is best drawn with
	raws := classifyRegions(px, hi, kept)
	owner := assignRegions(raws, kept)
	pick := listedBlobs(raws, owner, len(kept))
	if dropped := len(kept) - len(pick); dropped > 0 {
		res.Warnings = append(res.Warnings, fmt.Sprintf("%d small blobs inside photo regions are not listed (only the %d largest of each)", dropped, maxPhotoBlobs))
	}
	res.BlobCount = len(pick)
	if len(pick) > opt.MaxBlobs {
		pick = pick[:opt.MaxBlobs]
		res.Truncated = true
	}
	if len(pick) < len(kept) {
		nk, no := make([]comp, len(pick)), make([]int, len(pick))
		for n, i := range pick {
			nk[n], no[n] = kept[i], owner[i]
		}
		kept, owner = nk, no
	}
	holeFloor := max(3, minPx/4)
	for i, c := range kept {
		g := buildGeom(ids, aw, c, holeFloor)
		blob := describe(g, c, pal[c.label].hex, t, total, opt.MaxPoints)
		blob.ID = fmt.Sprintf("b%d", i+1)
		blob.pal = int(c.label)
		res.Blobs = append(res.Blobs, blob)
	}
	res.Regions = buildRegions(raws, owner, kept, res.Blobs, ids, aw, t, total)
	res.Layout = findLayout(res.Blobs)
	return res, nil
}

// grainRaster is the region of img (src, in its coordinates) at up to maxGrainSide pixels:
// grain is measured there, because the analysis raster has blurred it away. When the analysis
// raster is already as large as the source it is the same raster.
func grainRaster(img image.Image, src image.Rectangle, px *pixels) *pixels {
	rw, rh := src.Dx(), src.Dy()
	if px.w == rw && px.h == rh {
		return px
	}
	gs := math.Min(1, float64(maxGrainSide)/float64(max(rw, rh)))
	gw, gh := max(1, int(math.Round(float64(rw)*gs))), max(1, int(math.Round(float64(rh)*gs)))
	big := image.NewNRGBA(image.Rect(0, 0, gw, gh))
	if gw == rw && gh == rh {
		draw.Draw(big, big.Bounds(), img, src.Min, draw.Src)
	} else {
		xdraw.BiLinear.Scale(big, big.Bounds(), img, src, xdraw.Src, nil)
	}
	return prepareLite(big)
}

// assignRegions gives each comp the region it sits in (by the center of its box); blobs that
// merely overlap a text block without being letters belong to the area behind the text.
func assignRegions(raws []rawRegion, comps []comp) []int {
	owner := make([]int, len(comps))
	for i, c := range comps {
		ctr := image.Pt((c.minX+c.maxX)/2, (c.minY+c.maxY)/2)
		cb := image.Rect(c.minX, c.minY, c.maxX+1, c.maxY+1)
		best, bestA := 0, -1
		for ri, r := range raws {
			if r.kind == KindText && !r.members[i] {
				continue
			}
			if ctr.In(r.rect) {
				best = ri
				break
			}
			if a := cb.Intersect(r.rect); a.Dx()*a.Dy() > bestA {
				best, bestA = ri, a.Dx()*a.Dy()
			}
		}
		owner[i] = best
	}
	return owner
}

// listedBlobs picks the comps (indexes into the size-sorted kept list) that analyze_image lists:
// blobs inside a photo are specks of its texture, only its largest few are worth listing.
// trace_image numbers its blobs through the same function, so the ids agree.
func listedBlobs(raws []rawRegion, owner []int, n int) []int {
	var pick []int
	inPhoto := map[int]int{}
	for i := range n {
		if raws[owner[i]].kind == KindPhoto {
			if inPhoto[owner[i]]++; inPhoto[owner[i]] > maxPhotoBlobs {
				continue
			}
		}
		pick = append(pick, i)
	}
	return pick
}

// onRamp is true when most of the blob's pixels lie in the smooth tiles of the ramp.
func onRamp(ids []int32, aw int, c comp, smooth func(x, y int) bool) bool {
	in := 0
	for y := c.minY; y <= c.maxY; y++ {
		for x := c.minX; x <= c.maxX; x++ {
			if ids[y*aw+x] == c.id && smooth(x, y) {
				in++
			}
		}
	}
	return float64(in) >= 0.6*float64(c.area)
}

const maxPhotoBlobs = 8 // blobs listed per photo region

const primitiveIoU = 0.93 // a fit this good is worth drawing as a primitive

// buildRegions turns the raw regions into the output ones, with the blobs each holds and the
// tool suggested for them.
func buildRegions(raws []rawRegion, owner []int, comps []comp, blobs []Blob, ids []int32, aw int, t transform, total float64) []ImageRegion {
	out := make([]ImageRegion, len(raws))
	for ri, r := range raws {
		p0 := t.pt(float64(r.rect.Min.X), float64(r.rect.Min.Y))
		p1 := t.pt(float64(r.rect.Max.X), float64(r.rect.Max.Y))
		out[ri] = ImageRegion{
			ID: fmt.Sprintf("r%d", ri+1), Kind: r.kind, Box: Rect{p0.X, p0.Y, r1(p1.X - p0.X), r1(p1.Y - p0.Y)},
			Share: r3(float64(r.rect.Dx()*r.rect.Dy()) / total), BlobIDs: []string{}, Gradient: r.grad, Why: r.why,
			Lines: r.lines, FontSize: r1(r.fontSize * t.size()), FitError: r.fitError,
		}
	}
	primArea := make([]float64, len(raws))
	allArea := make([]float64, len(raws))
	nPrim := make([]int, len(raws))
	for i := range blobs {
		b := &blobs[i]
		ri := owner[i]
		r, reg := raws[ri], &out[ri]
		reg.BlobIDs = append(reg.BlobIDs, b.ID)
		b.Region = reg.ID
		prim := b.Fit.Kind != "freeform" && b.Fit.IoU >= primitiveIoU
		switch r.kind {
		case KindPhoto:
			b.Suggest = "skip-in-photo"
		case KindText:
			b.Suggest = "text"
		case KindGradient:
			c := comps[i]
			// a band of the ramp lies in its smooth tiles; a shape drawn on the ramp does not
			if r.gband && onRamp(ids, aw, c, r.smooth) {
				b.Suggest = "skip-in-gradient"
			}
		}
		if b.Suggest == "" {
			b.Suggest = "trace_image"
			if prim {
				b.Suggest = "primitive"
				primArea[ri] += b.AreaPx
				nPrim[ri]++
			}
			allArea[ri] += b.AreaPx
		}
	}
	for ri, r := range raws {
		reg := &out[ri]
		switch r.kind {
		case KindPhoto:
			reg.Suggest = "import_image"
		case KindText:
			reg.Suggest = "text"
		case KindGradient:
			reg.Suggest = "gradient"
			if r.grad == nil {
				reg.Suggest = "trace_image"
			}
		default:
			reg.Suggest = "primitive"
			n := 0
			for i := range blobs {
				if owner[i] == ri {
					n++
				}
			}
			switch {
			case n == 0:
				reg.Why = "flat color without shapes of its own: a rect (or the frame's fill)"
			case allArea[ri] > 0 && primArea[ri] < 0.5*allArea[ri]:
				reg.Suggest = "trace_image"
				reg.Why = fmt.Sprintf("flat color with organic shapes: %d of %d blobs fit a primitive at iou >= %.2f; trace the rest", nPrim[ri], n, primitiveIoU)
			default:
				reg.Why = fmt.Sprintf("flat color with geometric shapes: %d of %d blobs fit a primitive at iou >= %.2f", nPrim[ri], n, primitiveIoU)
			}
		}
	}
	return out
}

type transform struct {
	kx, ky, ox, oy float64
	src            float64
}

func (t transform) pt(x, y float64) Point { return Point{r1(t.ox + x*t.kx), r1(t.oy + y*t.ky)} }
func (t transform) size() float64         { return (t.kx + t.ky) / 2 }

func describe(g *geom, c comp, color string, t transform, total float64, maxPts int) Blob {
	ox, oy := float64(g.ox), float64(g.oy)
	loc := func(x, y float64) Point { return t.pt(ox+x, oy+y) }
	bl := Blob{Color: color, Holes: len(g.holes)}
	p0 := loc(0, 0)
	p1 := loc(float64(g.w), float64(g.h))
	bl.BBox = Rect{X: p0.X, Y: p0.Y, Width: r1(p1.X - p0.X), Height: r1(p1.Y - p0.Y)}
	bl.Centroid = loc(g.mcx, g.mcy)
	bl.AreaPx = math.Round(float64(g.areaM) * t.src * t.src)
	bl.Share = r3(float64(g.areaM) / total)
	bl.area = float64(g.areaM) * t.kx * t.ky
	for i, h := range g.holes {
		if i == 4 {
			break
		}
		a := loc(float64(h.minX), float64(h.minY))
		b := loc(float64(h.maxX+1), float64(h.maxY+1))
		bl.HoleBoxes = append(bl.HoleBoxes, Rect{a.X, a.Y, r1(b.X - a.X), r1(b.Y - a.Y)})
	}
	bl.Elongation = r3(math.Sqrt(g.lam1 / g.lam2))
	if bl.Elongation >= 1.05 {
		deg := g.theta * 180 / math.Pi
		if deg <= -90 {
			deg += 180
		}
		bl.Orientation = r1(deg)
	}
	bl.Symmetry = Symmetry{MirrorX: r3(g.mirror(true)), MirrorY: r3(g.mirror(false))}
	if g.hullArea > 0 {
		bl.solidity = float64(g.areaF) / g.hullArea
	}

	best := g.bestFit()
	fit := Fit{IoU: r3(best.iou), HolesFilled: len(g.holes) > 0}
	k := t.size()
	center := loc(best.cx, best.cy)
	if best.iou >= acceptIoU {
		fit.Kind = best.kind
		fit.Node = primNode(best, center, k, color, loc)
		switch best.kind {
		case "polygon":
			fit.Center = &center
			fit.Sides = best.n
			fit.Radius = r1(best.rx * k)
			fit.CornerRadius = r1(best.r * k)
			deg := math.Mod(best.rot*180/math.Pi, 360)
			if deg < 0 {
				deg += 360
			}
			fit.Rotation = r1(deg)
			bl.dimA, bl.dimB = 2*best.rx*k, 2*best.rx*k
		default:
			bl.dimA, bl.dimB = 2*math.Max(best.rx, best.ry)*k, 2*math.Min(best.rx, best.ry)*k
		}
		fit.Simplicity = Simplicity{Nodes: 1, Params: primParams(best)}
		if best.kind == "roundRect" && best.perCorner {
			for _, r := range best.radii {
				fit.Radii = append(fit.Radii, r1(r*k))
			}
		}
	} else {
		fit.Kind = "freeform"
		fit.Nearest = best.kind
		fit.NearestIoU = r3(best.iou)
		fit.IoU = 0
		out := simplify(g.contour, 0.8+0.002*float64(max(g.w, g.h)), maxPts)
		for _, p := range out {
			fit.Outline = append(fit.Outline, loc(p.x, p.y))
		}
		fit.Node = pathNode(fit.Outline, color)
		bl.dimA, bl.dimB = bl.BBox.Width, bl.BBox.Height
		if bl.dimB > bl.dimA {
			bl.dimA, bl.dimB = bl.dimB, bl.dimA
		}
		// how well the simplified outline covers the blob
		fit.IoU = r3(g.outlineIoU(out))
		fit.Simplicity = Simplicity{Nodes: 1, Params: 2 * len(out)}
	}
	bl.Fit = fit
	return bl
}

func primNode(p prim, center Point, k float64, color string, loc func(x, y float64) Point) *NodeSpec {
	deg := r1(p.rot * 180 / math.Pi)
	switch p.kind {
	case "circle", "ellipse":
		w, h := 2*p.rx*k, 2*p.ry*k
		return &NodeSpec{Type: "ellipse", X: r1(center.X - w/2), Y: r1(center.Y - h/2), Width: fp(w), Height: fp(h), Rotation: deg, Fill: color}
	case "rect", "roundRect":
		w, h := 2*p.rx*k, 2*p.ry*k
		n := &NodeSpec{Type: "rect", X: r1(center.X - w/2), Y: r1(center.Y - h/2), Width: fp(w), Height: fp(h), Rotation: deg, Fill: color}
		switch {
		case p.perCorner:
			n.Radius = []float64{r1(p.radii[0] * k), r1(p.radii[1] * k), r1(p.radii[2] * k), r1(p.radii[3] * k)}
		case p.r > 0:
			n.Radius = r1(p.r * k)
		}
		return n
	}
	if p.r > 0 {
		// rounded regular polygon: the same path builder create_shape_path uses
		cr := p.r * k
		R := p.rx * k
		angle := p.rot*180/math.Pi + 90 // clockwise from 12 o'clock
		shape, err := core.BuildPathShape("polygon", core.ShapeParams{Sides: new(float64(p.n)), Radius: new(R), Angle: new(angle), CornerRadius: new(cr)})
		if err == nil {
			return &NodeSpec{Type: "path", X: r1(center.X - shape.Center.X), Y: r1(center.Y - shape.Center.Y), D: shape.D, Fill: color}
		}
	}
	pts := make([]Point, p.n)
	for i := range pts {
		a := p.rot + 2*math.Pi*float64(i)/float64(p.n)
		pts[i] = loc(p.cx+p.rx*math.Cos(a), p.cy+p.rx*math.Sin(a))
	}
	return pathNode(pts, color)
}

// primParams counts the numbers that describe a primitive (center, size, angle, radii...).
func primParams(p prim) int {
	switch p.kind {
	case "circle":
		return 3
	case "ellipse":
		return 5
	case "rect":
		return 5
	case "roundRect":
		if p.perCorner {
			return 9
		}
		return 6
	}
	if p.r > 0 {
		return 6
	}
	return 5
}

func pathNode(pts []Point, color string) *NodeSpec {
	if len(pts) == 0 {
		return nil
	}
	minX, minY := pts[0].X, pts[0].Y
	for _, p := range pts {
		minX, minY = math.Min(minX, p.X), math.Min(minY, p.Y)
	}
	var d strings.Builder
	for i, p := range pts {
		cmd := "L"
		if i == 0 {
			cmd = "M"
		}
		d.WriteString(fmt.Sprintf("%s%s %s ", cmd, num(p.X-minX), num(p.Y-minY)))
	}
	d.WriteString("Z")
	return &NodeSpec{Type: "path", X: r1(minX), Y: r1(minY), D: d.String(), Fill: color}
}

func num(v float64) string {
	return fmt.Sprintf("%g", r1(v))
}

// mirror is the IoU of the blob's mask with itself flipped across its bounding box center.
func (g *geom) mirror(horizontal bool) float64 {
	inter, uni := 0, 0
	for y := range g.h {
		for x := range g.w {
			a := g.mask[y*g.w+x]
			var b bool
			if horizontal {
				b = g.mask[y*g.w+(g.w-1-x)]
			} else {
				b = g.mask[(g.h-1-y)*g.w+x]
			}
			if a && b {
				inter++
			}
			if a || b {
				uni++
			}
		}
	}
	if uni == 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

// outlineIoU is how well a polygon (local coordinates) covers the filled mask.
func (g *geom) outlineIoU(poly []pt) float64 {
	if len(poly) < 3 {
		return 0
	}
	pad := 2
	step := max(1, (max(g.w, g.h)+2*pad+159)/160)
	inter, uni := 0, 0
	for y := -pad; y < g.h+pad; y += step {
		for x := -pad; x < g.w+pad; x += step {
			a := g.inFill(x, y)
			b := inPoly(poly, float64(x)+0.5, float64(y)+0.5)
			if a && b {
				inter++
			}
			if a || b {
				uni++
			}
		}
	}
	if uni == 0 {
		return 0
	}
	return float64(inter) / float64(uni)
}

func inPoly(p []pt, x, y float64) bool {
	in := false
	for i, j := 0, len(p)-1; i < len(p); j, i = i, i+1 {
		if (p[i].y > y) != (p[j].y > y) && x < (p[j].x-p[i].x)*(y-p[i].y)/(p[j].y-p[i].y)+p[i].x {
			in = !in
		}
	}
	return in
}
