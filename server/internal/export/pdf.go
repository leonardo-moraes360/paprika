package export

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"unicode/utf16"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/phpdave11/gofpdf"
)

func WritePDF(doc *core.Document, rootID string, scale float64) (Result, error) {
	svg, err := core.ExportSVG(doc, rootID, nil)
	if err != nil {
		return Result{}, err
	}
	w := svg.Width * scale
	h := svg.Height * scale
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	pdf := gofpdf.NewCustom(&gofpdf.InitType{
		UnitStr: "pt",
		Size:    gofpdf.SizeType{Wd: w, Ht: h},
	})
	pdf.SetMargins(0, 0, 0)
	pdf.SetAutoPageBreak(false, 0)
	reg, err := registerPDFFonts(pdf)
	if err != nil {
		return Result{}, err
	}
	pdf.AddPage()
	measure, err := core.MeasureFromLayout(doc, rootID)
	if err != nil {
		return Result{}, err
	}
	warnings := append([]string{}, svg.Warnings...)
	if err := paintPDF(doc, rootID, pdf, measure, scale, reg); err != nil {
		return Result{}, err
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return Result{}, err
	}
	return Result{
		Data:     buf.Bytes(),
		Mime:     "application/pdf",
		Width:    int(math.Round(w)),
		Height:   int(math.Round(h)),
		Format:   FormatPDF,
		Warnings: warnings,
	}, nil
}

type pdfFonts struct {
	regular, semibold, bold string
}

func registerPDFFonts(pdf *gofpdf.Fpdf) (pdfFonts, error) {
	out := pdfFonts{regular: "Inter", semibold: "Inter", bold: "Inter"}
	for _, w := range []struct {
		weight int
		style  string
		name   *string
	}{
		{400, "", &out.regular},
		{600, "S", &out.semibold},
		{700, "B", &out.bold},
	} {
		raw, err := fontBytes(w.weight)
		if err != nil {
			return out, err
		}
		name := "Inter" + w.style
		pdf.AddUTF8FontFromBytes(name, "", raw)
		*w.name = name
	}
	return out, nil
}

func paintPDF(doc *core.Document, rootID string, pdf *gofpdf.Fpdf, measure core.Measure, scale float64, fonts pdfFonts) error {
	var walk func(id string, clip *[4]float64) error
	walk = func(id string, clip *[4]float64) error {
		n := core.GetNode(doc, id)
		if n == nil || !n.Bool("visible") {
			return nil
		}
		box, ok := measure.Boxes[n.Str("id")]
		if !ok && n.Str("type") != "page" {
			return nil
		}
		typ := n.Str("type")
		switch typ {
		case "page":
			for _, c := range n.Strings("children") {
				if err := walk(c, clip); err != nil {
					return err
				}
			}
			return nil
		case "group":
			for _, c := range n.Strings("children") {
				if err := walk(c, clip); err != nil {
					return err
				}
			}
			return nil
		case "frame", "rect":
			drawPDFRect(doc, n, pdf, box, scale)
		case "ellipse":
			drawPDFEllipse(doc, n, pdf, box, scale)
		case "path":
			drawPDFPath(doc, n, pdf, box, scale)
		case "text", "shape":
			if typ == "shape" {
				drawPDFShape(doc, n, pdf, box, scale)
			}
			drawPDFText(doc, n, pdf, measure, box, scale, fonts)
		case "image":
		case "connector":
			drawPDFPath(doc, n, pdf, box, scale)
		}
		if typ == "frame" && core.IsContainer(typ) {
			var nextClip *[4]float64
			if n.Bool("clip") {
				b := [4]float64{box[0] * scale, box[1] * scale, box[2] * scale, box[3] * scale}
				nextClip = &b
				pdf.ClipRect(b[0], b[1], b[2], b[3], false)
			}
			for _, c := range n.Strings("children") {
				if err := walk(c, nextClip); err != nil {
					return err
				}
			}
			if nextClip != nil {
				pdf.ClipEnd()
			}
		}
		return nil
	}
	if rootID != "" {
		return walk(rootID, nil)
	}
	if page := core.FirstPage(doc); page != nil {
		return walk(page.Str("id"), nil)
	}
	for _, id := range doc.Strings("rootIds") {
		if err := walk(id, nil); err != nil {
			return err
		}
	}
	return nil
}

func pdfFillStroke(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf) (fill bool, stroke bool, sw float64) {
	mode := core.ModeOf(doc, n)
	if v, ok := n.Get("fill"); ok && v != nil && fmt.Sprint(v) != "" && fmt.Sprint(v) != "none" {
		if c, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, v, mode))); ok && c.A > 0 {
			pdf.SetFillColor(int(c.R), int(c.G), int(c.B))
			fill = true
		}
	}
	if st := n.Obj("stroke"); st != nil && st.Num("width") > 0 {
		sc, _ := st.Get("color")
		if c, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, sc, mode))); ok && c.A > 0 {
			pdf.SetDrawColor(int(c.R), int(c.G), int(c.B))
			sw = st.Num("width")
			pdf.SetLineWidth(sw)
			stroke = true
		}
	}
	return
}

