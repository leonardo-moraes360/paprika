package core

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

var plainBlockers = []string{"component", "componentProps", "instanceOf", "sourceId", "bind", "slot", "slots", "propValues", "overrides", "scale"}

type derivedScope struct {
	prev, draft *Document
	ids         []string
	present     []string
	idx         *ScopeIndex
	next        *ScopeIndex
}

func plainNode(doc *Document, n *Node, idx *ScopeIndex) bool {
	if n.Str("type") == "connector" || idx.slotRefs[n.Str("id")] {
		return false
	}
	for _, k := range plainBlockers {
		if n.Has(k) {
			return false
		}
	}
	cur := n
	for depth := 0; depth < 1000; depth++ {
		pid, ok := ParentID(cur)
		if !ok || pid == "" {
			return true
		}
		cur = GetNode(doc, pid)
		if cur == nil {
			return false
		}
		if cur.Bool("component") || cur.Has("instanceOf") || cur.Has("sourceId") || idx.slotRefs[pid] {
			return false
		}
	}
	return false
}

func planDerived(prev, draft *Document, idx *ScopeIndex) *derivedScope {
	if idx == nil || idx.lagging || prev == nil {
		return nil
	}
	for _, e := range draft.Journal() {
		if e.Key != "rootIds" && e.Key != "name" {
			return nil
		}
	}
	nodes, pnodes := Nodes(draft), Nodes(prev)
	if nodes == nil || pnodes == nil {
		return nil
	}
	d := &derivedScope{prev: prev, draft: draft, idx: idx}
	seen := map[string]bool{}
	for _, e := range nodes.Journal() {
		if seen[e.Key] {
			continue
		}
		seen[e.Key] = true
		d.ids = append(d.ids, e.Key)
		cur := nodes.Obj(e.Key)
		if cur != nil {
			if !plainNode(draft, cur, idx) {
				return nil
			}
			d.present = append(d.present, e.Key)
		}
		if old := pnodes.Obj(e.Key); old != nil && !plainNode(prev, old, idx) {
			return nil
		}
	}
	d.next = &ScopeIndex{slotRefs: idx.slotRefs, hasConnectors: idx.hasConnectors, lagging: idx.lagging, pinned: maps_clone(idx.pinned)}
	affected := map[string]bool{}
	for _, id := range d.ids {
		affected[id] = true
		for _, doc := range []*Document{prev, draft} {
			if n := GetNode(doc, id); n != nil {
				if pid, ok := ParentID(n); ok && pid != "" {
					affected[pid] = true
				}
			}
		}
	}
	for id := range affected {
		n := nodes.Obj(id)
		if n != nil && n.Str("type") == "frame" && hasPinned(draft, n) {
			d.next.pinned[id] = true
		} else {
			delete(d.next.pinned, id)
		}
	}
	return d
}

func maps_clone(m map[string]bool) map[string]bool {
	out := make(map[string]bool, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func depthOf(doc *Document, n *Node) int {
	d := 0
	for cur := n; d < 1000; d++ {
		pid, ok := ParentID(cur)
		if !ok || pid == "" {
			break
		}
		cur = GetNode(doc, pid)
		if cur == nil {
			break
		}
	}
	return d
}

func (d *derivedScope) applyConstraints() {
	before, draft := d.prev, d.draft
	base := map[string]sizeSnap{}
	snap := func(id string) {
		if _, ok := base[id]; ok {
			return
		}
		cur := GetNode(draft, id)
		if cur == nil || cur.Str("type") == "page" {
			return
		}
		now := snapOf(cur)
		old := GetNode(before, id)
		if old == nil || old.Str("type") == "page" {
			base[id] = now
			return
		}
		prev := snapOf(old)
		if !prev.wOK {
			prev.w, prev.wOK = now.w, now.wOK
		}
		if !prev.hOK {
			prev.h, prev.hOK = now.h, now.hOK
		}
		base[id] = prev
	}
	var snapSubtree func(id string)
	snapSubtree = func(id string) {
		snap(id)
		if n := GetNode(draft, id); n != nil && IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				snapSubtree(c)
			}
		}
	}
	done := map[string]bool{}
	var visit func(id string)
	visit = func(id string) {
		done[id] = true
		n := GetNode(draft, id)
		if n == nil {
			return
		}
		changedFrame := false
		if n.Str("type") == "frame" && n.Str("instanceOf") == "" && n.Str("sourceId") == "" {
			snap(id)
			old := base[id]
			nw, nwOK := sizeNum(n, "width")
			nh, nhOK := sizeNum(n, "height")
			widthChanged := old.wOK && nwOK && math.Abs(nw-old.w) > constraintEps
			heightChanged := old.hOK && nhOK && math.Abs(nh-old.h) > constraintEps
			if widthChanged || heightChanged {
				changedFrame = true
				for _, c := range n.Strings("children") {
					snapSubtree(c)
				}
				oldW, newW := nw, nw
				oldH, newH := nh, nh
				if widthChanged {
					oldW, newW = old.w, nw
				}
				if heightChanged {
					oldH, newH = old.h, nh
				}
				for _, cid := range append([]string(nil), n.Strings("children")...) {
					adjustChild(draft, n, cid, oldW, oldH, newW, newH)
				}
			}
		}
		if changedFrame && IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				visit(c)
			}
		}
	}
	var roots []string
	for _, id := range d.present {
		if n := GetNode(draft, id); n != nil && n.Str("type") == "frame" && GetNode(before, id) != nil {
			roots = append(roots, id)
		}
	}
	depth := map[string]int{}
	for _, id := range roots {
		depth[id] = depthOf(draft, GetNode(draft, id))
	}
	slices.SortStableFunc(roots, func(a, b string) int { return depth[a] - depth[b] })
	for _, id := range roots {
		if !done[id] {
			visit(id)
		}
	}
}

