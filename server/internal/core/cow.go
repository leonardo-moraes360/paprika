package core

import (
	"slices"
	"sync/atomic"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

var docMapKeys = []string{"tokens", "modes", "tokenMeta", "assets"}

var strictOwnership atomic.Bool

var ownershipFallbacks atomic.Int64

func SetStrictOwnership(on bool) { strictOwnership.Store(on) }

func OwnershipFallbacks() int64 { return ownershipFallbacks.Load() }

type Journal struct {
	Nodes []jsonv.JournalEntry
	Doc   []jsonv.JournalEntry
}

func isShared(doc *Document) bool {
	nodes := Nodes(doc)
	return nodes != nil && nodes.Frozen()
}

func newDraft(doc *Document) *Document {
	d := doc.Spread()
	if nodes := Nodes(doc); nodes != nil {
		n := nodes.Spread()
		n.StartJournal()
		d.Set("nodes", n)
	}
	if roots, ok := d.Get("rootIds"); ok {
		if arr, isArr := roots.([]any); isArr {
			d.Set("rootIds", slices.Clone(arr))
		}
	}
	d.StartJournal()
	return d
}

func own(doc *Document, id string) *Node {
	nodes := Nodes(doc)
	n := nodes.Obj(id)
	if n == nil || !n.Frozen() {
		return n
	}
	c := jsonv.Clone(n).(*Node)
	nodes.Set(id, c)
	return c
}

func ownNode(doc *Document, n *Node) *Node {
	if n == nil || !n.Frozen() {
		return n
	}
	return own(doc, n.Str("id"))
}

func ownDocMaps(doc *Document) {
	for _, k := range docMapKeys {
		if o := doc.Obj(k); o != nil && o.Frozen() {
			doc.Set(k, jsonv.Clone(o))
		}
	}
}

func sealDraft(d *Document) *Journal {
	nodes := Nodes(d)
	j := &Journal{Doc: slices.Clone(d.Journal())}
	if nodes != nil {
		j.Nodes = slices.Clone(nodes.Journal())
		for _, e := range j.Nodes {
			if e.Kind != jsonv.JournalDelete {
				jsonv.Freeze(nodes.Obj(e.Key))
			}
		}
		nodes.Seal()
	}
	for _, e := range j.Doc {
		if e.Kind != jsonv.JournalDelete {
			v, _ := d.Get(e.Key)
			jsonv.Freeze(v)
		}
	}
	d.Seal()
	return j
}
