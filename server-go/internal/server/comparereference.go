package server

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image/png"
	"math"
	"strings"
	"sync"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/vision"
)

// compareScores are the numbers kept per (workspace, root) to tell whether a round improved.
type compareScores struct {
	IoU       float64 `json:"iou"`
	Missing   float64 `json:"missing"`
	Extra     float64 `json:"extra"`
	DeltaE    float64 `json:"colorDeltaE"`
	Reference string  `json:"-"`
}

type compareDelta struct {
	IoU     float64 `json:"iou"`
	Missing float64 `json:"missing"`
	Extra   float64 `json:"extra"`
	DeltaE  float64 `json:"colorDeltaE"`
}

type compareMemory struct {
	mu    sync.Mutex
	last  map[string]compareScores
	order []string
}

const compareMemoryLimit = 256

func (m *compareMemory) swap(key string, now compareScores) (compareScores, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.last == nil {
		m.last = map[string]compareScores{}
	}
	prev, ok := m.last[key]
	if !ok {
		m.order = append(m.order, key)
		for len(m.order) > compareMemoryLimit {
			delete(m.last, m.order[0])
			m.order = m.order[1:]
		}
	}
	m.last[key] = now
	return prev, ok
}

type compareFrame struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type compareRefInfo struct {
	Source string      `json:"source"` // node, data, path
	NodeID string      `json:"nodeId,omitempty"`
	Width  int         `json:"width"`
	Height int         `json:"height"`
	Placed vision.Rect `json:"placed"`
}

type compareDiff struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	URL    string `json:"url,omitempty"`
	Path   string `json:"path,omitempty"`
}

type compareOutput struct {
	WorkspaceID   string `json:"workspaceId"`
	WorkspaceName string `json:"workspaceName"`
	RootID        string `json:"rootId"`
	*vision.Comparison
	Frame         compareFrame   `json:"frame"`
	Reference     compareRefInfo `json:"reference"`
	Diff          *compareDiff   `json:"diff,omitempty"`
	Previous      *compareScores `json:"previous,omitempty"`
	SameReference *bool          `json:"sameReference,omitempty"`
	Delta         *compareDelta  `json:"delta,omitempty"`
}

