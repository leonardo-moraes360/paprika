package core

import (
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/query.ts.

func jsTemplate(v any) string {
	if arr, ok := v.([]any); ok { // `${array}` joins with commas
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

// DescribeNode is one compact line per node.
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
	if fill, ok := n.Get("fill"); ok {
		parts = append(parts, "fill="+jsString(fill))
	}
	if typ == "frame" {
		if l := n.Obj("layout"); l != nil && l.Str("mode") != "none" {
			parts = append(parts, l.Str("mode")+" gap="+jsString(l.Num("gap")))
		}
		if m := n.Str("mode"); m != "" {
			parts = append(parts, "mode="+m)
		}
		if n.Bool("component") {
			parts = append(parts, "component")
		}
		if IsInstance(n) {
			parts = append(parts, "instanceOf="+n.Str("instanceOf"))
			if sc, ok := n.Get("scale"); ok && sc != 1.0 {
				parts = append(parts, "scale="+jsString(sc))
			}
			if ov := n.Obj("overrides"); ov != nil {
				parts = append(parts, "overrides="+jsString(float64(ov.Len())))
			}
		}
	}
	if src, ok := n.Get("sourceId"); ok {
		parts = append(parts, "from="+jsString(src))
	}
	if typ == "text" {
		fs, _ := n.Get("fontSize")
		color, _ := n.Get("color")
		parts = append(parts, jsonv.Quote(truncate(n.Str("text"), 60, 57)), jsString(fs)+"/"+jsString(n.Num("fontWeight")), "color="+jsString(color))
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
			parts = append(parts, "stroke="+st.Str("color")+"/"+jsString(st.Num("width")))
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

// Outline is the indented tree of the document (or of a node), limited by depth (-1 = no limit).
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
	if len(lines) == 0 {
		return "(empty document)"
	}
	return strings.Join(lines, "\n")
}

// NodeQuery filters nodes; empty strings and Limit 0 mean "not set".
type NodeQuery struct {
	Type, Name, Text, Within string
	Limit                    int
}

// QueryNodes searches nodes by type, name or text substring (case-insensitive).
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
		if name != "" && !strings.Contains(strings.ToLower(n.Str("name")), name) {
			continue
		}
		if text != "" && !(n.Str("type") == "text" && strings.Contains(strings.ToLower(n.Str("text")), text)) {
			continue
		}
		out = append(out, n)
		if q.Limit > 0 && len(out) >= q.Limit {
			break
		}
	}
	return out
}

// SubtreeIDs lists a node and its descendants (pre-order).
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
