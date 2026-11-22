package core

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/structure.ts: composite operations (groups and pages) that only
// generate primitive ops; ApplyOps applies them atomically.

func siblingsOf(doc *Document, parentID any) []string {
	pid, ok := parentID.(string)
	if !ok {
		return doc.Strings("rootIds")
	}
	if p := GetNode(doc, pid); p != nil && IsContainer(p.Str("type")) {
		return p.Strings("children")
	}
	return nil
}

func indexOf(list []string, id string) int {
	for i, v := range list {
		if v == id {
			return i
		}
	}
	return -1
}

func placeName(parentID any) string {
	if s, ok := parentID.(string); ok {
		return s
	}
	return "canvas"
}

// GroupOps puts sibling nodes in a new group, above the topmost of them. The order between
// them is kept and the drawing does not move. id/name "" mean generated.
func GroupOps(doc *Document, ids []string, id, name string) ([]any, string, error) {
	if len(ids) == 0 {
		return nil, "", errors.New("pass at least one id to group")
	}
	var unique []string
	seen := map[string]bool{}
	for _, v := range ids {
		if !seen[v] {
			seen[v] = true
			unique = append(unique, v)
		}
	}
	var missing []string
	for _, v := range unique {
		if GetNode(doc, v) == nil {
			missing = append(missing, v)
		}
	}
	if len(missing) > 0 {
		return nil, "", fmt.Errorf("nodes do not exist: %s", strings.Join(missing, ", "))
	}
	for _, v := range unique {
		if GetNode(doc, v).Str("type") == "page" {
			return nil, "", fmt.Errorf(`"%s" is a page; pages cannot be grouped`, v)
		}
	}
	first := GetNode(doc, unique[0])
	parentID, _ := first.Get("parentId")
	for _, v := range unique {
		if p, _ := GetNode(doc, v).Get("parentId"); p != parentID {
			return nil, "", fmt.Errorf(`only nodes with the same parent can be grouped ("%s" is in %s, "%s" in %s)`, v, placeName(p), unique[0], placeName(parentID))
		}
	}
	if pid, ok := parentID.(string); ok {
		if p := GetNode(doc, pid); p != nil && p.Str("type") == "frame" {
			if l := p.Obj("layout"); l != nil && l.Str("mode") != "none" {
				return nil, "", fmt.Errorf(`"%s" has layout %s: its children follow the flow and cannot be grouped; set the layout to none or use a frame`, pid, l.Str("mode"))
			}
		}
	}
	siblings := siblingsOf(doc, parentID)
	ordered := append([]string(nil), unique...)
	sort.SliceStable(ordered, func(a, b int) bool { return indexOf(siblings, ordered[a]) < indexOf(siblings, ordered[b]) })
	top := indexOf(siblings, ordered[len(ordered)-1])
	if id == "" {
		id = NewID()
	}
	if name == "" {
		groups := 0
		for _, k := range Nodes(doc).Keys() {
			if GetNode(doc, k).Str("type") == "group" {
				groups++
			}
		}
		name = "Grupo " + jsonv.FormatNumber(float64(groups+1))
	}
	ops := []any{jsonv.NewObject("op", "create", "parentId", parentID, "index", float64(top+1), "node", jsonv.NewObject("type", "group", "id", id, "name", name))}
	for _, nid := range ordered {
		ops = append(ops, jsonv.NewObject("op", "move", "id", nid, "parentId", id))
	}
	return ops, id, nil
}

// UngroupOps dissolves groups: children go back to the group's parent, in its place, with the
// group's position, opacity and visibility applied. Returns the ops and the released ids.
func UngroupOps(doc *Document, ids []string) ([]any, []string, error) {
	if len(ids) == 0 {
		return nil, nil, errors.New("pass at least one group id")
	}
	ops := []any{}
	released := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		g := GetNode(doc, id)
		if g == nil {
			return nil, nil, fmt.Errorf(`node "%s" does not exist`, id)
		}
		if t := g.Str("type"); t != "group" {
			return nil, nil, fmt.Errorf(`node "%s" is %s, not a group`, id, t)
		}
		parentID, _ := g.Get("parentId")
		index := indexOf(siblingsOf(doc, parentID), id)
		for k, cid := range g.Strings("children") {
			c := GetNode(doc, cid)
			if c == nil || c.Str("type") == "page" {
				continue
			}
			ops = append(ops, jsonv.NewObject("op", "move", "id", cid, "parentId", parentID, "index", float64(index+k)))
			props := jsonv.NewObject("x", Round4(c.Num("x")+g.Num("x")), "y", Round4(c.Num("y")+g.Num("y")))
			if o := g.Num("opacity"); o != 1 {
				props.Set("opacity", Round4(c.Num("opacity")*o))
			}
			if !g.Bool("visible") {
				props.Set("visible", false)
			}
			ops = append(ops, jsonv.NewObject("op", "update", "id", cid, "props", props))
			released = append(released, cid)
		}
		ops = append(ops, jsonv.NewObject("op", "delete", "id", id))
	}
	return ops, released, nil
}