// compareReference renders rootId, measures it against the reference and reports numbers.
func (m *MCP) compareReference(ctx context.Context, a *jsonv.Object, head WorkspaceHead) (ToolResult, error) {
	if m.shot == nil {
		return nil, errors.New("screenshot unavailable on this server")
	}
	d := head.Doc
	rootID := a.Str("rootId")
	root := core.GetNode(d, rootID)
	if root == nil {
		return nil, fmt.Errorf("node %q not found", rootID)
	}
	ref := strings.TrimSpace(a.Str("reference"))
	if ref == "" {
		return nil, errors.New("compare_reference requires reference (data URL, raw base64, a path under PAPRIKA_IMPORT_DIRS or the id of an image node)")
	}

	// the reference: a data URL, raw base64, a path, or an image node of this workspace
	source, refNode := "data", ""
	var info rasterInfo
	var err error
	switch {
	case strings.HasPrefix(ref, "data:") || looksLikeBase64(ref):
		info, _, err = loadImportImage(normalizeImageSrc(ref))
	case core.GetNode(d, ref) != nil:
		var src string
		if src, err = imageNodeSrc(d, ref); err != nil {
			return nil, err
		}
		if ref == rootID {
			return nil, errors.New("the reference node cannot be the frame being compared")
		}
		source, refNode = "node", ref
		info, _, err = loadImportImage(normalizeImageSrc(src))
	default:
		source = "path"
		info, _, err = loadImportImage(ref)
		if err != nil && !strings.ContainsAny(ref, "/.\\") {
			return nil, fmt.Errorf("%q is not a node of this workspace (reference takes a data URL, raw base64, a path under PAPRIKA_IMPORT_DIRS or the id of an image node): %w", ref, err)
		}
	}
	if err != nil {
		return nil, err
	}
	refImg, warn, err := decodeForVision(info)
	if err != nil {
		return nil, err
	}

	// the reference layer must not be in the render, or the comparison would see itself
	renderDoc := d
	if refNode != "" {
		clone, ok := jsonv.Clone(d).(*jsonv.Object)
		if !ok {
			return nil, errors.New("cannot copy the document")
		}
		if n := core.GetNode(clone, refNode); n != nil {
			n.Set("visible", false)
		}
		renderDoc = clone
	}
	scale := a.Num("scale")
	if scale <= 0 {
		scale = 1
	}
	pngBytes, pw, ph, err := m.shot.ScreenshotMode(ctx, renderDoc, rootID, scale, a.Str("mode"))
	if err != nil {
		return nil, err
	}
	drawn, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("decode the render: %w", err)
	}
	fw, fh := float64(pw)/scale, float64(ph)/scale

	// painted boxes of the nodes under rootId, in frame coordinates, in paint order
	nodes := compareNodes(renderDoc, rootID)

	x, y, w, h := fitPlacement(fw, fh, float64(info.width), float64(info.height))
	in := vision.CompareInput{
		Drawn: drawn, Ref: refImg, FrameW: fw, FrameH: fh,
		Placed: vision.Rect{X: x, Y: y, Width: w, Height: h},
		Nodes:  nodes, Target: a.Num("target"), Top: int(a.Num("top")), Rotate: a.Bool("rotation"),
	}
	res, err := vision.Compare(in)
	if err != nil {
		return nil, err
	}
	if warn != "" {
		res.Warnings = append(res.Warnings, warn)
	}
	if info.animated {
		res.Warnings = append(res.Warnings, "animated reference: compared the first frame only")
	}
	if refNode != "" {
		res.Warnings = append(res.Warnings, fmt.Sprintf("the reference layer %s was left out of the render", refNode))
	}

	out := &compareOutput{
		WorkspaceID: head.ID, WorkspaceName: head.Name, RootID: rootID, Comparison: res,
		Frame:     compareFrame{Width: round2(fw), Height: round2(fh)},
		Reference: compareRefInfo{Source: source, NodeID: refNode, Width: info.width, Height: info.height, Placed: vision.Rect{X: x, Y: y, Width: w, Height: h}},
	}

	// history: the last round of this root, to tell whether the round improved
	sum := sha1.Sum(info.data)
	now := compareScores{IoU: res.IoU, Missing: res.Missing, Extra: res.Extra, DeltaE: res.Color.DeltaE, Reference: hex.EncodeToString(sum[:6])}
	if prev, ok := m.store.compare.swap(head.ID+"\x00"+rootID, now); ok {
		same := prev.Reference == now.Reference
		out.Previous, out.SameReference = &prev, &same
		out.Delta = &compareDelta{
			IoU: round3(now.IoU - prev.IoU), Missing: round3(now.Missing - prev.Missing),
			Extra: round3(now.Extra - prev.Extra), DeltaE: math.Round((now.DeltaE-prev.DeltaE)*10) / 10,
		}
	}

	// the diff image: kept like a screenshot (url), written to path when asked, inline when asked
	diffPNG := res.DiffPNG()
	diff := &compareDiff{Width: res.Canvas.Width, Height: res.Canvas.Height}
	if url := screenshotURL(m.shot, diffPNG); url != "" {
		diff.URL = url
	}
	if rel := a.Str("path"); rel != "" {
		abs, err := writeScreenshot(m.store.Path(), rel, diffPNG)
		if err != nil {
			return nil, err
		}
		diff.Path = abs
	}
	out.Diff = diff

	text := compareSummary(out)
	content := []any{jsonv.NewObject("type", "text", "text", text)}
	if a.Bool("includeDiff") {
		content = append(content, jsonv.NewObject("type", "image", "data", base64.StdEncoding.EncodeToString(diffPNG), "mimeType", "image/png"))
	}
	return jsonv.NewObject("content", content, "structuredContent", jsonv.FromGo(out)), nil
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// compareNodes lists the painting nodes under rootID in paint order (later paints over earlier),
// with their rotated boxes relative to the root's top-left corner.
func compareNodes(d *core.Document, rootID string) []vision.NodeBox {
	boxes, err := core.Layout(d, core.LayoutOptions{RootID: rootID})
	if err != nil {
		return nil
	}
	var ox, oy float64
	if rb, ok := boxes[rootID]; ok {
		ox, oy = rb.X, rb.Y
	} else if n := core.GetNode(d, rootID); n != nil && n.Str("type") != "page" {
		ox, oy = n.Num("x"), n.Num("y")
	}
	var out []vision.NodeBox
	var walk func(id string, depth int)
	walk = func(id string, depth int) {
		n := core.GetNode(d, id)
		if n == nil || depth > 200 || len(out) >= 2000 {
			return
		}
		typ := n.Str("type")
		if b, ok := boxes[id]; ok && id != rootID && typ != "group" && typ != "page" {
			nb := vision.NodeBox{ID: id, Name: n.Str("name"), Type: typ, Ellipse: typ == "ellipse" || (typ == "shape" && n.Str("shape") == "ellipse")}
			for i, c := range b.Corners {
				nb.Corners[i] = vision.Point{X: c.X - ox, Y: c.Y - oy}
			}
			out = append(out, nb)
		}
		for _, c := range n.Strings("children") {
			walk(c, depth+1)
		}
	}
	walk(rootID, 0)
	return out
}

