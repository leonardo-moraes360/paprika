package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"math"
	"strings"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server/internal/vision"
)

const (
	fitDefaultIterations = 60
	fitMaxIterations     = 400
	fitDivergence        = 0.03  // mask IoU and Chromium IoU further apart than this are reported
	fitRegression        = 0.005 // a Chromium IoU worse than before by more than this blocks the write
	fitBudget            = 20 * time.Second
)

var fitParams = map[string]bool{"position": true, "size": true, "rotation": true, "radius": true, "pathPoints": true}

type fitIoUPair struct {
	Before float64 `json:"before"`
	After  float64 `json:"after"`
}

type fitIoU struct {
	Mask     fitIoUPair `json:"mask"`
	Chromium fitIoUPair `json:"chromium"`
}

type fitChange struct {
	Before any `json:"before"`
	After  any `json:"after"`
}

type fitAnchorMove struct {
	Index int     `json:"index"`
	DX    float64 `json:"dx"`
	DY    float64 `json:"dy"`
}

type fitNodeOut struct {
	ID         string               `json:"id"`
	Name       string               `json:"name,omitempty"`
	Type       string               `json:"type"`
	Changes    map[string]fitChange `json:"changes"`
	PathPoints []fitAnchorMove      `json:"pathPoints,omitempty"`
	Skipped    string               `json:"skipped,omitempty"`
}

type fitOutput struct {
	WorkspaceID   string       `json:"workspaceId"`
	WorkspaceName string       `json:"workspaceName"`
	RootID        string       `json:"rootId"`
	Applied       bool         `json:"applied"`
	DryRun        bool         `json:"dryRun"`
	IoU           fitIoU       `json:"iou"`
	Target        float64      `json:"target"`
	Pass          bool         `json:"pass"`
	Iterations    int          `json:"iterations"`
	ElapsedMs     int64        `json:"elapsedMs"`
	FitMs         int64        `json:"fitMs"`
	Canvas        vision.Size  `json:"canvas"`
	Nodes         []fitNodeOut `json:"nodes"`
	Warnings      []string     `json:"warnings"`
	Version       *int64       `json:"version,omitempty"`
}

// fitSource is a node of the frame the way fit_to_reference reads it.
type fitSource struct {
	n       *core.Node
	fit     vision.FitNode
	skipped string
	free    vision.FitFree
	path    bool
	hasBox  bool // position is the node's own (not decided by a row/column layout)
}

func subtreeOf(d *core.Document, rootID string) map[string]bool {
	seen := map[string]bool{}
	var walk func(id string, depth int)
	walk = func(id string, depth int) {
		n := core.GetNode(d, id)
		if n == nil || seen[id] || depth > 200 {
			return
		}
		seen[id] = true
		for _, c := range n.Strings("children") {
			walk(c, depth+1)
		}
	}
	walk(rootID, 0)
	return seen
}

// paintOf reads a fill or stroke color: whether it paints, and its rgb and alpha when readable.
func paintOf(v any) (bool, *[3]uint8, float64) {
	switch c := v.(type) {
	case nil:
		return false, nil, 1
	case string:
		c = strings.TrimSpace(c)
		if c == "" || c == "none" || c == "transparent" {
			return false, nil, 1
		}
		if col, a, ok := vision.ParseCSSColor(c); ok {
			return a > 0, &col, a
		}
		return true, nil, 1
	}
	return true, nil, 1 // a gradient or another object
}

func lengthOf(d *core.Document, n *core.Node, v any) (float64, bool) {
	return core.ResolveLength(d, v, core.ModeOf(d, n))
}