// AddPageOps creates a page. When the document has no pages yet but has content, that content
// first goes into a first page (DefaultPageName(1) in English), since with pages the top level only takes pages.
func AddPageOps(doc *Document, id, name, firstID, firstName string) ([]any, string) {
	ops := []any{}
	count := 0
	for _, r := range doc.Strings("rootIds") {
		if n := GetNode(doc, r); n != nil && n.Str("type") == "page" {
			count++
		}
	}
	roots := doc.Strings("rootIds")
	if FirstPage(doc) == nil && len(roots) > 0 {
		if firstID == "" {
			firstID = NewID()
		}
		if firstName == "" {
			firstName = DefaultPageName(1, "en")
		}
		ops = append(ops, jsonv.NewObject("op", "create", "parentId", nil, "index", 0.0, "node", jsonv.NewObject("type", "page", "id", firstID, "name", firstName)))
		for _, r := range roots {
			ops = append(ops, jsonv.NewObject("op", "move", "id", r, "parentId", firstID))
		}
		count = 1
	}
	if id == "" {
		id = NewID()
	}
	if name == "" {
		name = DefaultPageName(count+1, "en")
	}
	ops = append(ops, jsonv.NewObject("op", "create", "parentId", nil, "node", jsonv.NewObject("type", "page", "id", id, "name", name)))
	return ops, id
}

const DuplicateOffset = 40.0

var dupSkip = map[string]bool{"id": true, "parentId": true, "children": true, "sourceId": true}

var dupConnectorDerived = map[string]bool{"x": true, "y": true, "width": true, "height": true, "d": true}

var dupPropsForbidden = map[string]bool{"id": true, "type": true, "parentId": true, "children": true, "sourceId": true, "instanceOf": true}

type DuplicatePlan struct {
	Ops    []any
	Copies []string
	Map    *jsonv.Object
}

func underNode(doc *Document, id, ancestor string) bool {
	n := GetNode(doc, id)
	for n != nil {
		pid, _ := n.Get("parentId")
		s, _ := pid.(string)
		if s == "" {
			return false
		}
		if s == ancestor {
			return true
		}
		n = GetNode(doc, s)
	}
	return false
}

func dupChildNodes(doc *Document, n *Node) []*Node {
	if v, ok := n.Get("instanceOf"); ok {
		if s, isStr := v.(string); isStr && s != "" {
			return nil
		}
	}
	if !IsContainer(n.Str("type")) {
		return nil
	}
	var out []*Node
	for _, c := range n.Strings("children") {
		if ch := GetNode(doc, c); ch != nil && ch.Str("type") != "page" {
			out = append(out, ch)
		}
	}
	return out
}

func numOf(n *Node, key string) (float64, bool) {
	v, ok := n.Get(key)
	if !ok {
		return 0, false
	}
	f, isNum := v.(float64)
	return f, isNum
}

