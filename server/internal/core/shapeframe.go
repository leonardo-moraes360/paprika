package core

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server/internal/zod"
)

func frameOnlyKeys() []string {
	shape := KnownKeys("rect")
	var out []string
	for _, k := range NodeSchemas["frame"].Keys() {
		if !shape[k] && k != "children" && k != "clip" {
			out = append(out, k)
		}
	}
	return out
}

func siblingList(doc *Document, parentID any) []string {
	pid, ok := parentID.(string)
	if !ok {
		return doc.Strings("rootIds")
	}
	p := GetNode(doc, pid)
	if p == nil || !IsContainer(p.Str("type")) {
		return nil
	}
	return p.Strings("children")
}

func parentFlows(doc *Document, parentID any) bool {
	pid, ok := parentID.(string)
	if !ok {
		return false
	}
	p := GetNode(doc, pid)
	if p == nil || p.Str("type") != "frame" {
		return false
	}
	lay := p.Obj("layout")
	return lay != nil && lay.Str("mode") != "none"
}

func showSize(v any) string {
	switch t := v.(type) {
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case string:
		return t
	}
	return fmt.Sprint(v)
}

func frameFromShape(doc *Document, node *Node) (*jsonv.Object, error) {
	id := node.Str("id")
	typ := node.Str("type")
	if typ != "rect" && typ != "ellipse" {
		return nil, fmt.Errorf(`"%s" is %s; only a rect or ellipse can become a frame`, id, typ)
	}
	if owner := CopyOwner(doc, node); owner != nil {
		return nil, fmt.Errorf(`"%s" is a copy inside the instance "%s"; edit the component or detach it`, id, owner.Str("id"))
	}
	if host := InstanceOwner(doc, id); host != nil {
		return nil, fmt.Errorf("%s", inInstance(host.Str("id")))
	}
	next := node.Spread()
	next.Set("type", "frame")
	next.Set("children", []any{})
	next.Set("clip", true)
	if typ == "ellipse" {
		wv, _ := node.Get("width")
		hv, _ := node.Get("height")
		w, wok := wv.(float64)
		h, hok := hv.(float64)
		if !wok || !hok || w != h {
			return nil, fmt.Errorf(`"%s" is an ellipse that is not a circle (width %s, height %s); only a circle has a frame with the same outline, so draw it as a rect with a radius or keep it an ellipse`, id, showSize(wv), showSize(hv))
		}
		next.Set("radius", w/2)
	}
	return next, nil
}

func shapeFromFrame(doc *Document, node *Node, shape string, radius any, hasRadius bool) (*jsonv.Object, error) {
	id := node.Str("id")
	if node.Str("type") != "frame" {
		return nil, fmt.Errorf(`"%s" is %s; convert_to_shape needs a frame`, id, node.Str("type"))
	}
	if owner := CopyOwner(doc, node); owner != nil {
		return nil, fmt.Errorf(`"%s" is a copy inside the instance "%s"; edit the component or detach it`, id, owner.Str("id"))
	}
	var busy []string
	if len(node.Arr("children")) > 0 {
		busy = append(busy, "children")
	}
	if clip, _ := node.Get("clip"); clip != true {
		busy = append(busy, "clip off")
	}
	for _, k := range frameOnlyKeys() {
		if v, ok := node.Get(k); ok && v != nil {
			busy = append(busy, k)
		}
	}
	if len(busy) > 0 {
		return nil, fmt.Errorf(`"%s" has frame content (%s); empty it first, only a plain frame converts back to a %s`, id, strings.Join(busy, ", "), shape)
	}
	next := node.Spread()
	next.Set("type", shape)
	next.Delete("children")
	next.Delete("clip")
	if shape == "ellipse" {
		wv, _ := node.Get("width")
		hv, _ := node.Get("height")
		rv, _ := node.Get("radius")
		w, wok := wv.(float64)
		h, hok := hv.(float64)
		r, rok := rv.(float64)
		if !wok || w != h || !hok || !rok || r != w/2 {
			return nil, fmt.Errorf(`"%s" is not a circle frame (radius half of an equal width and height), so it is not an ellipse`, id)
		}
		if hasRadius {
			next.Set("radius", radius)
		} else {
			next.Set("radius", 0.0)
		}
	} else if hasRadius {
		return nil, fmt.Errorf("radius only restores an ellipse")
	}
	return next, nil
}

func shapeInverse(node *Node) *jsonv.Object {
	op := jsonv.NewObject("op", "convert_to_shape", "id", node.Str("id"), "shape", node.Str("type"))
	if node.Str("type") == "ellipse" {
		if r, ok := node.Get("radius"); ok && r != 0.0 {
			op.Set("radius", r)
		}
	}
	return op
}