// fitNodeFor reads node id as a vision.FitNode. It never errors: what cannot be fitted says why.
func fitNodeFor(d *core.Document, id string, boxes map[string]core.LayoutBox, ox, oy float64, rootID string, wanted map[string]bool, maxAnchors int) fitSource {
	n := core.GetNode(d, id)
	src := fitSource{n: n}
	typ := n.Str("type")
	skip := func(format string, args ...any) fitSource {
		src.skipped = fmt.Sprintf(format, args...)
		return src
	}
	kind := ""
	switch typ {
	case "rect", "frame":
		kind = "rect"
	case "ellipse":
		kind = "ellipse"
	case "path":
		kind = "path"
	default:
		return skip("a %s cannot be fitted (rect, ellipse, path and frame can)", typ)
	}
	if v, ok := n.Get("visible"); ok && v == false {
		return skip("it is hidden")
	}
	if n.Bool("locked") {
		return skip("it is locked; unlock it first")
	}
	if owner := core.CopyOwner(d, n); owner != nil {
		return skip("it is a copy inside the instance %q; edit the component or detach it", owner.Str("id"))
	}
	b, ok := boxes[id]
	if !ok {
		return skip("it has no box in the layout")
	}
	for cur := n; ; {
		pid, ok := core.ParentID(cur)
		if !ok || pid == "" || cur.Str("id") == rootID {
			break
		}
		p := core.GetNode(d, pid)
		if p == nil {
			break
		}
		if pid != rootID && p.Num("rotation") != 0 {
			return skip("its ancestor %q is rotated, which is not modeled", pid)
		}
		cur = p
	}
	fit := vision.FitNode{
		ID: id, Kind: kind,
		X: b.X - ox, Y: b.Y - oy, W: b.Width, H: b.Height, Rot: n.Num("rotation"),
		Alpha: 1,
	}
	if v, ok := n.Get("opacity"); ok {
		if f, ok := v.(float64); ok {
			fit.Alpha = f
		}
	}
	paints, rgb, a := paintOf(valueOf(n, "fill"))
	fit.Fill, fit.FillRGB = paints, rgb
	fit.Alpha *= a
	if st := n.Obj("stroke"); st != nil {
		sp, srgb, _ := paintOf(valueOf(st, "color"))
		var w float64
		if raw, ok := st.Get("width"); ok {
			w, _ = lengthOf(d, n, raw)
		}
		if sp && w > 0 {
			fit.Stroke, fit.StrokeRGB, fit.StrokeWidth = true, srgb, w
			pos := core.StrokePositionOf(n)
			fit.StrokeInside, fit.StrokeOutside = pos == "inside", pos == "outside"
		}
	}
	src.fit = fit
	src.hasBox = pathMoveBox(d, n)

	numeric := func(key string) bool {
		v, ok := n.Get(key)
		if !ok {
			return false
		}
		_, isNum := v.(float64)
		return isNum
	}
	switch kind {
	case "rect":
		if v, ok := n.Get("radius"); ok && v != nil {
			switch r := v.(type) {
			case []any:
				if len(r) == 4 {
					for i, c := range r {
						f, ok := lengthOf(d, n, c)
						if !ok {
							return skip("a corner radius it cannot read")
						}
						src.fit.Radius[i] = f
					}
				}
			default:
				f, ok := lengthOf(d, n, r)
				if !ok {
					return skip("a radius it cannot read")
				}
				src.fit.Radius = [4]float64{f, f, f, f}
			}
		}
	case "path":
		src.path = true
		segs, err := core.ParsePath(n.Str("d"))
		if err != nil {
			return skip("its path data is invalid: %s", err.Error())
		}
		for _, sub := range core.PathToSubpaths(segs) {
			fs := vision.FitSub{Closed: sub.Closed}
			for _, a := range sub.Anchors {
				fa := vision.FitAnchor{X: a.X, Y: a.Y}
				if a.In != nil {
					fa.In = &vision.Point{X: a.In.X, Y: a.In.Y}
				}
				if a.Out != nil {
					fa.Out = &vision.Point{X: a.Out.X, Y: a.Out.Y}
				}
				fs.Anchors = append(fs.Anchors, fa)
			}
			src.fit.Path = append(src.fit.Path, fs)
		}
		src.fit.EvenOdd = n.Str("fillRule") == "evenodd"
		if vb := n.Arr("viewBox"); len(vb) == 4 {
			var box [4]float64
			for i, v := range vb {
				box[i], _ = v.(float64)
			}
			src.fit.ViewBox = &box
		}
	}
	// what may move, given what the node is
	free := vision.FitFree{MaxAnchors: maxAnchors}
	var dropped []string
	if wanted["position"] {
		if src.hasBox {
			free.Position = true
		} else {
			dropped = append(dropped, "position (it sits in a row/column layout; set layoutPositioning to absolute to free it)")
		}
	}
	if wanted["size"] {
		if numeric("width") && numeric("height") {
			free.Size = true
		} else {
			dropped = append(dropped, `size (its width or height is "hug" or "fill")`)
		}
	}
	free.Rotation = wanted["rotation"]
	if wanted["radius"] && kind == "rect" {
		free.Radius = true
	}
	if wanted["pathPoints"] && kind == "path" {
		if src.fit.ViewBox != nil {
			dropped = append(dropped, "pathPoints (the path has a viewBox)")
		} else {
			free.PathPoints = true
		}
	}
	src.free = free
	src.fit.Free = free
	if !free.Position && !free.Size && !free.Rotation && !free.Radius && !free.PathPoints {
		if len(dropped) > 0 {
			return skip("nothing left to tune: %s", strings.Join(dropped, "; "))
		}
		return skip("none of the requested params applies to a %s", typ)
	}
	return src
}

