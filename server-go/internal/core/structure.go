package core

import (
	"errors"
	"fmt"
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
// first goes into a first page ("Página 1"), since with pages the top level only takes pages.
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
			firstName = "Página 1"
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
		name = "Página " + jsonv.FormatNumber(float64(count+1))
	}
	ops = append(ops, jsonv.NewObject("op", "create", "parentId", nil, "node", jsonv.NewObject("type", "page", "id", id, "name", name)))
	return ops, id
}