func (d *derivedScope) prepare() bool {
	before, draft := d.prev, d.draft
	if len(layoutCands(before, draft, d.next.pinned)) > 0 {
		return false
	}
	for _, id := range d.present {
		n := GetNode(draft, id)
		old := GetNode(before, id)
		if n.Str("type") != "frame" || n.Str("instanceOf") != "" || n.Str("sourceId") != "" || old == nil || old.Str("type") == "page" {
			continue
		}
		prev, now := snapOf(old), snapOf(n)
		if !prev.wOK {
			prev.w, prev.wOK = now.w, now.wOK
		}
		if !prev.hOK {
			prev.h, prev.hOK = now.h, now.hOK
		}
		wc := prev.wOK && now.wOK && math.Abs(now.w-prev.w) > constraintEps
		hc := prev.hOK && now.hOK && math.Abs(now.h-prev.h) > constraintEps
		if (wc || hc) && !d.subtreePlain(n) {
			return false
		}
	}
	return true
}

func (d *derivedScope) subtreePlain(n *Node) bool {
	for _, c := range n.Strings("children") {
		cn := GetNode(d.draft, c)
		if cn == nil {
			continue
		}
		if cn.Str("type") == "connector" || d.idx.slotRefs[c] {
			return false
		}
		for _, k := range plainBlockers {
			if cn.Has(k) {
				return false
			}
		}
		if IsContainer(cn.Str("type")) && !d.subtreePlain(cn) {
			return false
		}
	}
	return true
}

func pathKey(doc *Document, id string) []int {
	var rev []int
	cur := GetNode(doc, id)
	for depth := 0; cur != nil && depth < 1000; depth++ {
		pid, ok := ParentID(cur)
		if !ok || pid == "" {
			rev = append(rev, slices.Index(doc.Strings("rootIds"), cur.Str("id")))
			break
		}
		parent := GetNode(doc, pid)
		if parent == nil {
			break
		}
		rev = append(rev, slices.Index(parent.Strings("children"), cur.Str("id")))
		cur = parent
	}
	slices.Reverse(rev)
	return rev
}

func postOrderLess(a, b []int) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] - b[i]
		}
	}
	return len(b) - len(a)
}

func (d *derivedScope) fitGroups() []any {
	draft := d.draft
	cand := map[string]bool{}
	for _, id := range d.present {
		cur := GetNode(draft, id)
		for depth := 0; cur != nil && depth < 1000; depth++ {
			if cur.Str("type") == "group" && !cur.Has("sourceId") {
				cand[cur.Str("id")] = true
			}
			pid, ok := ParentID(cur)
			if !ok || pid == "" {
				break
			}
			cur = GetNode(draft, pid)
		}
	}
	if len(cand) == 0 {
		return nil
	}
	ids := make([]string, 0, len(cand))
	keys := map[string][]int{}
	for id := range cand {
		ids = append(ids, id)
		keys[id] = pathKey(draft, id)
	}
	slices.SortFunc(ids, func(a, b string) int { return postOrderLess(keys[a], keys[b]) })
	var inverse []any
	for _, id := range ids {
		inverse = fitGroup(draft, GetNode(draft, id), inverse)
	}
	return inverse
}

func (d *derivedScope) lengthTokenError() string {
	draft, prev := d.draft, d.prev
	check := func(n *Node) bool { return lengthOwnProblem(draft, n) == "" }
	var walk func(n *Node) bool
	walk = func(n *Node) bool {
		if !check(n) {
			return false
		}
		if IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				if cn := GetNode(draft, c); cn != nil && !walk(cn) {
					return false
				}
			}
		}
		return true
	}
	for _, id := range d.present {
		n := GetNode(draft, id)
		old := GetNode(prev, id)
		reshaped := old == nil || old.Str("mode") != n.Str("mode") || mustGet(old, "parentId") != mustGet(n, "parentId")
		if reshaped && IsContainer(n.Str("type")) {
			if !walk(n) {
				return LengthTokenError(draft)
			}
		} else if !check(n) {
			return LengthTokenError(draft)
		}
	}
	return ""
}

func (d *derivedScope) webSemanticsError() string {
	draft := d.draft
	for _, id := range d.present {
		n := GetNode(draft, id)
		if n.Str("type") == "frame" {
			_, hasMin := n.Get("minWidth")
			_, hasMax := n.Get("maxWidth")
			if hasMin || hasMax {
				if !IsRootFrame(draft, n) || (hasMin && hasMax && n.Num("minWidth") > n.Num("maxWidth")) {
					return webSemanticsError(draft)
				}
			}
		}
		if n.Str("type") == "image" && strings.HasPrefix(n.Str("src"), "$") {
			if assets := draft.Obj("assets"); assets == nil || !assets.Has(n.Str("src")[1:]) {
				return webSemanticsError(draft)
			}
		}
	}
	return ""
}

func (d *derivedScope) String() string { return fmt.Sprint(len(d.ids), " ids") }

var _ = jsonv.Equal

var ScopedDerivedOff bool

func (d *derivedScope) run(last int) ([]any, error) {
	d.applyConstraints()
	first := d.fitGroups()
	second := d.fitGroups()
	inverse := append(second, first...)
	if msg := d.lengthTokenError(); msg != "" {
		return nil, opErr(last, "%s", msg)
	}
	if msg := d.webSemanticsError(); msg != "" {
		return nil, opErr(last, "%s", msg)
	}
	if d.idx.hasConnectors {
		if err := RouteConnectors(d.draft); err != nil {
			return nil, opErr(last, "%s", err.Error())
		}
	}
	return inverse, nil
}