func valueOf(o *jsonv.Object, key string) any {
	v, _ := o.Get(key)
	return v
}

func decodeShot(png_ []byte) (image.Image, error) {
	img, err := png.Decode(bytes.NewReader(png_))
	if err != nil {
		return nil, fmt.Errorf("decode the render: %w", err)
	}
	return img, nil
}

func (m *MCP) fitToReference(ctx context.Context, a *jsonv.Object, head WorkspaceHead) (ToolResult, error) {
	start := time.Now()
	if m.shot == nil {
		return nil, errors.New("screenshot unavailable on this server")
	}
	d := head.Doc
	rootID := a.Str("rootId")
	if core.GetNode(d, rootID) == nil {
		return nil, fmt.Errorf("node %q not found", rootID)
	}
	ids := a.Strings("ids")
	under := subtreeOf(d, rootID)
	seen := map[string]bool{}
	var order []string
	for _, id := range ids {
		switch {
		case id == rootID:
			return nil, fmt.Errorf("%q is the frame being fitted (rootId); pass the nodes inside it", id)
		case core.GetNode(d, id) == nil:
			return nil, fmt.Errorf("node %q not found", id)
		case !under[id]:
			return nil, fmt.Errorf("node %q is not under rootId %q", id, rootID)
		}
		if !seen[id] {
			seen[id] = true
			order = append(order, id)
		}
	}
	wanted := map[string]bool{}
	if a.Has("params") {
		for _, p := range a.Strings("params") {
			if !fitParams[p] {
				return nil, fmt.Errorf("unknown param %q (position, size, rotation, radius, pathPoints)", p)
			}
			wanted[p] = true
		}
	}
	if len(wanted) == 0 {
		wanted["position"], wanted["size"] = true, true
	}
	maxIter := fitDefaultIterations
	if a.Has("maxIterations") {
		maxIter = min(fitMaxIterations, max(1, int(a.Num("maxIterations"))))
	}
	target := 0.99
	if a.Has("target") {
		target = a.Num("target")
	}

	loaded, err := loadReference(d, rootID, a.Str("reference"), "fit_to_reference")
	if err != nil {
		return nil, err
	}
	renderDoc := loaded.renderDoc

	// boxes of the nodes, relative to the frame's corner
	boxes, err := core.Layout(d, core.LayoutOptions{RootID: rootID})
	if err != nil {
		return nil, err
	}
	var ox, oy float64
	if rb, ok := boxes[rootID]; ok {
		ox, oy = rb.X, rb.Y
	} else if n := core.GetNode(d, rootID); n != nil && n.Str("type") != "page" {
		ox, oy = n.Num("x"), n.Num("y")
	}
	maxAnchors := 8
	if a.Has("maxAnchors") {
		maxAnchors = int(a.Num("maxAnchors"))
	}
	var warnings []string
	var sources []fitSource
	var tuned []fitSource
	for _, id := range order {
		s := fitNodeFor(d, id, boxes, ox, oy, rootID, wanted, maxAnchors)
		sources = append(sources, s)
		if s.skipped == "" {
			tuned = append(tuned, s)
			// say which of the asked params this node ignores
			var ignored []string
			if wanted["position"] && !s.free.Position {
				ignored = append(ignored, "position")
			}
			if wanted["size"] && !s.free.Size {
				ignored = append(ignored, "size")
			}
			if wanted["radius"] && !s.free.Radius && s.fit.Kind == "rect" {
				ignored = append(ignored, "radius")
			}
			if wanted["pathPoints"] && !s.free.PathPoints && s.path {
				ignored = append(ignored, "pathPoints")
			}
			if len(ignored) > 0 {
				warnings = append(warnings, fmt.Sprintf("%s: %s not tuned (a row/column layout decides it, its size is hug/fill, or it has a viewBox)", s.n.Str("id"), strings.Join(ignored, ", ")))
			}
		}
	}
	if len(tuned) == 0 {
		var why []string
		for _, s := range sources {
			why = append(why, fmt.Sprintf("%s: %s", s.n.Str("id"), s.skipped))
		}
		return nil, fmt.Errorf("none of the nodes can be fitted: %s", strings.Join(why, "; "))
	}

	// the frame as it is, and with the tuned nodes left out (their ink is rasterized here)
	pngBefore, pw, ph, err := m.shot.ScreenshotMode(ctx, renderDoc, rootID, 1, a.Str("mode"))
	if err != nil {
		return nil, err
	}
	drawnBefore, err := decodeShot(pngBefore)
	if err != nil {
		return nil, err
	}
	fixedDoc, ok := jsonv.Clone(renderDoc).(*jsonv.Object)
	if !ok {
		return nil, errors.New("cannot copy the document")
	}
	for _, s := range tuned {
		n := core.GetNode(fixedDoc, s.n.Str("id"))
		if n == nil {
			continue
		}
		if len(n.Strings("children")) > 0 {
			for _, k := range []string{"fill", "stroke", "shadow", "outline", "filter", "backdropFilter"} {
				n.Delete(k)
			}
		} else {
			n.Set("opacity", 0.0)
		}
	}
	pngFixed, fw2, fh2, err := m.shot.ScreenshotMode(ctx, fixedDoc, rootID, 1, a.Str("mode"))
	if err != nil {
		return nil, err
	}
	if fw2 != pw || fh2 != ph {
		return nil, fmt.Errorf("the frame changes size (%dx%d to %dx%d) when the nodes are left out; fit_to_reference needs a stable frame size", pw, ph, fw2, fh2)
	}
	fixed, err := decodeShot(pngFixed)
	if err != nil {
		return nil, err
	}

	fwF, fhF := float64(pw), float64(ph)
	x, y, w, h := fitPlacement(fwF, fhF, float64(loaded.info.width), float64(loaded.info.height))
	placed := vision.Rect{X: x, Y: y, Width: w, Height: h}
	fitNodes := make([]vision.FitNode, len(tuned))
	for i, s := range tuned {
		fitNodes[i] = s.fit
	}
	fitStart := time.Now()
	res, err := vision.FitReference(vision.FitInput{
		Ref: loaded.img, Fixed: fixed, FrameW: fwF, FrameH: fhF, Placed: placed,
		Nodes: fitNodes, MaxIterations: maxIter, Target: target, Deadline: fitStart.Add(fitBudget),
	})
	if err != nil {
		return nil, err
	}
	fitMs := time.Since(fitStart).Milliseconds()
	if loaded.warn != "" {
		warnings = append(warnings, loaded.warn)
	}
	if loaded.info.animated {
		warnings = append(warnings, "animated reference: compared the first frame only")
	}
	if loaded.node != "" {
		warnings = append(warnings, fmt.Sprintf("the reference layer %s was left out of the render", loaded.node))
	}
	warnings = append(warnings, res.Warnings...)

	// the document changes, node by node
	byID := map[string]vision.FitNodeResult{}
	for _, r := range res.Nodes {
		byID[r.ID] = r
	}
	var ops []any
	var outNodes []fitNodeOut
	for _, s := range sources {
		id := s.n.Str("id")
		out := fitNodeOut{ID: id, Name: s.n.Str("name"), Type: s.n.Str("type"), Changes: map[string]fitChange{}}
		r, found := byID[id]
		switch {
		case s.skipped != "":
			out.Skipped = s.skipped
		case found && r.Skipped != "":
			out.Skipped = r.Skipped
		case found:
			props, moves := fitProps(d, s, r, &out)
			out.PathPoints = moves
			if props.Len() > 0 {
				ops = append(ops, jsonv.NewObject("op", "update", "id", id, "props", props))
			}
		}
		outNodes = append(outNodes, out)
	}

	// the Chromium numbers: the frame as it is, and as it would be after the changes
	chromBefore := vision.FitIoU(drawnBefore, loaded.img, fwF, fhF, placed)
	chromAfter := chromBefore
	maskBefore, maskAfter := round3(res.IoUBefore), round3(res.IoUAfter)
	if len(ops) > 0 {
		next, aerr := core.ApplyOps(renderDoc, ops)
		if aerr != nil {
			return nil, fmt.Errorf("the tuned numbers do not apply: %w", aerr)
		}
		pngAfter, aw, ah, serr := m.shot.ScreenshotMode(ctx, next.Doc, rootID, 1, a.Str("mode"))
		if serr != nil {
			return nil, serr
		}
		if aw != pw || ah != ph {
			warnings = append(warnings, fmt.Sprintf("the frame would change size (%dx%d to %dx%d) with these numbers", pw, ph, aw, ah))
		}
		drawnAfter, derr := decodeShot(pngAfter)
		if derr != nil {
			return nil, derr
		}
		chromAfter = vision.FitIoU(drawnAfter, loaded.img, fwF, fhF, placed)
	}
	chromBefore, chromAfter = round3(chromBefore), round3(chromAfter)
	if math.Abs(maskBefore-chromBefore) > fitDivergence || (len(ops) > 0 && math.Abs(maskAfter-chromAfter) > fitDivergence) {
		warnings = append(warnings, fmt.Sprintf("the rasterizer and Chromium disagree by more than %.2f (mask %.3f vs Chromium %.3f before, %.3f vs %.3f after): text, shadows, gradients, clipping or overlapping paint are not modeled; trust the Chromium numbers", fitDivergence, maskBefore, chromBefore, maskAfter, chromAfter))
	}

	out := &fitOutput{
		WorkspaceID: head.ID, WorkspaceName: head.Name, RootID: rootID, DryRun: a.Bool("dryRun"),
		IoU:    fitIoU{Mask: fitIoUPair{maskBefore, maskAfter}, Chromium: fitIoUPair{chromBefore, chromAfter}},
		Target: target, Iterations: res.Rounds, FitMs: fitMs, Canvas: res.Canvas, Nodes: outNodes,
	}
	switch {
	case len(ops) == 0:
		out.IoU.Chromium.After = chromBefore
		warnings = append(warnings, "no number moved: the nodes are already at their best for these params")
	case chromAfter < chromBefore-fitRegression:
		warnings = append(warnings, fmt.Sprintf("not applied: Chromium scores the tuned numbers worse (%.3f, was %.3f) than the rasterizer predicted; nothing was written", chromAfter, chromBefore))
	case !out.DryRun:
		lbl := "fit to reference"
		if a.Has("label") {
			lbl = a.Str("label")
		}
		_, wrote, werr := m.store.ApplyIn(head.ID, ops, m.actorName(), lbl, a.Str("batch"))
		if werr != nil {
			return nil, werr
		}
		out.Version = &wrote.Version
		out.Applied = true
	}
	out.Pass = out.IoU.Chromium.After >= target
	out.Warnings = warnings
	if out.Warnings == nil {
		out.Warnings = []string{}
	}
	out.ElapsedMs = time.Since(start).Milliseconds()
	return jsonv.NewObject(
		"content", []any{jsonv.NewObject("type", "text", "text", fitSummary(out))},
		"structuredContent", jsonv.FromGo(out),
	), nil
}