func compareSummary(o *compareOutput) string {
	var b strings.Builder
	pass := "FAIL"
	if o.Pass {
		pass = "pass"
	}
	fmt.Fprintf(&b, "compare_reference %s %gx%g vs reference %dx%d (fitted %gx%g at %g,%g)\n",
		o.RootID, o.Frame.Width, o.Frame.Height, o.Reference.Width, o.Reference.Height,
		o.Reference.Placed.Width, o.Reference.Placed.Height, o.Reference.Placed.X, o.Reference.Placed.Y)
	fmt.Fprintf(&b, "iou %.2f (target %.2f) %s | missing %.0f%% of the reference ink, extra %.0f%% of the drawn ink\n",
		o.IoU, o.Target, pass, o.Missing*100, o.Extra*100)
	fmt.Fprintf(&b, "colour: dE %.1f by palette, %.1f by pixel, score %.2f", o.Color.DeltaE, o.Color.PixelDeltaE, o.Color.Score)
	for _, c := range o.Color.Unmatched {
		fmt.Fprintf(&b, " | drawn %s %.0f%% has no match (nearest %s dE %.1f)", c.Color, c.Share*100, c.Nearest, c.DeltaE)
	}
	fmt.Fprintf(&b, "\nraw pixel match %.0f%% (misleading: the background dominates; act on iou)\n", o.RawMatch.Value*100)
	if o.Previous != nil {
		fmt.Fprintf(&b, "previous round: iou %.2f -> %.2f (%+.3f), missing %+.3f, extra %+.3f", o.Previous.IoU, o.IoU, o.Delta.IoU, o.Delta.Missing, o.Delta.Extra)
		if o.SameReference != nil && !*o.SameReference {
			b.WriteString(" (another reference)")
		}
		b.WriteString("\n")
	}
	if al := o.Alignment; al != nil {
		if al.Significant {
			fmt.Fprintf(&b, "align: move everything by (%+g,%+g)", al.DX, al.DY)
			if al.Scale != 1 {
				fmt.Fprintf(&b, ", scale %g around (%g,%g)", al.Scale, al.Origin.X, al.Origin.Y)
			}
			if al.Rotation != 0 {
				fmt.Fprintf(&b, ", rotate %g deg", al.Rotation)
			}
			fmt.Fprintf(&b, ": iou %.2f -> %.2f (fix this first)\n", al.IoUBefore, al.IoUAfter)
		} else {
			fmt.Fprintf(&b, "align: no global offset helps (best iou %.2f)\n", al.IoUAfter)
		}
	}
	for _, kind := range []string{"missing", "extra"} {
		n := 0
		for _, r := range o.Regions {
			if r.Kind != kind {
				continue
			}
			if n == 0 {
				fmt.Fprintf(&b, "%s regions (largest first):\n", kind)
			}
			n++
			fmt.Fprintf(&b, "  x %g y %g %gx%g  %.1f%% of the frame  %s\n", r.Box.X, r.Box.Y, r.Box.Width, r.Box.Height, r.AreaShare*100, r.Color)
		}
	}
	if len(o.Nodes) > 0 {
		b.WriteString("nodes off the reference (worst first):\n")
		for _, n := range o.Nodes {
			fmt.Fprintf(&b, "  %s", n.ID)
			if n.Name != "" {
				fmt.Fprintf(&b, " %q", n.Name)
			}
			fmt.Fprintf(&b, " %s %.0f%% on the reference", n.Type, n.OnReference*100)
			if n.SuggestedMove != nil {
				fmt.Fprintf(&b, ", move (%+g,%+g)", n.SuggestedMove.DX, n.SuggestedMove.DY)
			}
			b.WriteString("\n")
		}
	}
	if o.Diff != nil {
		switch {
		case o.Diff.Path != "":
			fmt.Fprintf(&b, "diff (red missing, blue extra, gray matched): %s", o.Diff.Path)
			if o.Diff.URL != "" {
				fmt.Fprintf(&b, " (%s)", o.Diff.URL)
			}
			b.WriteString("\n")
		case o.Diff.URL != "":
			fmt.Fprintf(&b, "diff (red missing, blue extra, gray matched): %s\n", o.Diff.URL)
		}
	}
	for _, w := range o.Warnings {
		fmt.Fprintf(&b, "warning: %s\n", w)
	}
	return strings.TrimRight(b.String(), "\n")
}
