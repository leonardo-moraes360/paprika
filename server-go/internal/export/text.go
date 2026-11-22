package export

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"golang.org/x/image/font"
	"golang.org/x/image/math/fixed"
)

func paintText(doc *core.Document, rootID string, dst *image.RGBA, scale float64) error {
	if err := loadFonts(); err != nil {
		return fmt.Errorf("text fonts: %w", err)
	}
	measure, err := core.MeasureFromLayout(doc, rootID)
	if err != nil {
		return err
	}
	var walk func(id string) error
	walk = func(id string) error {
		n := core.GetNode(doc, id)
		if n == nil || !n.Bool("visible") {
			return nil
		}
		typ := n.Str("type")
		if typ == "text" || (typ == "shape" && n.Str("text") != "") {
			if err := drawTextNode(doc, n, measure, dst, scale); err != nil {
				return err
			}
		}
		if core.IsContainer(typ) {
			for _, c := range n.Strings("children") {
				if err := walk(c); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if rootID != "" {
		return walk(rootID)
	}
	page := core.FirstPage(doc)
	if page != nil {
		return walk(page.Str("id"))
	}
	for _, id := range doc.Strings("rootIds") {
		if err := walk(id); err != nil {
			return err
		}
	}
	return nil
}

func drawTextNode(doc *core.Document, n *core.Node, measure core.Measure, dst *image.RGBA, scale float64) error {
	box, ok := measure.Boxes[n.Str("id")]
	if !ok {
		return nil
	}
	mode := core.ModeOf(doc, n)
	fsv, _ := n.Get("fontSize")
	fs := core.ResolveValue(doc, fsv, mode)
	size, isNum := fs.(float64)
	if !isNum {
		size = jsonv.ParseFloat(fmt.Sprint(fs))
		if math.IsNaN(size) || size == 0 {
			size = 16
		}
	}
	weight := 400
	if fw, ok := n.Get("fontWeight"); ok {
		switch v := fw.(type) {
		case float64:
			weight = int(v)
		default:
			weight = int(jsonv.ParseFloat(fmt.Sprint(v)))
		}
	}
	colorV, _ := n.Get("color")
	col, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, colorV, mode)))
	if !ok {
		col = core.RGBA{R: 0, G: 0, B: 0, A: 1}
	}
	face, err := faceFor(weight, size*scale)
	if err != nil {
		return err
	}

	src := image.NewUniform(toColor(col))
	d := &font.Drawer{Dst: dst, Src: src, Face: face}
	lh := n.Num("lineHeight")
	if lh == 0 {
		lh = 1.4
	}
	lineH := lh * size * scale
	ox, oy := box[0]*scale, box[1]*scale
	w, h := box[2]*scale, box[3]*scale

	lines := []string{}
	if measure.Lines != nil {
		if ls, ok := measure.Lines[n.Str("id")]; ok {
			for _, l := range ls {
				d.Dot = fixed.P(int(math.Round(ox+l.X*scale)), int(math.Round(oy+l.Y*scale)))
				d.DrawString(l.T)
			}
			return nil
		}
	}
	text := n.Str("text")
	if text == "" {
		return nil
	}
	lines = strings.Split(text, "\n")
	align := n.Str("textAlign")
	if align == "" {
		align = "left"
	}
	top := (h - float64(len(lines))*lineH) / 2
	if n.Str("type") == "shape" && n.Str("shape") == "note" {
		pv, _ := core.ShapePadding(n)
		top = pv * scale
	} else if n.Str("type") == "text" {
		top = 0
	}
	for k, line := range lines {
		if line == "" {
			continue
		}
		adv := font.MeasureString(face, line)
		tw := float64(adv) / 64
		ax := 0.0
		switch align {
		case "center":
			ax = (w - tw) / 2
		case "right":
			ax = w - tw
		}
		baseline := top + float64(k)*lineH + (lineH-size*scale)/2 + size*scale*0.8
		d.Dot = fixed.P(int(math.Round(ox+ax)), int(math.Round(oy+baseline)))
		d.DrawString(line)
	}
	return nil
}

func toColor(c core.RGBA) color.RGBA {
	return color.RGBA{
		R: uint8(math.Min(255, math.Max(0, c.R))),
		G: uint8(math.Min(255, math.Max(0, c.G))),
		B: uint8(math.Min(255, math.Max(0, c.B))),
		A: uint8(math.Min(255, math.Max(0, c.A*255+0.5))),
	}
}