func fitRound(v float64) float64 { return math.Round(v*100) / 100 }

func radiusValue(r [4]float64) any {
	if r[0] == r[1] && r[1] == r[2] && r[2] == r[3] {
		return fitRound(r[0])
	}
	return []any{fitRound(r[0]), fitRound(r[1]), fitRound(r[2]), fitRound(r[3])}
}

// fitProps turns a tuned state into the props of one update, and records before/after.
func fitProps(d *core.Document, s fitSource, r vision.FitNodeResult, out *fitNodeOut) (*jsonv.Object, []fitAnchorMove) {
	n := s.n
	props := jsonv.NewObject()
	rec := func(key string, before, after float64) {
		before, after = fitRound(before), fitRound(after)
		if before != after {
			props.Set(key, after)
			out.Changes[key] = fitChange{Before: before, After: after}
		}
	}
	dx, dy := r.X-s.fit.X, r.Y-s.fit.Y
	x0, y0 := n.Num("x"), n.Num("y")
	x1, y1 := x0+dx, y0+dy
	w1, h1 := r.W, r.H

	var moves []fitAnchorMove
	for _, mv := range r.Moves {
		moves = append(moves, fitAnchorMove{Index: mv.Index, DX: fitRound(mv.DX), DY: fitRound(mv.DY)})
	}

	if r.Path != nil && (r.Changed["pathPoints"] || r.Changed["size"]) {
		// the path is rewritten: scaled to the new size and with its anchors moved
		subs := make([]core.Subpath, len(r.Path))
		for i, sub := range r.Path {
			cs := core.Subpath{Closed: sub.Closed}
			for _, a := range sub.Anchors {
				ca := core.PathAnchor{X: a.X, Y: a.Y}
				if a.In != nil {
					ca.In = &core.Point{X: a.In.X, Y: a.In.Y}
				}
				if a.Out != nil {
					ca.Out = &core.Point{X: a.Out.X, Y: a.Out.Y}
				}
				cs.Anchors = append(cs.Anchors, ca)
			}
			subs[i] = cs
		}
		if edited := core.PathEditProps(core.PathEditNode{X: x1, Y: y1}, subs, s.hasBox); edited != nil {
			if edited.HasXY {
				ex, ey := edited.X, edited.Y
				if r.Rot != 0 && edited.HasSize {
					// the box was renormalized: keep the rotation pivot where it was
					rad := r.Rot * math.Pi / 180
					sin, cos := math.Sin(rad), math.Cos(rad)
					e := core.Point{X: (edited.X + edited.Width/2) - (x1 + w1/2), Y: (edited.Y + edited.Height/2) - (y1 + h1/2)}
					inv := core.Point{X: e.X*cos + e.Y*sin, Y: -e.X*sin + e.Y*cos}
					ex += e.X - inv.X
					ey += e.Y - inv.Y
				}
				rec("x", x0, ex)
				rec("y", y0, ey)
			}
			if edited.HasSize {
				rec("width", n.Num("width"), edited.Width)
				rec("height", n.Num("height"), edited.Height)
			}
			props.Set("d", edited.D)
		}
	} else {
		if r.Changed["position"] || r.Changed["size"] {
			rec("x", x0, x1)
			rec("y", y0, y1)
		}
		if r.Changed["size"] {
			rec("width", n.Num("width"), w1)
			rec("height", n.Num("height"), h1)
		}
	}
	if r.Changed["rotation"] {
		rec("rotation", n.Num("rotation"), r.Rot)
	}
	if r.Changed["radius"] {
		after := radiusValue(r.Radius)
		before, _ := n.Get("radius")
		if before == nil {
			before = 0.0
		}
		props.Set("radius", after)
		out.Changes["radius"] = fitChange{Before: before, After: after}
	}
	return props, moves
}

