package server

import (
	"math"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// pathBoxFix is one normalize_paths change: the new d and box of a path whose node box did not match its ink.
type pathBoxFix struct {
	id             string
	d              string
	bx, by, bw, bh float64 // before
	x, y, w, h     float64 // after
}

// planPathBoxes walks ids (or the whole document) and returns the paths whose box does not hug their ink,
// with the node fields that fix it (the drawing stays where it is on the canvas, rotation included), and
// the ids it left alone with the reason.
func planPathBoxes(doc *core.Document, ids []string) (fixes []pathBoxFix, unchanged int, skipped []any) {
	for _, id := range ids {
		n := core.GetNode(doc, id)
		if n == nil || n.Str("type") != "path" {
			continue
		}
		skip := func(reason string) { skipped = append(skipped, jsonv.NewObject("id", id, "reason", reason)) }
		if n.Has("viewBox") {
			skip("has a viewBox (the drawing is scaled to the box)")
			continue
		}
		if owner := core.CopyOwner(doc, n); owner != nil {
			skip("copy inside an instance")
			continue
		}
		if n.Bool("locked") {
			skip("locked")
			continue
		}
		w0, wOK := n.Get("width")
		h0, hOK := n.Get("height")
		ow, wNum := w0.(float64)
		oh, hNum := h0.(float64)
		if !wOK || !hOK || !wNum || !hNum {
			skip("width or height is not a number")
			continue
		}
		segs, err := core.ParsePath(n.Str("d"))
		if err != nil || len(segs) == 0 {
			skip("d does not parse")
			continue
		}
		moved, origin, b := core.NormalizePath(segs)
		nw := math.Max(1, math.Ceil(b.X+b.Width))
		nh := math.Max(1, math.Ceil(b.Y+b.Height))
		if origin.X == 0 && origin.Y == 0 && nw == ow && nh == oh {
			unchanged++
			continue
		}
		x, y := n.Num("x"), n.Num("y")
		nx, ny := core.Round4(x+origin.X), core.Round4(y+origin.Y)
		if rot := n.Num("rotation"); rot != 0 {
			// The box turns around its own center: keep the ink where it is by solving for the new corner.
			th := rot * math.Pi / 180
			c, s := math.Cos(th), math.Sin(th)
			dw, dh := (ow-nw)/2, (oh-nh)/2
			nx = x + (1-c)*dw + s*dh + c*origin.X - s*origin.Y
			ny = y - s*dw + (1-c)*dh + s*origin.X + c*origin.Y
			nx, ny = core.Round4(nx), core.Round4(ny)
		}
		fixes = append(fixes, pathBoxFix{
			id: id, d: core.SerializePath(moved),
			bx: x, by: y, bw: ow, bh: oh,
			x: nx, y: ny, w: nw, h: nh,
		})
	}
	return fixes, unchanged, skipped
}
