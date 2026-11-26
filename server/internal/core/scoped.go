package core

import (
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server/internal/zod"
)

var scopedProps = map[string]bool{
	"name": true, "opacity": true, "locked": true, "notes": true, "lintIgnore": true,
	"fill": true, "gradient": true, "stroke": true, "radius": true, "shadow": true,
	"outline": true, "filter": true, "backdropFilter": true, "color": true,
}

var scopedTypes = map[string]bool{
	"frame": true, "rect": true, "ellipse": true, "text": true, "path": true, "image": true, "shape": true,
}

type ScopeIndex struct {
	slotRefs map[string]bool
}

func BuildScopeIndex(doc *Document) *ScopeIndex {
	idx := &ScopeIndex{slotRefs: map[string]bool{}}
	nodes := Nodes(doc)
	if nodes == nil {
		return idx
	}
	for _, id := range nodes.Keys() {
		n := nodes.Obj(id)
		if n == nil {
			continue
		}
		slots := n.Obj("slots")
		if slots == nil {
			continue
		}
		for _, name := range slots.Keys() {
			for _, ref := range slots.Strings(name) {
				idx.slotRefs[ref] = true
			}
		}
	}
	return idx
}

func scopedEligible(doc *Document, n *Node, idx *ScopeIndex) bool {
	if !scopedTypes[n.Str("type")] {
		return false
	}
	for cur, depth := n, 0; cur != nil; depth++ {
		if depth > 1000 {
			return false
		}
		if idx.slotRefs[cur.Str("id")] || cur.Has("sourceId") || cur.Has("instanceOf") || cur.Bool("component") {
			return false
		}
		pid, _ := cur.Get("parentId")
		ps, ok := pid.(string)
		if !ok || ps == "" {
			break
		}
		cur = GetNode(doc, ps)
	}
	return true
}

func ApplyScoped(doc *Document, ops []any, idx *ScopeIndex) (*ApplyResult, bool) {
	nodes := Nodes(doc)
	if len(ops) == 0 || nodes == nil || idx == nil {
		return nil, false
	}
	parsed := make([]*jsonv.Object, len(ops))
	var touched []string
	seen := map[string]bool{}
	for i, raw := range ops {
		p, err := z.Parse(OpSchema, raw)
		if err != nil {
			return nil, false
		}
		op := p.(*jsonv.Object)
		if op.Str("op") != "update" {
			return nil, false
		}
		id := op.Str("id")
		n := nodes.Obj(id)
		props := op.Obj("props")
		if n == nil || props == nil || props.Len() == 0 {
			return nil, false
		}
		for _, k := range props.Keys() {
			if !scopedProps[k] {
				return nil, false
			}
		}
		if !seen[id] {
			if !scopedEligible(doc, n, idx) {
				return nil, false
			}
			seen[id] = true
			touched = append(touched, id)
		}
		parsed[i] = op
	}
	draft := newDraft(doc)
	var inverse []any
	created := []string{}
	for i, op := range parsed {
		inv, err := applyOne(draft, op, i, &created)
		if err != nil {
			return nil, false
		}
		inverse = append(flatten(inv), inverse...)
	}
	if LengthTokenErrorFor(draft, touched) != "" {
		return nil, false
	}
	if inverse == nil {
		inverse = []any{}
	}
	return &ApplyResult{Doc: draft, Inverse: inverse, Created: created, Touched: touched, Journal: sealDraft(draft)}, true
}
