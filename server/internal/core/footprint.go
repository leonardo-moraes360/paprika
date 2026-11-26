package core

import (
	"slices"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type footprintSet struct {
	keys map[string]struct{}
	wide bool
}

func (f *footprintSet) add(k string) {
	if f.keys == nil {
		f.keys = map[string]struct{}{}
	}
	f.keys[k] = struct{}{}
}

func (f *footprintSet) sorted() []string {
	out := make([]string, 0, len(f.keys))
	for k := range f.keys {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func listKey(prefix string, parent any) string {
	if p, ok := parent.(string); ok {
		return prefix + p
	}
	return prefix
}

func (f *footprintSet) layoutParent(doc *Document, id string, constrained bool) {
	if doc == nil || constrained {
		f.add("l:" + id)
		return
	}
	if p := GetNode(doc, id); p != nil && (p.Str("type") == "group" || p.Obj("layout") != nil) {
		f.add("l:" + id)
	}
}

func (f *footprintSet) use(parent any) {
	if p, ok := parent.(string); ok {
		f.add("x:" + p)
	}
}

func (f *footprintSet) coupling(doc *Document, id string) {
	if doc == nil {
		return
	}
	cur := GetNode(doc, id)
	for depth := 0; cur != nil && depth < 1000; depth++ {
		if cur.Bool("component") {
			f.add("k:" + cur.Str("id"))
		}
		if v := cur.Str("instanceOf"); v != "" {
			f.add("k:" + v)
		}
		if v := cur.Str("sourceId"); v != "" {
			f.add("k:" + v)
		}
		pid, ok := ParentID(cur)
		if !ok || pid == "" {
			break
		}
		cur = GetNode(doc, pid)
	}
}

func (f *footprintSet) geometry(doc *Document, id string) {
	if doc == nil {
		return
	}
	n := GetNode(doc, id)
	if n == nil {
		return
	}
	if IsContainer(n.Str("type")) {
		f.add("l:" + id)
	}
	pid, ok := ParentID(n)
	if !ok || pid == "" {
		return
	}
	p := GetNode(doc, pid)
	if p != nil && (p.Str("type") == "group" || p.Obj("layout") != nil || n.Obj("constraints") != nil) {
		f.add("l:" + pid)
	}
}

func (f *footprintSet) node(doc *Document, id string, geometry bool) {
	f.add("n:" + id)
	f.coupling(doc, id)
	if geometry {
		f.geometry(doc, id)
	}
}

func Footprint(ops, inverse []any, doc *Document) ([]string, bool) {
	f := &footprintSet{}
	indexed := false
	for _, raw := range ops {
		op, ok := raw.(*jsonv.Object)
		if !ok {
			continue
		}
		if op.Str("op") == "create" && (op.Has("index") || op.Has("place")) {
			indexed = true
		}
	}
	for _, raw := range inverse {
		op, ok := raw.(*jsonv.Object)
		if !ok {
			f.wide = true
			continue
		}
		switch op.Str("op") {
		case "update":
			geometry := false
			if props := op.Obj("props"); props != nil {
				for _, k := range props.Keys() {
					if !scopedProps[k] {
						geometry = true
					}
				}
			}
			f.node(doc, op.Str("id"), geometry)
		case "delete":
			id := op.Str("id")
			f.node(doc, id, true)
			if doc == nil || GetNode(doc, id) == nil {
				f.wide = true
				continue
			}
			for _, n := range subtree(doc, id) {
				f.add("n:" + n.Str("id"))
				f.add("e:" + n.Str("id"))
			}
			p, _ := GetNode(doc, id).Get("parentId")
			f.add(listKey("r:", p))
			f.use(p)
			if indexed {
				f.add(listKey("c:", p))
			}
			if ps, ok := p.(string); ok {
				f.layoutParent(doc, ps, GetNode(doc, id).Obj("constraints") != nil)
			}
		case "restore":
			for _, v := range op.Arr("nodes") {
				if n, ok := v.(*jsonv.Object); ok {
					f.add("n:" + n.Str("id"))
					f.add("e:" + n.Str("id"))
				}
			}
			p, _ := op.Get("parentId")
			f.add(listKey("c:", p))
			f.use(p)
			constrained := false
			for _, v := range op.Arr("nodes") {
				if n, ok := v.(*jsonv.Object); ok && n.Str("id") == op.Str("rootId") {
					constrained = n.Obj("constraints") != nil
				}
			}
			if ps, ok := p.(string); ok {
				f.layoutParent(doc, ps, constrained)
			}
			f.coupling(doc, op.Str("rootId"))
		case "move":
			id := op.Str("id")
			f.node(doc, id, true)
			p, _ := op.Get("parentId")
			f.add(listKey("c:", p))
			f.use(p)
			constrained := doc != nil && GetNode(doc, id) != nil && GetNode(doc, id).Obj("constraints") != nil
			if ps, ok := p.(string); ok {
				f.layoutParent(doc, ps, constrained)
			}
			if doc == nil {
				f.wide = true
			} else if n := GetNode(doc, id); n != nil {
				cur, _ := n.Get("parentId")
				f.add(listKey("c:", cur))
				f.use(cur)
				if cs, ok := cur.(string); ok {
					f.layoutParent(doc, cs, constrained)
				}
			} else {
				f.wide = true
			}
		case "set_tokens":
			f.add("tokens")
		case "set_assets":
			f.add("assets")
		case "rename_document":
			f.add("name")
		default:
			f.wide = true
		}
	}
	return f.sorted(), f.wide
}

func mergeKeys(a, b []string) []string {
	out := slices.Concat(a, b)
	slices.Sort(out)
	return slices.Compact(out)
}

func footprintsConflict(aKeys []string, aWide bool, bKeys []string, bWide bool) bool {
	if aWide || bWide {
		return true
	}
	set := make(map[string]struct{}, len(bKeys))
	for _, k := range bKeys {
		set[k] = struct{}{}
	}
	for _, k := range aKeys {
		if !strings.HasPrefix(k, "r:") && !strings.HasPrefix(k, "x:") && !strings.HasPrefix(k, "e:") {
			if _, ok := set[k]; ok {
				return true
			}
		}
		for _, pair := range [][2]string{{"r:", "c:"}, {"c:", "r:"}, {"e:", "x:"}, {"x:", "e:"}} {
			if rest, ok := strings.CutPrefix(k, pair[0]); ok {
				if _, ok := set[pair[1]+rest]; ok {
					return true
				}
			}
		}
	}
	return false
}

func entriesConflict(a, b HistoryEntry) bool {
	return footprintsConflict(a.Keys, a.Wide, b.Keys, b.Wide)
}
