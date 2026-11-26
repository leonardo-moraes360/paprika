package server

import (
	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type mapDelta struct {
	Set       []string
	Del       []string
	Reordered bool
}

func (m *mapDelta) empty() bool { return len(m.Set) == 0 && len(m.Del) == 0 }

type docDelta struct {
	valid     bool
	name      bool
	rootIDs   bool
	nodes     mapDelta
	tokens    mapDelta
	modes     mapDelta
	tokenMeta mapDelta
	assets    mapDelta
}

var deltaDocKeys = map[string]bool{"format": true, "id": true, "name": true, "tokens": true, "modes": true, "tokenMeta": true, "rootIds": true, "nodes": true, "assets": true}

func (d *docDelta) begin(doc, prev *core.Document) {
	*d = docDelta{}
	if prev == nil {
		return
	}
	for _, k := range doc.Keys() {
		if !deltaDocKeys[k] {
			return
		}
	}
	for _, k := range prev.Keys() {
		if !deltaDocKeys[k] {
			return
		}
	}
	if doc.Str("id") != prev.Str("id") || doc.Str("format") != prev.Str("format") {
		return
	}
	for _, f := range []func(*core.Document) *jsonv.Object{core.Tokens, core.Modes, core.TokenMeta, core.Assets, core.Nodes} {
		if (f(doc) == nil) != (f(prev) == nil) {
			return
		}
	}
	d.valid = true
	d.name = doc.Str("name") != prev.Str("name")
	a, _ := doc.Get("rootIds")
	b, _ := prev.Get("rootIds")
	d.rootIDs = !jsonv.Equal(a, b)
}

func (d *docDelta) map_(name string) *mapDelta {
	if d == nil {
		return nil
	}
	switch name {
	case "tokens":
		return &d.tokens
	case "modes":
		return &d.modes
	case "tokenMeta":
		return &d.tokenMeta
	case "assets":
		return &d.assets
	}
	return &d.nodes
}

func (d *docDelta) usable() bool {
	return d != nil && d.valid && !d.nodes.Reordered && !d.tokens.Reordered && !d.modes.Reordered && !d.tokenMeta.Reordered && !d.assets.Reordered
}

func mapPatch(m *mapDelta, cur *jsonv.Object) any {
	set := jsonv.NewObject()
	for _, k := range m.Set {
		v, _ := cur.Get(k)
		set.Set(k, v)
	}
	out := jsonv.NewObject()
	if len(m.Set) > 0 {
		out.Set("set", set)
	}
	if len(m.Del) > 0 {
		del := make([]any, len(m.Del))
		for i, k := range m.Del {
			del[i] = k
		}
		out.Set("del", del)
	}
	return out
}

func deltaMessage(e ChangeEvent, canUndo, canRedo bool) string {
	d := e.Delta
	o := jsonv.NewObject("type", "delta", "id", e.DocID, "version", float64(e.Version), "base", float64(e.Base), "actor", e.Actor, "label", e.Label,
		"kind", e.Kind, "canUndo", canUndo, "canRedo", canRedo)
	if d.name {
		o.Set("name", e.Doc.Str("name"))
	}
	if d.rootIDs {
		v, _ := e.Doc.Get("rootIds")
		o.Set("rootIds", v)
	}
	if !d.nodes.empty() {
		o.Set("nodes", mapPatch(&d.nodes, core.Nodes(e.Doc)))
	}
	if !d.tokens.empty() {
		o.Set("tokens", mapPatch(&d.tokens, core.Tokens(e.Doc)))
	}
	if !d.modes.empty() {
		o.Set("modes", mapPatch(&d.modes, core.Modes(e.Doc)))
	}
	if !d.tokenMeta.empty() {
		o.Set("tokenMeta", mapPatch(&d.tokenMeta, core.TokenMeta(e.Doc)))
	}
	if !d.assets.empty() {
		o.Set("assets", mapPatch(&d.assets, core.Assets(e.Doc)))
	}
	return jsonv.Stringify(o, "")
}
