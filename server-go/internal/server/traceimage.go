package server

import (
	"errors"
	"fmt"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/vision"
)

// tracedOut is one traced path as the tool reports it: the id of the node it became (empty on a
// dry run, which carries the path data instead).
type tracedOut struct {
	ID string `json:"id,omitempty"`
	vision.TracedPath
}

// traceApply writes the nodes of a trace the way create_nodes does (one undo step, batch honoured).
type traceApply func(ops []any, label string, extra ...any) (ToolResult, error)

func traceImage(a *jsonv.Object, doc func() (*core.Document, error), apply traceApply) (ToolResult, error) {
	hasSrc, hasNode := a.Has("src"), a.Has("nodeId")
	switch {
	case hasSrc && hasNode:
		return nil, errors.New("trace_image takes src or nodeId, not both")
	case !hasSrc && !hasNode:
		return nil, errors.New("trace_image requires src (data URL, raw base64 or a path under PAPRIKA_IMPORT_DIRS) or nodeId (an image node)")
	}
	dry := a.Bool("dryRun")
	parentID := a.Str("parentId")
	if parentID == "" && !dry {
		return nil, errors.New("trace_image requires parentId (the frame to draw into), or dryRun: true to only get the path data")
	}
	var parent *core.Node
	if parentID != "" {
		d, err := doc()
		if err != nil {
			return nil, err
		}
		if parent = core.GetNode(d, parentID); parent == nil {
			return nil, fmt.Errorf("node %q not found", parentID)
		}
		if !core.IsContainer(parent.Str("type")) {
			return nil, fmt.Errorf("parentId %q is a %s: only frame, group and page take children", parentID, parent.Str("type"))
		}
	}
	info, err := analyzeSource(a, doc)
	if err != nil {
		return nil, err
	}
	switch {
	case info.mime == "image/avif":
		return nil, errors.New("AVIF cannot be traced: no pure-Go pixel decoder (re-export as PNG or JPEG first)")
	case info.mime == "image/webp" && info.animated:
		return nil, errors.New("animated WebP cannot be traced: use a still frame (PNG or JPEG)")
	}
	img, warn, err := decodePixels(info)
	if err != nil {
		return nil, err
	}
	opts := vision.TraceOptions{
		MaxColors:         int(a.Num("maxColors")),
		MinArea:           a.Num("minArea"),
		Corner:            a.Num("smoothness"),
		Tolerance:         a.Num("tolerance"),
		Colors:            a.Strings("colors"),
		IncludeBackground: a.Bool("includeBackground"),
		MaxPaths:          int(a.Num("maxPaths")),
		Scale:             1,
	}
	if r := a.Obj("region"); r != nil {
		opts.Region = &vision.Rect{X: r.Num("x"), Y: r.Num("y"), Width: r.Num("width"), Height: r.Num("height")}
	}
	iw, ih := float64(info.width), float64(info.height)
	var px, py, pw float64
	placed := false
	switch f := a.Obj("frame"); {
	case f != nil:
		px, py, pw, _ = fitPlacement(f.Num("width"), f.Num("height"), iw, ih)
		placed = true
	case parent != nil:
		if _, ok := positiveFloat(parent, "width"); ok {
			px, py, pw, _ = referencePlacement(parent, iw, ih)
			placed = pw > 0
		}
	}
	if placed {
		opts.Scale, opts.OffsetX, opts.OffsetY = pw/iw, px, py
	}
	res, err := vision.Trace(img, opts)
	if err != nil {
		return nil, err
	}
	if placed {
		res.Placed = &vision.Rect{X: px, Y: py, Width: pw, Height: round2(ih * opts.Scale)}
	}
	if warn != "" {
		res.Warnings = append(res.Warnings, warn)
	}
	if info.animated {
		res.Warnings = append(res.Warnings, "animated image: traced the first frame only")
	}
	if len(res.Paths) == 0 {
		res.Warnings = append(res.Warnings, "nothing to trace: no blob passes minArea (is the image one flat color, or fully background?)")
	}
	if res.Truncated {
		res.Warnings = append(res.Warnings, fmt.Sprintf("found %d paths, drew the %d largest (raise maxPaths or minArea, or pass colors)", res.PathCount, len(res.Paths)))
	}

	paths := make([]tracedOut, len(res.Paths))
	for i, p := range res.Paths {
		paths[i] = tracedOut{TracedPath: p}
	}
	summary := fmt.Sprintf("traced %d path(s): %d points, %d segments, max error %g px", len(paths), res.Points, res.Segments, res.MaxError)
	info2 := func(extra []any) []any {
		return append(extra,
			"paths", jsonv.FromGo(paths),
			"pathCount", float64(res.PathCount),
			"truncated", res.Truncated,
			"points", float64(res.Points),
			"segments", float64(res.Segments),
			"maxError", res.MaxError,
			"background", jsonv.FromGo(res.Background),
			"palette", jsonv.FromGo(res.Palette),
			"size", jsonv.FromGo(res.Size),
			"region", jsonv.FromGo(res.Region),
			"scale", res.Scale,
			"warnings", jsonv.FromGo(res.Warnings),
		)
	}
	if dry || len(paths) == 0 {
		out := jsonv.NewObject(info2([]any{"dryRun", true, "nodeCount", 0.0})...)
		if res.Placed != nil {
			out.Set("placed", jsonv.FromGo(res.Placed))
		}
		if !dry {
			out.Set("dryRun", false)
		}
		r := textResult(summary + "; nothing was created")
		r.Set("structuredContent", out)
		return r, nil
	}

	nodes := make([]any, len(paths))
	for i := range paths {
		id := core.NewID()
		paths[i].ID = id
		n := jsonv.NewObject("id", id, "type", "path", "name", fmt.Sprintf("Trace %d %s", i+1, paths[i].Color),
			"d", paths[i].D, "x", 0.0, "y", 0.0, "fill", paths[i].Color, "normalize", true)
		if paths[i].Rings > 1 {
			n.Set("fillRule", "evenodd")
		}
		paths[i].D = ""
		nodes[i] = n
	}
	if a.Bool("group") || !a.Has("group") {
		nodes = []any{jsonv.NewObject("type", "group", "name", "Trace", "children", nodes)}
	}
	ops := make([]any, len(nodes))
	d, err := doc()
	if err != nil {
		return nil, err
	}
	for i, n := range nodes {
		op := jsonv.NewObject("op", "create", "node", n, "parentId", parentID)
		if o, ok := n.(*jsonv.Object); ok {
			if p, use := createPlace(d, parentID, o, a); use {
				op.Set("place", p)
			}
		}
		ops[i] = op
	}
	extra := info2([]any{"dryRun", false, "nodeCount", 0.0})
	if res.Placed != nil {
		extra = append(extra, "placed", jsonv.FromGo(res.Placed))
	}
	label := "trace image (" + summaryCount(len(paths)) + " paths)"
	if a.Has("label") {
		label = a.Str("label")
	}
	r, err := apply(ops, label, extra...)
	if err != nil {
		return nil, err
	}
	if sc := r.Obj("structuredContent"); sc != nil {
		sc.Set("nodeCount", float64(len(sc.Arr("created"))))
		sc.Set("paths", jsonv.FromGo(paths))
	}
	r.Set("content", append([]any{jsonv.NewObject("type", "text", "text", summary)}, r.Arr("content")...))
	return r, nil
}

func summaryCount(n int) string { return jsonv.FormatNumber(float64(n)) }
