package team

import (
	"encoding/json"
	"slices"
	"sort"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type view struct {
	name     string
	nodes    map[string]*jsonv.Object
	parent   map[string]string
	children map[string][]string
	order    []string
	tokens   *jsonv.Object
	modes    *jsonv.Object
}

var connectorDerived = map[string]bool{"x": true, "y": true, "width": true, "height": true, "d": true}

func syncedFields(doc *core.Document, n *core.Node) *jsonv.Object {
	if core.CopyOwner(doc, n) != nil {
		return nil
	}
	out := jsonv.NewObject()
	typ := n.Str("type")
	instance := core.IsInstance(n)
	for _, k := range n.Keys() {
		if k == "id" || k == "parentId" || k == "children" {
			continue
		}
		if typ == "connector" && connectorDerived[k] {
			continue
		}
		if typ == "group" && (k == "width" || k == "height") {
			continue
		}
		if instance && inList(core.RootDerived, k) {
			continue
		}
		v, _ := n.Get(k)
		out.Set(k, v)
	}
	return out
}

func inList(list []string, s string) bool {
	return slices.Contains(list, s)
}

func viewOf(doc *core.Document) *view {
	v := &view{name: doc.Str("name"), nodes: map[string]*jsonv.Object{}, parent: map[string]string{}, children: map[string][]string{},
		tokens: core.Tokens(doc), modes: core.Modes(doc)}
	if v.tokens == nil {
		v.tokens = jsonv.NewObject()
	}
	if v.modes == nil {
		v.modes = jsonv.NewObject()
	}
	var walk func(ids []string, parent string)
	walk = func(ids []string, parent string) {
		for _, id := range ids {
			n := core.GetNode(doc, id)
			if n == nil {
				continue
			}
			f := syncedFields(doc, n)
			if f == nil {
				continue
			}
			v.nodes[id] = f
			v.parent[id] = parent
			v.children[parent] = append(v.children[parent], id)
			v.order = append(v.order, id)
			if core.IsContainer(n.Str("type")) && !core.IsInstance(n) {
				walk(n.Strings("children"), id)
			}
		}
	}
	walk(doc.Strings("rootIds"), "")
	return v
}

func stateDoc(raw json.RawMessage) (*core.Document, error) {
	parsed, err := jsonv.Parse(raw)
	if err != nil {
		return nil, err
	}
	o, _ := parsed.(*jsonv.Object)
	if o == nil {
		o = jsonv.NewObject()
	}
	for _, k := range []string{"nodes", "tokens", "modes"} {
		if o.Obj(k) == nil {
			o.Set(k, jsonv.NewObject())
		}
	}
	if o.Arr("rootIds") == nil {
		o.Set("rootIds", []any{})
	}
	for _, id := range core.Nodes(o).Keys() {
		core.Nodes(o).Obj(id).Set("id", id)
	}
	return o, nil
}

func same(a, b any) bool { return jsonv.Stringify(a, "") == jsonv.Stringify(b, "") }

func raw(v any) json.RawMessage { return json.RawMessage(jsonv.Stringify(v, "")) }

func nullable(p string) any {
	if p == "" {
		return nil
	}
	return p
}

func equalIDs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

type Change map[string]any

func Diff(prev, next *core.Document) []Change {
	a, b := viewOf(prev), viewOf(next)
	var out []Change
	for _, id := range b.order {
		if _, ok := a.nodes[id]; !ok {
			out = append(out, Change{"k": "create", "id": id, "parent": nullable(b.parent[id]), "fields": raw(b.nodes[id])})
		}
	}
	for _, id := range b.order {
		if _, ok := a.nodes[id]; ok && a.parent[id] != b.parent[id] {
			out = append(out, Change{"k": "move", "id": id, "parent": nullable(b.parent[id])})
		}
	}
	for _, id := range b.order {
		old, ok := a.nodes[id]
		if !ok {
			continue
		}
		set := jsonv.NewObject()
		for _, k := range b.nodes[id].Keys() {
			nv, _ := b.nodes[id].Get(k)
			if ov, has := old.Get(k); !has || !same(ov, nv) {
				set.Set(k, nv)
			}
		}
		for _, k := range old.Keys() {
			if !b.nodes[id].Has(k) {
				set.Set(k, nil)
			}
		}
		if set.Len() > 0 {
			out = append(out, Change{"k": "set", "id": id, "fields": raw(set)})
		}
	}
	parents := []string{""}
	for _, id := range b.order {
		if _, ok := b.children[id]; ok {
			parents = append(parents, id)
		}
	}
	for _, p := range parents {
		var kept []string
		for _, id := range a.children[p] {
			if b.parent[id] == p {
				if _, ok := b.nodes[id]; ok {
					kept = append(kept, id)
				}
			}
		}
		if !equalIDs(kept, b.children[p]) && len(b.children[p]) > 0 {
			out = append(out, Change{"k": "order", "parent": nullable(p), "children": b.children[p]})
		}
	}
	var deleted []string
	for id := range a.nodes {
		if _, ok := b.nodes[id]; !ok {
			deleted = append(deleted, id)
		}
	}
	sort.Strings(deleted)
	for _, id := range deleted {
		out = append(out, Change{"k": "delete", "id": id})
	}
	if c := tokenChange("", a.tokens, b.tokens); c != nil {
		out = append(out, c)
	}
	modes := map[string]bool{}
	for _, m := range append(a.modes.Keys(), b.modes.Keys()...) {
		modes[m] = true
	}
	names := make([]string, 0, len(modes))
	for m := range modes {
		names = append(names, m)
	}
	sort.Strings(names)
	for _, m := range names {
		ta, tb := a.modes.Obj(m), b.modes.Obj(m)
		if ta == nil {
			ta = jsonv.NewObject()
		}
		if tb == nil {
			tb = jsonv.NewObject()
		}
		if c := tokenChange(m, ta, tb); c != nil {
			out = append(out, c)
		}
	}
	if a.name != b.name {
		out = append(out, Change{"k": "name", "value": b.name})
	}
	return out
}

func tokenChange(mode string, a, b *jsonv.Object) Change {
	set := jsonv.NewObject()
	for _, k := range b.Keys() {
		nv, _ := b.Get(k)
		if ov, ok := a.Get(k); !ok || !same(ov, nv) {
			set.Set(k, nv)
		}
	}
	for _, k := range a.Keys() {
		if !b.Has(k) {
			set.Set(k, nil)
		}
	}
	if set.Len() == 0 {
		return nil
	}
	return Change{"k": "tokens", "mode": mode, "set": raw(set)}
}

func RemoteOps(doc, state *core.Document) []any {
	cur, want := viewOf(doc), viewOf(state)
	sim := map[string][]string{"": append([]string(nil), doc.Strings("rootIds")...)}
	for _, id := range core.Nodes(doc).Keys() {
		n := core.GetNode(doc, id)
		if core.IsContainer(n.Str("type")) {
			sim[id] = append([]string(nil), n.Strings("children")...)
		}
	}
	simParent := map[string]string{}
	for p, kids := range sim {
		for _, k := range kids {
			simParent[k] = p
		}
	}
	remove := func(id string) {
		p := simParent[id]
		kids := sim[p]
		for i, k := range kids {
			if k == id {
				sim[p] = append(kids[:i:i], kids[i+1:]...)
				break
			}
		}
		delete(simParent, id)
	}
	insert := func(id, p string, at int) {
		kids := sim[p]
		if at > len(kids) {
			at = len(kids)
		}
		sim[p] = append(kids[:at:at], append([]string{id}, kids[at:]...)...)
		simParent[id] = p
	}
	indexOf := func(id, p string) int {
		for i, k := range sim[p] {
			if k == id {
				return i
			}
		}
		return -1
	}

	var ops []any
	for _, id := range want.order {
		if _, ok := cur.nodes[id]; !ok || cur.parent[id] == want.parent[id] {
			continue
		}
		to := want.parent[id]
		if _, exists := cur.nodes[to]; to != "" && !exists {
			to = ""
		}
		ops = append(ops, jsonv.NewObject("op", "move", "id", id, "parentId", nullable(to)))
		remove(id)
		insert(id, to, len(sim[to]))
	}
	gone := map[string]bool{}
	for id := range cur.nodes {
		if _, ok := want.nodes[id]; !ok {
			gone[id] = true
		}
	}
	for _, id := range cur.order {
		if gone[id] && !gone[simParent[id]] {
			ops = append(ops, jsonv.NewObject("op", "delete", "id", id))
			remove(id)
		}
	}
	for _, id := range want.order {
		p := want.parent[id]
		at := 0
		for i, k := range want.children[p] {
			if k == id {
				at = i
				break
			}
		}
		if _, exists := cur.nodes[id]; !exists {
			node := want.nodes[id].Spread()
			node.Set("id", id)
			ops = append(ops, jsonv.NewObject("op", "create", "parentId", nullable(p), "index", float64(at), "node", node))
			insert(id, p, at)
			continue
		}
		if simParent[id] != p || indexOf(id, p) != at {
			ops = append(ops, jsonv.NewObject("op", "move", "id", id, "parentId", nullable(p), "index", float64(at)))
			remove(id)
			insert(id, p, at)
		}
	}
	for _, id := range want.order {
		old, ok := cur.nodes[id]
		if !ok {
			continue
		}
		props := jsonv.NewObject()
		for _, k := range want.nodes[id].Keys() {
			nv, _ := want.nodes[id].Get(k)
			if k == "type" {
				continue
			}
			if ov, has := old.Get(k); !has || !same(ov, nv) {
				props.Set(k, nv)
			}
		}
		for _, k := range old.Keys() {
			if k != "type" && !want.nodes[id].Has(k) {
				props.Set(k, nil)
			}
		}
		if props.Len() > 0 {
			ops = append(ops, jsonv.NewObject("op", "update", "id", id, "props", props))
		}
	}
	if set := tokenSet(cur.tokens, want.tokens); set != nil {
		ops = append(ops, jsonv.NewObject("op", "set_tokens", "tokens", set))
	}
	modes := map[string]bool{}
	for _, m := range append(cur.modes.Keys(), want.modes.Keys()...) {
		modes[m] = true
	}
	names := make([]string, 0, len(modes))
	for m := range modes {
		names = append(names, m)
	}
	sort.Strings(names)
	for _, m := range names {
		ta, tb := cur.modes.Obj(m), want.modes.Obj(m)
		if ta == nil {
			ta = jsonv.NewObject()
		}
		if tb == nil {
			tb = jsonv.NewObject()
		}
		if set := tokenSet(ta, tb); set != nil {
			ops = append(ops, jsonv.NewObject("op", "set_tokens", "mode", m, "tokens", set))
		}
	}
	if want.name != "" && want.name != cur.name {
		ops = append(ops, jsonv.NewObject("op", "rename_document", "name", want.name))
	}
	return ops
}

func tokenSet(a, b *jsonv.Object) *jsonv.Object {
	set := jsonv.NewObject()
	for _, k := range b.Keys() {
		nv, _ := b.Get(k)
		if ov, ok := a.Get(k); !ok || !same(ov, nv) {
			set.Set(k, nv)
		}
	}
	for _, k := range a.Keys() {
		if !b.Has(k) {
			set.Set(k, nil)
		}
	}
	if set.Len() == 0 {
		return nil
	}
	return set
}