func adoptPlan(doc *Document, shape *Node, adopt []string) ([]any, error) {
	if len(adopt) == 0 {
		return nil, nil
	}
	id := shape.Str("id")
	if shape.Num("rotation") != 0 {
		return nil, fmt.Errorf(`"%s" is rotated; adopting content into it would move the content, rotate it back first`, id)
	}
	parent, _ := shape.Get("parentId")
	if parentFlows(doc, parent) {
		return nil, fmt.Errorf(`"%v" has a layout: its children follow the flow, so content cannot be adopted into "%s"`, parent, id)
	}
	siblings := siblingList(doc, parent)
	var unique []string
	for _, a := range adopt {
		if !slices.Contains(unique, a) {
			unique = append(unique, a)
		}
	}
	picked := make([]*Node, 0, len(unique))
	for _, aid := range unique {
		n := GetNode(doc, aid)
		if n == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, aid)
		}
		if aid == id {
			return nil, fmt.Errorf(`"%s" cannot adopt itself`, aid)
		}
		switch n.Str("type") {
		case "page":
			return nil, fmt.Errorf(`"%s" is a page`, aid)
		case "connector":
			return nil, fmt.Errorf(`"%s" is a connector; its position follows its ends`, aid)
		}
		np, _ := n.Get("parentId")
		if np != parent {
			return nil, fmt.Errorf(`"%s" is not a sibling of "%s" (same parent required)`, aid, id)
		}
		if owner := CopyOwner(doc, n); owner != nil {
			return nil, fmt.Errorf(`"%s" is a copy inside the instance "%s"; edit the instance instead`, aid, owner.Str("id"))
		}
		picked = append(picked, n)
	}
	slices.SortStableFunc(picked, func(a, b *Node) int {
		return slices.Index(siblings, a.Str("id")) - slices.Index(siblings, b.Str("id"))
	})
	stroke := 0.0
	if s := shape.Obj("stroke"); s != nil {
		pos := s.Str("position")
		if pos == "" || pos == "inside" {
			sw, _ := s.Get("width")
			stroke, _ = ResolveLength(doc, sw, ModeOf(doc, shape))
		}
	}
	var ops []any
	for _, n := range picked {
		ops = append(ops,
			jsonv.NewObject("op", "move", "id", n.Str("id"), "parentId", id),
			jsonv.NewObject("op", "update", "id", n.Str("id"), "props", jsonv.NewObject(
				"x", Round4(n.Num("x")-shape.Num("x")-stroke),
				"y", Round4(n.Num("y")-shape.Num("y")-stroke),
			)),
		)
	}
	return ops, nil
}

func convertToFrame(doc *Document, op *jsonv.Object, i int, created *[]string) (any, error) {
	id := op.Str("id")
	node := GetNode(doc, id)
	if node == nil {
		return nil, opErr(i, `node "%s" does not exist`, id)
	}
	next, err := frameFromShape(doc, node)
	if err != nil {
		return nil, opErr(i, "%s", err.Error())
	}
	plan, err := adoptPlan(doc, node, op.Strings("adopt"))
	if err != nil {
		return nil, opErr(i, "%s", err.Error())
	}
	parsed, perr := z.Parse(NodeSchema, next)
	if perr != nil {
		return nil, opErr(i, `invalid conversion of "%s": %s`, id, formatZod(perr))
	}
	inverse := []any{shapeInverse(node)}
	Nodes(doc).Set(id, parsed)
	for _, sub := range plan {
		subOp, serr := z.Parse(OpSchema, sub)
		if serr != nil {
			return nil, opErr(i, "invalid operation: %s", formatZod(serr))
		}
		inv, aerr := applyOne(doc, subOp.(*jsonv.Object), i, created)
		if aerr != nil {
			return nil, aerr
		}
		inverse = append(flatten(inv), inverse...)
	}
	return inverse, nil
}

func convertToShape(doc *Document, op *jsonv.Object, i int) (any, error) {
	id := op.Str("id")
	node := GetNode(doc, id)
	if node == nil {
		return nil, opErr(i, `node "%s" does not exist`, id)
	}
	radius, hasRadius := op.Get("radius")
	next, err := shapeFromFrame(doc, node, op.Str("shape"), radius, hasRadius)
	if err != nil {
		return nil, opErr(i, "%s", err.Error())
	}
	parsed, perr := z.Parse(NodeSchema, next)
	if perr != nil {
		return nil, opErr(i, `invalid conversion of "%s": %s`, id, formatZod(perr))
	}
	Nodes(doc).Set(id, parsed)
	return jsonv.NewObject("op", "convert_to_frame", "id", id), nil
}
