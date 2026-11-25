package core

import (
	"fmt"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func ellipseD(w, h float64) string {
	rx, ry := w/2, h/2
	return fmt.Sprintf("M%s 0 A%s %s 0 0 1 %s %s A%s %s 0 0 1 %s 0 Z", r2(rx), r2(rx), r2(ry), r2(rx), r2(h), r2(rx), r2(ry), r2(rx))
}

func outlineD(doc *Document, n *Node) string {
	w, h := n.Num("width"), n.Num("height")
	if n.Str("type") == "ellipse" {
		return ellipseD(w, h)
	}
	radius, _ := n.Get("radius")
	return roundedRectD(0, 0, w, h, UsedCornerRadii(w, h, ResolveCorners(doc, radius, ModeOf(doc, n))), r2)
}

func siblingIndex(doc *Document, n *Node) int {
	id := n.Str("id")
	var list []string
	if pid, ok := ParentID(n); !ok || pid == "" {
		list = doc.Strings("rootIds")
	} else if p := GetNode(doc, pid); p != nil {
		list = p.Strings("children")
	}
	for i, s := range list {
		if s == id {
			return i
		}
	}
	return 0
}

func ConvertToPathOps(doc *Document, ids []string) ([]any, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("convert_to_path needs at least one id")
	}
	if len(ids) > 500 {
		return nil, fmt.Errorf("convert_to_path accepts at most 500 ids")
	}
	var unique []string
	seen := map[string]bool{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	var missing []string
	for _, id := range unique {
		if GetNode(doc, id) == nil {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("nodes do not exist: %s", joinComma(missing))
	}
	var ops []any
	for _, id := range unique {
		n := GetNode(doc, id)
		typ := n.Str("type")
		if typ != "rect" && typ != "ellipse" {
			return nil, fmt.Errorf("%q is %s; convert_to_path only accepts rect or ellipse", id, typ)
		}
		if owner := CopyOwner(doc, n); owner != nil {
			return nil, fmt.Errorf("%q is a copy inside the instance %q; edit the component or detach it", id, owner.Str("id"))
		}
		wv, _ := n.Get("width")
		hv, _ := n.Get("height")
		if _, ok := wv.(float64); !ok {
			return nil, fmt.Errorf("%q needs a numeric width and height", id)
		}
		if _, ok := hv.(float64); !ok {
			return nil, fmt.Errorf("%q needs a numeric width and height", id)
		}
		node := jsonv.NewObject(
			"type", "path",
			"id", id,
			"x", n.Num("x"),
			"y", n.Num("y"),
			"width", n.Num("width"),
			"height", n.Num("height"),
			"d", outlineD(doc, n),
		)
		if n.Str("name") != "" {
			node.Set("name", n.Str("name"))
		}
		if n.Num("rotation") != 0 {
			node.Set("rotation", n.Num("rotation"))
		}
		if n.Num("opacity") != 1 {
			node.Set("opacity", n.Num("opacity"))
		}
		if !n.Bool("visible") {
			node.Set("visible", false)
		}
		if n.Bool("locked") {
			node.Set("locked", true)
		}
		if v, ok := n.Get("layoutPositioning"); ok {
			node.Set("layoutPositioning", v)
		}
		if v, ok := n.Get("constraints"); ok {
			node.Set("constraints", v)
		}
		if v, ok := n.Get("fill"); ok {
			node.Set("fill", v)
		}
		if g := n.Obj("gradient"); g != nil {
			node.Set("gradient", g)
		}
		if s := n.Obj("stroke"); s != nil {
			node.Set("stroke", s)
		}
		if s := n.Obj("shadow"); s != nil {
			node.Set("shadow", s)
		}
		if o := n.Obj("outline"); o != nil {
			node.Set("outline", o)
		}
		if f := n.Obj("filter"); f != nil {
			node.Set("filter", f)
		}
		if f := n.Obj("backdropFilter"); f != nil {
			node.Set("backdropFilter", f)
		}
		if n.Str("notes") != "" {
			node.Set("notes", n.Str("notes"))
		}
		if v, ok := n.Get("lintIgnore"); ok {
			node.Set("lintIgnore", v)
		}
		var parent any
		if pid, ok := ParentID(n); ok && pid != "" {
			parent = pid
		}
		ops = append(ops,
			jsonv.NewObject("op", "delete", "id", id),
			jsonv.NewObject("op", "create", "parentId", parent, "index", float64(siblingIndex(doc, n)), "node", node),
		)
	}
	return ops, nil
}

func joinComma(ids []string) string {
	var b strings.Builder
	for i, id := range ids {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(id)
	}
	return b.String()
}