func drawPDFRect(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, box [4]float64, scale float64) {
	fill, stroke, _ := pdfFillStroke(doc, n, pdf)
	if !fill && !stroke {
		return
	}
	x, y, w, h := box[0]*scale, box[1]*scale, box[2]*scale, box[3]*scale
	r := math.Min(n.Num("radius")*scale, math.Min(w/2, h/2))
	style := ""
	if fill {
		style += "F"
	}
	if stroke {
		style += "D"
	}
	if r > 0 {
		pdf.RoundedRect(x, y, w, h, r, "1234", style)
	} else {
		pdf.Rect(x, y, w, h, style)
	}
}

func drawPDFEllipse(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, box [4]float64, scale float64) {
	fill, stroke, _ := pdfFillStroke(doc, n, pdf)
	if !fill && !stroke {
		return
	}
	x, y, w, h := box[0]*scale, box[1]*scale, box[2]*scale, box[3]*scale
	style := ""
	if fill {
		style += "F"
	}
	if stroke {
		style += "D"
	}
	pdf.Ellipse(x+w/2, y+h/2, w/2, h/2, 0, style)
}

func drawPDFShape(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, box [4]float64, scale float64) {
	switch n.Str("shape") {
	case "ellipse":
		drawPDFEllipse(doc, n, pdf, box, scale)
	default:
		drawPDFRect(doc, n, pdf, box, scale)
	}
}

func drawPDFPath(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, box [4]float64, scale float64) {
	d := n.Str("d")
	if d == "" {
		return
	}
	fill, stroke, _ := pdfFillStroke(doc, n, pdf)
	if n.Str("type") == "path" {
		if v, ok := n.Get("fill"); ok && fmt.Sprint(v) != "" && fmt.Sprint(v) != "none" {
			mode := core.ModeOf(doc, n)
			if c, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, v, mode))); ok && c.A > 0 {
				pdf.SetFillColor(int(c.R), int(c.G), int(c.B))
				fill = true
			}
		}
	}
	ox, oy := box[0]*scale, box[1]*scale
	style := ""
	if fill {
		style += "F"
	}
	if stroke {
		style += "D"
	}
	if style == "" {
		return
	}
	pdf.SetLineCapStyle("round")
	pdf.SetLineJoinStyle("round")
	writeSVGPath(pdf, d, ox, oy, scale, style)
}

func writeSVGPath(pdf *gofpdf.Fpdf, d string, ox, oy, scale float64, style string) {
	tokens := tokenizePath(d)
	i := 0
	var cx, cy, sx, sy float64
	cmd := ' '
	for i < len(tokens) {
		t := tokens[i]
		if len(t) == 1 && strings.ContainsAny(t, "MmLlHhVvCcSsQqTtAaZz") {
			cmd = rune(t[0])
			i++
			continue
		}
		num := func() float64 {
			if i >= len(tokens) {
				return 0
			}
			v := jsonv.ParseFloat(tokens[i])
			i++
			return v
		}
		rel := cmd >= 'a' && cmd <= 'z'
		switch cmd {
		case 'M', 'm':
			x, y := num()*scale, num()*scale
			if rel {
				x += cx
				y += cy
			}
			cx, cy, sx, sy = x, y, x, y
			pdf.MoveTo(ox+cx, oy+cy)
			cmd = 'L'
			if rel {
				cmd = 'l'
			}
		case 'L', 'l':
			x, y := num()*scale, num()*scale
			if rel {
				x += cx
				y += cy
			}
			cx, cy = x, y
			pdf.LineTo(ox+cx, oy+cy)
		case 'H', 'h':
			x := num() * scale
			if rel {
				x += cx
			}
			cx = x
			pdf.LineTo(ox+cx, oy+cy)
		case 'V', 'v':
			y := num() * scale
			if rel {
				y += cy
			}
			cy = y
			pdf.LineTo(ox+cx, oy+cy)
		case 'C', 'c':
			x1, y1 := num()*scale, num()*scale
			x2, y2 := num()*scale, num()*scale
			x, y := num()*scale, num()*scale
			if rel {
				x1 += cx
				y1 += cy
				x2 += cx
				y2 += cy
				x += cx
				y += cy
			}
			pdf.CurveBezierCubicTo(ox+x1, oy+y1, ox+x2, oy+y2, ox+x, oy+y)
			cx, cy = x, y
		case 'Z', 'z':
			pdf.LineTo(ox+sx, oy+sy)
			cx, cy = sx, sy
		default:
			i++
		}
	}
	pdf.DrawPath(style)
}

func tokenizePath(d string) []string {
	d = strings.ReplaceAll(d, ",", " ")
	var out []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range d {
		switch {
		case r == '-' || r == '+' || r == '.' || (r >= '0' && r <= '9') || r == 'e' || r == 'E':
			if (r == '-' || r == '+') && cur.Len() > 0 {
				prev := cur.String()
				last := prev[len(prev)-1]
				if last != 'e' && last != 'E' {
					flush()
				}
			}
			cur.WriteRune(r)
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
			flush()
			out = append(out, string(r))
		default:
			flush()
		}
	}
	flush()
	return out
}

