package vision

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Summary is the compact text an agent reads first: palette, background, one line per blob with
// its paste-ready node, and the layout hints. The full detail is in the structured result.
func (r *Result) Summary() string {
	var b strings.Builder
	fmt.Fprintf(&b, "image %dx%d, region %gx%g at (%g,%g), output scale %g\n", r.Size.Width, r.Size.Height, r.Region.Width, r.Region.Height, r.Region.X, r.Region.Y, r.Scale)
	switch {
	case r.Background.Transparent:
		fmt.Fprintf(&b, "background: transparent (%.0f%% of the border)\n", r.Background.BorderShare*100)
	default:
		fmt.Fprintf(&b, "background: %s (%.0f%% of the border)\n", r.Background.Color, r.Background.BorderShare*100)
	}
	b.WriteString("palette:")
	for _, p := range r.Palette {
		fmt.Fprintf(&b, " %s %.1f%%", p.Color, p.Share*100)
	}
	if r.TransparentShare > 0 {
		fmt.Fprintf(&b, " transparent %.1f%%", r.TransparentShare*100)
	}
	b.WriteString("\n")
	if len(r.Regions) > 0 {
		fmt.Fprintf(&b, "regions: %d (choose the tool per region: photo -> import_image, gradient -> a shape with gradient, flat geometric -> rect/ellipse/path, flat organic -> trace_image, text -> text nodes)\n", len(r.Regions))
		for _, rg := range r.Regions {
			fmt.Fprintf(&b, "  %s %s %.1f%% box %g,%g %gx%g -> %s", rg.ID, rg.Kind, rg.Share*100, rg.Box.X, rg.Box.Y, rg.Box.Width, rg.Box.Height, rg.Suggest)
			if rg.Gradient != nil {
				g, _ := json.Marshal(rg.Gradient)
				fmt.Fprintf(&b, " %s", g)
			}
			if rg.FontSize > 0 {
				fmt.Fprintf(&b, " fontSize ~%g, %d line(s)", rg.FontSize, rg.Lines)
			}
			if len(rg.BlobIDs) > 0 {
				fmt.Fprintf(&b, " blobs %d", len(rg.BlobIDs))
			}
			fmt.Fprintf(&b, ": %s\n", rg.Why)
		}
	}
	shown := len(r.Blobs)
	fmt.Fprintf(&b, "blobs: %d", shown)
	if r.Truncated {
		fmt.Fprintf(&b, " of %d (truncated: raise maxBlobs or minArea)", r.BlobCount)
	}
	b.WriteString(" (largest first: draw in this order, nested shapes land on top)\n")
	for _, bl := range r.Blobs {
		node, _ := json.Marshal(bl.Fit.Node)
		fmt.Fprintf(&b, "  %s %s %.1f%% %s iou %.2f -> %s (%s)", bl.ID, bl.Color, bl.Share*100, bl.Fit.Kind, bl.Fit.IoU, bl.Suggest, bl.Region)
		if bl.Holes > 0 {
			fmt.Fprintf(&b, " holes %d", bl.Holes)
		}
		if bl.Fit.Kind == "freeform" {
			fmt.Fprintf(&b, " (nearest %s %.2f, %d outline points)", bl.Fit.Nearest, bl.Fit.NearestIoU, len(bl.Fit.Outline))
		}
		fmt.Fprintf(&b, " %s\n", node)
	}
	for _, rp := range r.Layout.Repeats {
		fmt.Fprintf(&b, "repeat: %d x %s %s %gx%g [%s]\n", rp.Count, rp.Color, rp.Kind, rp.Width, rp.Height, strings.Join(rp.IDs, " "))
	}
	for _, g := range r.Layout.Grids {
		fmt.Fprintf(&b, "grid: %d rows x %d cols, first center (%g,%g), pitch %gx%g, gap %gx%g [%s]\n", g.Rows, g.Cols, g.Origin.X, g.Origin.Y, g.PitchX, g.PitchY, g.GapX, g.GapY, strings.Join(g.IDs, " "))
	}
	for _, rd := range r.Layout.Radials {
		fmt.Fprintf(&b, "radial: %d around (%g,%g) radius %g, start %g deg, step %g deg", rd.Count, rd.Center.X, rd.Center.Y, rd.Radius, rd.StartAngle, rd.StepAngle)
		if rd.Alignment != "" {
			fmt.Fprintf(&b, ", members %s", rd.Alignment)
		}
		if rd.CenterBlob != "" {
			fmt.Fprintf(&b, ", center blob %s", rd.CenterBlob)
		}
		fmt.Fprintf(&b, " [%s]\n", strings.Join(rd.IDs, " "))
	}
	for _, w := range r.Warnings {
		fmt.Fprintf(&b, "warning: %s\n", w)
	}
	return strings.TrimRight(b.String(), "\n")
}
