package core

import (
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/component.ts: components (frames with component: true) and
// instances (frames with instanceOf), whose children are copies rebuilt at the end of every
// transaction.

// CopyOverrides are the fields of a copy that an instance can override.
var CopyOverrides = []string{"fill", "color", "text", "src", "alt", "visible", "opacity", "runs"}

// RootDerived are the fields of an instance root that come from the component.
var RootDerived = []string{"fill", "stroke", "radius", "shadow", "outline", "filter", "backdropFilter", "layout", "clip", "width", "height"}

func inList(list []string, k string) bool {
	return slices.Contains(list, k)
}

// IsInstance reports whether n is a frame with instanceOf.
func IsInstance(n *Node) bool {
	if n == nil || n.Str("type") != "frame" {
		return false
	}
	v, ok := n.Get("instanceOf")
	_, isStr := v.(string)
	return ok && isStr
}

// InstanceOwner returns the instance that contains id (itself or the nearest ancestor).
func InstanceOwner(doc *Document, id any) *Node {
	cur, _ := id.(string)
	for cur != "" {
		n := GetNode(doc, cur)
		if n == nil {
			return nil
		}
		if IsInstance(n) {
			return n
		}
		p, _ := n.Get("parentId")
		cur, _ = p.(string)
	}
	return nil
}

// CopyOwner returns the instance when n is a generated copy inside it.
func CopyOwner(doc *Document, n *Node) *Node {
	if n.Str("type") == "page" || !n.Has("sourceId") {
		return nil
	}
	p, _ := n.Get("parentId")
	return InstanceOwner(doc, p)
}

func fnv32(s string) uint32 {
	h := uint32(0x811c9dc5)
	for k := 0; k < len(s); k++ {
		h = (h ^ uint32(s[k])) * 16777619
	}
	return h
}

func pad7(s string) string {
	for len(s) < 7 {
		s = "0" + s
	}
	return s
}

// CopyID is the deterministic id of the copy of srcID inside instance instID.
func CopyID(instID, srcID string) string {
	a := pad7(strconv.FormatUint(uint64(fnv32(instID+"/"+srcID)), 36))
	b := pad7(strconv.FormatUint(uint64(fnv32(srcID+"/"+instID)), 36))
	prefix := instID
	if len(prefix) > 40 {
		prefix = prefix[:40]
	}
	return prefix + "-" + a + b
}

func jsonEqual(a, b any) bool { return jsonv.Stringify(a, "") == jsonv.Stringify(b, "") }

func sourceValue(n *Node, key string) any {
	if n == nil {
		return nil
	}
	v, ok := n.Get(key)
	if !ok {
		return nil
	}
	return v
}

// setOverride records an override on inst (nil, or equal to the component, removes it).
func setOverride(inst *Node, srcID, key string, v any, src *Node) {
	all := jsonv.NewObject()
	if o := inst.Obj("overrides"); o != nil {
		all = o.Spread()
	}
	ov := jsonv.NewObject()
	if o := all.Obj(srcID); o != nil {
		ov = o.Spread()
	}
	if v == nil || jsonEqual(v, sourceValue(src, key)) {
		ov.Delete(key)
	} else {
		ov.Set(key, jsonv.Clone(v))
	}
	if ov.Len() > 0 {
		all.Set(srcID, ov)
	} else {
		all.Delete(srcID)
	}
	if all.Len() > 0 {
		inst.Set("overrides", all)
	} else {
		inst.Delete("overrides")
	}
}

func scaleGeometry(n *jsonv.Object, s float64, withPosition bool) {
	if s == 1 {
		return
	}
	sc := func(v any) any {
		if f, ok := v.(float64); ok {
			return Round4(f * s)
		}
		return v
	}
	if n.Str("type") == "path" && !n.Has("viewBox") {
		w, wok := n.Get("width")
		h, hok := n.Get("height")
		wf, wnum := w.(float64)
		hf, hnum := h.(float64)
		if wok && hok && wnum && hnum {
			n.Set("viewBox", []any{0.0, 0.0, wf, hf})
		}
	}
	if withPosition {
		x, _ := n.Get("x")
		y, _ := n.Get("y")
		n.Set("x", sc(x))
		n.Set("y", sc(y))
	}
	for _, k := range []string{"width", "height", "radius", "letterSpacing", "fontSize"} {
		v, ok := n.Get(k)
		if !ok {
			continue
		}
		if k == "radius" {
			if arr, isArr := v.([]any); isArr {
				out := make([]any, len(arr))
				for i, item := range arr {
					out[i] = sc(item)
				}
				n.Set(k, out)
				continue
			}
		}
		n.Set(k, sc(v))
	}
	if runs := n.Arr("runs"); len(runs) > 0 {
		out := make([]any, len(runs))
		for i, item := range runs {
			o, ok := item.(*jsonv.Object)
			if !ok {
				out[i] = item
				continue
			}
			o = o.Spread()
			if fs, ok := o.Get("fontSize"); ok {
				o.Set("fontSize", sc(fs))
			}
			out[i] = o
		}
		n.Set("runs", out)
	}
	if st := n.Obj("stroke"); st != nil {
		st = st.Spread()
		w, _ := st.Get("width")
		st.Set("width", sc(w))
		n.Set("stroke", st)
	}
	if sh := n.Obj("shadow"); sh != nil {
		sh = sh.Spread()
		for _, k := range []string{"x", "y", "blur", "spread"} {
			v, _ := sh.Get(k)
			sh.Set(k, sc(v))
		}
		n.Set("shadow", sh)
	} else if arr := n.Arr("shadow"); len(arr) > 0 {
		out := make([]any, len(arr))
		for i, item := range arr {
			o, ok := item.(*jsonv.Object)
			if !ok {
				out[i] = item
				continue
			}
			o = o.Spread()
			for _, k := range []string{"x", "y", "blur", "spread"} {
				v, _ := o.Get(k)
				o.Set(k, sc(v))
			}
			out[i] = o
		}
		n.Set("shadow", out)
	}
	if ol := n.Obj("outline"); ol != nil {
		ol = ol.Spread()
		w, _ := ol.Get("width")
		ol.Set("width", sc(w))
		if off, ok := ol.Get("offset"); ok {
			ol.Set("offset", sc(off))
		}
		n.Set("outline", ol)
	}
	for _, key := range []string{"filter", "backdropFilter"} {
		fx := n.Obj(key)
		if fx == nil {
			continue
		}
		if _, ok := fx.Get("blur"); !ok {
			continue
		}
		fx = fx.Spread()
		b, _ := fx.Get("blur")
		fx.Set("blur", sc(b))
		n.Set(key, fx)
	}
	if l := n.Obj("layout"); l != nil {
		l = l.Spread()
		g, _ := l.Get("gap")
		l.Set("gap", sc(g))
		p, _ := l.Get("padding")
		if arr, ok := p.([]any); ok {
			out := make([]any, len(arr))
			for k, v := range arr {
				out[k] = sc(v)
			}
			l.Set("padding", out)
		} else {
			l.Set("padding", sc(p))
		}
		n.Set("layout", l)
	}
}

// copyEnd: a component node becomes its copy; a free point scales with the instance.
func copyEnd(e *jsonv.Object, instID string, inComp map[string]bool, s float64) *jsonv.Object {
	out := e.Spread()
	if v, ok := out.Get("nodeId"); ok {
		if id, isStr := v.(string); isStr && inComp[id] {
			out.Set("nodeId", CopyID(instID, id))
		}
	}
	if s != 1 {
		for _, k := range []string{"x", "y"} {
			if v, ok := out.Get(k); ok {
				if f, isNum := v.(float64); isNum {
					out.Set(k, Round4(f*s))
				}
			}
		}
	}
	return out
}

func descendants(doc *Document, id string) []string {
	var out []string
	var walk func(nid string)
	walk = func(nid string) {
		n := GetNode(doc, nid)
		if n == nil || !IsContainer(n.Str("type")) {
			return
		}
		for _, c := range n.Strings("children") {
			out = append(out, c)
			walk(c)
		}
	}
	walk(id)
	return out
}

// errInstance is a component rule failure without an op index (the caller adds it).
type errInstance struct{ msg string }

func (e *errInstance) Error() string { return e.msg }

func instErr(format string, a ...any) error { return &errInstance{fmt.Sprintf(format, a...)} }

// DetachOps turns instances into plain frames (the copies keep their ids), as updates only.
func DetachOps(doc *Document, ids []string) ([]any, error) {
	if len(ids) == 0 {
		return nil, errors.New("pass at least one instance id")
	}
	ops := []any{}
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		n := GetNode(doc, id)
		if n == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, id)
		}
		if !IsInstance(n) {
			return nil, fmt.Errorf(`node "%s" is not an instance (a frame with instanceOf)`, id)
		}
		ops = append(ops, jsonv.NewObject("op", "update", "id", id, "props", jsonv.NewObject("instanceOf", nil, "scale", nil, "overrides", nil, "propValues", nil, "slots", nil)))
		for _, d := range descendants(doc, id) {
			ops = append(ops, jsonv.NewObject("op", "update", "id", d, "props", jsonv.NewObject("sourceId", nil)))
		}
	}
	return ops, nil
}