func drawPDFText(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, measure core.Measure, box [4]float64, scale float64, fonts pdfFonts) {
	text := n.Str("text")
	if text == "" {
		return
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
	fname := fonts.regular
	switch {
	case weight >= 650:
		fname = fonts.bold
	case weight >= 500:
		fname = fonts.semibold
	}
	colorV, _ := n.Get("color")
	col, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, colorV, mode)))
	if !ok {
		col = core.RGBA{R: 0, G: 0, B: 0, A: 1}
	}
	pdf.SetTextColor(int(col.R), int(col.G), int(col.B))
	pdf.SetFont(fname, "", size*scale)
	lh := n.Num("lineHeight")
	if lh == 0 {
		lh = 1.4
	}
	lineH := lh * size * scale
	ox, oy := box[0]*scale, box[1]*scale
	w, h := box[2]*scale, box[3]*scale
	lines := strings.Split(text, "\n")
	align := n.Str("textAlign")
	if align == "" {
		align = "left"
	}
	top := (h - float64(len(lines))*lineH) / 2
	if n.Str("type") == "text" {
		top = 0
	}
	if n.Str("type") == "text" && len(n.Arr("runs")) > 0 {
		drawPDFRich(doc, n, pdf, fonts, text, ox, oy, w, size, weight, col, lh, scale, align)
		return
	}
	for k, line := range lines {
		if line == "" {
			continue
		}
		tw := pdf.GetStringWidth(line)
		ax := 0.0
		switch align {
		case "center":
			ax = (w - tw) / 2
		case "right":
			ax = w - tw
		}
		baseline := top + float64(k)*lineH + (lineH-size*scale)/2 + size*scale*0.8
		pdf.Text(ox+ax, oy+baseline, line)
	}
}

func pdfFace(fonts pdfFonts, weight int) string {
	switch {
	case weight >= 650:
		return fonts.bold
	case weight >= 500:
		return fonts.semibold
	default:
		return fonts.regular
	}
}

func drawPDFRich(doc *core.Document, n *core.Node, pdf *gofpdf.Fpdf, fonts pdfFonts, text string, ox, oy, w, baseSize float64, baseWeight int, base core.RGBA, lineHeight, scale float64, align string) {
	mode := core.ModeOf(doc, n)
	abs := 0
	top := 0.0
	for line := range strings.SplitSeq(text, "\n") {
		units := len(utf16.Encode([]rune(line)))
		sizeL := baseSize
		for _, item := range n.Arr("runs") {
			o, ok := item.(*jsonv.Object)
			if !ok {
				continue
			}
			fs, ok := o.Get("fontSize")
			if !ok || int(o.Num("end")) <= abs || int(o.Num("start")) >= abs+units {
				continue
			}
			if s := resolvedExportSize(doc, fs, mode, baseSize); s > sizeL {
				sizeL = s
			}
		}
		lineH := lineHeight * sizeL * scale
		if line != "" {
			pieces := core.PiecesInRange(line, abs, n.Arr("runs"))
			widths := make([]float64, len(pieces))
			total := 0.0
			for i, p := range pieces {
				sz, wt := baseSize, baseWeight
				if p.Run != nil {
					if fs, ok := p.Run.Get("fontSize"); ok {
						sz = resolvedExportSize(doc, fs, mode, baseSize)
					}
					if fw, ok := p.Run.Get("fontWeight"); ok {
						if f, ok := fw.(float64); ok {
							wt = int(f)
						}
					}
				}
				pdf.SetFont(pdfFace(fonts, wt), "", sz*scale)
				widths[i] = pdf.GetStringWidth(p.Text)
				total += widths[i]
			}
			ax := 0.0
			switch align {
			case "center":
				ax = (w - total) / 2
			case "right":
				ax = w - total
			}
			x := ox + ax
			baseline := oy + top + (lineH-sizeL*scale)/2 + sizeL*scale*0.8
			for i, p := range pieces {
				sz, wt, colr := baseSize, baseWeight, base
				if p.Run != nil {
					if fs, ok := p.Run.Get("fontSize"); ok {
						sz = resolvedExportSize(doc, fs, mode, baseSize)
					}
					if fw, ok := p.Run.Get("fontWeight"); ok {
						if f, ok := fw.(float64); ok {
							wt = int(f)
						}
					}
					if c, ok := p.Run.Get("color"); ok {
						if parsed, ok := core.ParseColor(fmt.Sprint(core.ResolveValue(doc, c, mode))); ok {
							colr = parsed
						}
					}
				}
				pdf.SetTextColor(int(colr.R), int(colr.G), int(colr.B))
				pdf.SetFont(pdfFace(fonts, wt), "", sz*scale)
				pdf.Text(x, baseline, p.Text)
				x += widths[i]
			}
		}
		top += lineH
		abs += units + 1
	}
}
