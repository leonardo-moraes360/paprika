package core

import (
	"fmt"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func jsTemplate(v any) string {
	if arr, ok := v.([]any); ok {
		parts := make([]string, len(arr))
		for i, x := range arr {
			parts[i] = jsString(x)
		}
		return strings.Join(parts, ",")
	}
	return jsString(v)
}

func truncate(s string, max, keep int) string {
	if jsonv.Len16(s) > max {
		return jsonv.Slice16(s, keep) + "..."
	}
	return s
}

func DescribeNode(n *Node) string {
	typ := n.Str("type")
	parts := []string{typ + "#" + n.Str("id")}
	if name := n.Str("name"); name != "" {
		parts = append(parts, jsonv.Quote(name))
	}
	if typ == "page" {
		if fill, ok := n.Get("fill"); ok {
			parts = append(parts, "fill="+jsString(fill))
		}
		if m := n.Str("mode"); m != "" {
			parts = append(parts, "mode="+m)
		}
		return strings.Join(parts, " ")
	}
	w, _ := n.Get("width")
	h, _ := n.Get("height")
	parts = append(parts, jsString(w)+"×"+jsString(h), "@"+jsString(n.Num("x"))+","+jsString(n.Num("y")))
	if g := nodeGradient(n); g != nil {
		parts = append(parts, "gradient="+g.Str("type"))
	}
	if fill, ok := n.Get("fill"); ok {
		parts = append(parts, "fill="+jsString(fill))
	}
	if typ == "frame" {
		if l := n.Obj("layout"); l != nil && l.Str("mode") != "none" {
			g, _ := l.Get("gap")
			parts = append(parts, l.Str("mode")+" gap="+jsString(g))
		}
		if m := n.Str("mode"); m != "" {
			parts = append(parts, "mode="+m)
		}
		if n.Bool("component") {
			parts = append(parts, "component")
		}
		if props := n.Arr("componentProps"); len(props) > 0 {
			parts = append(parts, fmt.Sprintf("props=%d", len(props)))
		}
		if IsInstance(n) {
			parts = append(parts, "instanceOf="+n.Str("instanceOf"))
			if sc, ok := n.Get("scale"); ok && sc != 1.0 {
				parts = append(parts, "scale="+jsString(sc))
			}
			if ov := n.Obj("overrides"); ov != nil {
				parts = append(parts, "overrides="+jsString(float64(ov.Len())))
			}
			if pv := n.Obj("propValues"); pv != nil {
				parts = append(parts, fmt.Sprintf("propValues=%d", pv.Len()))
			}
			if sl := n.Obj("slots"); sl != nil {
				parts = append(parts, fmt.Sprintf("slots=%d", sl.Len()))
			}
		}
	}
	if slot := n.Str("slot"); slot != "" {
		parts = append(parts, "slot="+slot)
	}
	if src, ok := n.Get("sourceId"); ok {
		parts = append(parts, "from="+jsString(src))
	}
	if typ == "text" {
		fs, _ := n.Get("fontSize")
		color, _ := n.Get("color")
		parts = append(parts, jsonv.Quote(truncate(n.Str("text"), 60, 57)), jsString(fs)+"/"+jsString(n.Num("fontWeight")), "color="+jsString(color))
		if runs := n.Arr("runs"); len(runs) > 0 {
			parts = append(parts, fmt.Sprintf("runs=%d", len(runs)))
		}
	}
	if typ == "shape" {
		parts = append(parts, n.Str("shape"), jsonv.Quote(truncate(n.Str("text"), 60, 57)))
	}
	if typ == "connector" {
		end := func(e *jsonv.Object) string {
			if id, ok := e.Get("nodeId"); ok {
				out := jsString(id)
				if side := e.Str("side"); side != "" && side != "auto" {
					out += "." + side
				}
				return out
			}
			coord := func(k string) string {
				if v, ok := e.Get(k); ok {
					return jsString(v)
				}
				return "?"
			}
			return "(" + coord("x") + "," + coord("y") + ")"
		}
		parts = append(parts, end(n.Obj("from"))+"->"+end(n.Obj("to")), n.Str("route"))
		if n.Str("startArrow") != "none" || n.Str("endArrow") != "arrow" {
			parts = append(parts, "arrows="+n.Str("startArrow")+"/"+n.Str("endArrow"))
		}
		if n.Bool("dashed") {
			parts = append(parts, "dashed")
		}
		if l := n.Str("label"); l != "" {
			parts = append(parts, "label="+jsonv.Quote(l))
		}
	}
	if typ == "image" {
		src := n.Str("src")
		if strings.HasPrefix(src, "data:") {
			src = "data:…"
		}
		parts = append(parts, "src="+src)
	}
	if typ == "path" {
		parts = append(parts, "d="+jsonv.Quote(truncate(n.Str("d"), 48, 45)))
		if st := n.Obj("stroke"); st != nil {
			w, _ := st.Get("width")
			parts = append(parts, "stroke="+st.Str("color")+"/"+jsString(w))
		}
		if vb, ok := n.Get("viewBox"); ok {
			parts = append(parts, "viewBox="+jsTemplate(vb))
		}
	}
	if !n.Bool("visible") {
		parts = append(parts, "hidden")
	}
	if n.Bool("locked") {
		parts = append(parts, "locked")
	}
	return strings.Join(parts, " ")
}

func Outline(doc *Document, rootID string, depth int) string {
	var lines []string
	var walk func(id string, d int)
	walk = func(id string, d int) {
		n := GetNode(doc, id)
		if n == nil {
			return
		}
		lines = append(lines, strings.Repeat("  ", d)+DescribeNode(n))
		if IsContainer(n.Str("type")) {
			children := n.Strings("children")
			if depth >= 0 && d+1 > depth {
				if len(children) > 0 {
					lines = append(lines, strings.Repeat("  ", d+1)+"… "+jsString(float64(len(children)))+" filho(s)")
				}
				return
			}
			for _, c := range children {
				walk(c, d+1)
			}
		}
	}
	roots := doc.Strings("rootIds")
	if rootID != "" {
		roots = []string{rootID}
	}
	for _, r := range roots {
		walk(r, 0)
	}
	body := "(empty document)"
	if len(lines) > 0 {
		body = strings.Join(lines, "\n")
	}
	return body + "\n" + PlacementFooter(doc, rootID)
}

type NodeQuery struct {
	Type, Name, Text, Within string
	Exact                    bool
	Limit                    int
}

func QueryNodes(doc *Document, q NodeQuery) []*Node {
	name := strings.ToLower(q.Name)
	text := strings.ToLower(q.Text)
	pool := Nodes(doc).Keys()
	if q.Within != "" {
		pool = SubtreeIDs(doc, q.Within)
	}
	var out []*Node
	for _, id := range pool {
		n := GetNode(doc, id)
		if n == nil {
			continue
		}
		if q.Type != "" && n.Str("type") != q.Type {
			continue
		}
		if q.Exact && q.Name != "" {
			if n.Str("name") != q.Name {
				continue
			}
		} else if name != "" && !strings.Contains(strings.ToLower(n.Str("name")), name) {
			continue
		}
		if text != "" && !((n.Str("type") == "text" || n.Str("type") == "shape") && strings.Contains(strings.ToLower(n.Str("text")), text)) {
			continue
		}
		out = append(out, n)
		if q.Limit > 0 && len(out) >= q.Limit {
			break
		}
	}
	return out
}

func SubtreeIDs(doc *Document, rootID string) []string {
	var out []string
	var walk func(string)
	walk = func(id string) {
		n := GetNode(doc, id)
		if n == nil {
			return
		}
		out = append(out, id)
		if IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				walk(c)
			}
		}
	}
	walk(rootID)
	return out
}