func fitSummary(o *fitOutput) string {
	var b strings.Builder
	verdict := "FAIL"
	if o.Pass {
		verdict = "pass"
	}
	state := "applied"
	switch {
	case o.DryRun:
		state = "dry run, nothing written"
	case !o.Applied:
		state = "not applied"
	}
	fmt.Fprintf(&b, "fit_to_reference %s (%s): chromium iou %.3f -> %.3f (target %.2f) %s | mask iou %.3f -> %.3f | %d rounds, %d ms\n",
		o.RootID, state, o.IoU.Chromium.Before, o.IoU.Chromium.After, o.Target, verdict, o.IoU.Mask.Before, o.IoU.Mask.After, o.Iterations, o.ElapsedMs)
	for _, n := range o.Nodes {
		fmt.Fprintf(&b, "  %s", n.ID)
		if n.Name != "" {
			fmt.Fprintf(&b, " %q", n.Name)
		}
		fmt.Fprintf(&b, " %s:", n.Type)
		if n.Skipped != "" {
			fmt.Fprintf(&b, " skipped (%s)\n", n.Skipped)
			continue
		}
		if len(n.Changes) == 0 && len(n.PathPoints) == 0 {
			b.WriteString(" unchanged\n")
			continue
		}
		for _, k := range []string{"x", "y", "width", "height", "rotation", "radius"} {
			if c, ok := n.Changes[k]; ok {
				fmt.Fprintf(&b, " %s %v -> %v", k, c.Before, c.After)
			}
		}
		for _, mv := range n.PathPoints {
			fmt.Fprintf(&b, " anchor %d (%+g,%+g)", mv.Index, mv.DX, mv.DY)
		}
		b.WriteString("\n")
	}
	for _, w := range o.Warnings {
		fmt.Fprintf(&b, "warning: %s\n", w)
	}
	if !o.Pass && o.Applied {
		b.WriteString("next: compare_reference to see what is still off (regions, nodes)\n")
	}
	return strings.TrimRight(b.String(), "\n")
}