func DuplicateOps(doc *Document, ids []string, args *jsonv.Object) (*DuplicatePlan, error) {
	if len(ids) == 0 {
		return nil, errors.New("pass at least one id to duplicate")
	}
	var unique []string
	seen := map[string]bool{}
	for _, v := range ids {
		if !seen[v] {
			seen[v] = true
			unique = append(unique, v)
		}
	}
	var missing []string
	for _, v := range unique {
		if GetNode(doc, v) == nil {
			missing = append(missing, v)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("nodes do not exist: %s", strings.Join(missing, ", "))
	}
	for _, v := range unique {
		n := GetNode(doc, v)
		if n.Str("type") == "page" {
			return nil, fmt.Errorf(`"%s" is a page; duplicate the frames on it instead`, v)
		}
		if owner := CopyOwner(doc, n); owner != nil {
			return nil, fmt.Errorf(`"%s" is a copy inside the instance "%s"; duplicate the instance instead`, v, owner.Str("id"))
		}
	}
	var roots []string
	for _, id := range unique {
		nested := false
		for _, other := range unique {
			if other != id && underNode(doc, id, other) {
				nested = true
				break
			}
		}
		if !nested {
			roots = append(roots, id)
		}
	}
	offset, scale := DuplicateOffset, 1.0
	parentGiven, parentID := false, any(nil)
	var props *jsonv.Object
	if args != nil {
		if args.Has("offset") {
			offset = args.Num("offset")
		}
		if args.Has("scale") {
			scale = args.Num("scale")
		}
		if args.Has("parentId") {
			parentGiven = true
			parentID, _ = args.Get("parentId")
		}
		props = args.Obj("props")
	}
	if math.IsNaN(offset) || math.IsInf(offset, 0) {
		return nil, errors.New("offset must be a finite number")
	}
	if math.IsNaN(scale) || math.IsInf(scale, 0) || scale <= 0 {
		return nil, errors.New("scale must be a number above 0")
	}
	if props != nil {
		var bad []string
		for _, k := range props.Keys() {
			if dupPropsForbidden[k] {
				bad = append(bad, k)
			}
		}
		if len(bad) > 0 {
			return nil, fmt.Errorf("props cannot set %s: the copy keeps those from its source", strings.Join(bad, ", "))
		}
	}

	pairs := [][2]string{}
	mapIDs := map[string]string{}
	for _, id := range roots {
		stack := []*Node{GetNode(doc, id)}
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			nid := NewID()
			mapIDs[n.Str("id")] = nid
			pairs = append(pairs, [2]string{n.Str("id"), nid})
			stack = append(stack, dupChildNodes(doc, n)...)
		}
	}

	var build func(src *Node, isRoot bool) *jsonv.Object
	build = func(src *Node, isRoot bool) *jsonv.Object {
		input := jsonv.NewObject("type", src.Str("type"), "id", mapIDs[src.Str("id")])
		isConnector := src.Str("type") == "connector"
		isInstance := false
		if v, ok := src.Get("instanceOf"); ok {
			s, isStr := v.(string)
			isInstance = isStr && s != ""
		}
		for _, k := range src.Keys() {
			if dupSkip[k] || (isConnector && dupConnectorDerived[k]) {
				continue
			}
			if v, ok := src.Get(k); ok {
				input.Set(k, v)
			}
		}
		if src.Str("type") == "group" {
			input.Delete("width")
			input.Delete("height")
		}
		if !isInstance {
			scaleGeometry(input, scale, false)
		}
		factor, shift := scale, 0.0
		if isRoot {
			factor, shift = 1, offset
		}
		if !isConnector {
			sx, _ := numOf(src, "x")
			sy, _ := numOf(src, "y")
			input.Set("x", Round4(sx*factor+shift))
			input.Set("y", Round4(sy*factor+shift))
		}
		if isConnector {
			for _, end := range []string{"from", "to"} {
				e := src.Obj(end)
				if e == nil {
					continue
				}
				nc := jsonv.NewObject()
				for _, k := range e.Keys() {
					v, _ := e.Get(k)
					switch f, isNum := v.(float64); {
					case k == "nodeId":
						if s, isStr := v.(string); isStr {
							if m, ok := mapIDs[s]; ok {
								v = m
							}
						}
					case isNum && (k == "x" || k == "y"):
						v = Round4(f*factor + shift)
					}
					nc.Set(k, v)
				}
				input.Set(end, nc)
			}
		}
		if isInstance {
			sc, isNum := numOf(src, "scale")
			if !isNum {
				sc = 1
			}
			input.Set("scale", Round4(sc*scale))
		}
		kids := dupChildNodes(doc, src)
		if len(kids) > 0 {
			arr := []any{}
			for _, c := range kids {
				arr = append(arr, build(c, false))
			}
			input.Set("children", arr)
		}
		return input
	}

	plan := &DuplicatePlan{Ops: []any{}, Copies: []string{}, Map: jsonv.NewObject()}
	for _, p := range pairs {
		plan.Map.Set(p[0], p[1])
	}
	for _, id := range roots {
		src := GetNode(doc, id)
		node := build(src, true)
		if props != nil {
			for _, k := range props.Keys() {
				if v, ok := props.Get(k); ok {
					node.Set(k, v)
				}
			}
		}
		pid := parentID
		if !parentGiven {
			pid, _ = src.Get("parentId")
		}
		plan.Ops = append(plan.Ops, jsonv.NewObject("op", "create", "parentId", pid, "node", node))
		plan.Copies = append(plan.Copies, node.Str("id"))
	}
	return plan, nil
}
