package core

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/component.ts: components (frames with component: true) and
// instances (frames with instanceOf), whose children are copies rebuilt at the end of every
// transaction.

// CopyOverrides are the fields of a copy that an instance can override.
var CopyOverrides = []string{"fill", "color", "text", "src", "alt", "visible", "opacity"}

// RootDerived are the fields of an instance root that come from the component.
var RootDerived = []string{"fill", "stroke", "radius", "shadow", "layout", "clip", "width", "height"}

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
		if v, ok := n.Get(k); ok {
			n.Set(k, sc(v))
		}
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

// SyncInstances checks the rules and rebuilds the copies of every instance.
func SyncInstances(doc *Document) error {
	keys := Nodes(doc).Keys()
	for _, id := range keys {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" {
			continue
		}
		isComp := n.Str("type") == "frame" && n.Bool("component")
		if isComp && IsInstance(n) {
			return instErr(`"%s" is an instance and cannot be a component`, id)
		}
		if isComp {
			for _, d := range descendants(doc, id) {
				if IsInstance(GetNode(doc, d)) {
					return instErr(`component "%s" contains the instance "%s"; instances inside components are not supported yet (detach it)`, id, d)
				}
			}
		}
		if IsInstance(n) {
			cid := n.Str("instanceOf")
			c := GetNode(doc, cid)
			if c == nil {
				return instErr(`instance "%s": component "%s" does not exist`, id, cid)
			}
			if c.Str("type") != "frame" || !c.Bool("component") {
				return instErr(`instance "%s": "%s" is not a component (set component: true on a frame)`, id, cid)
			}
		}
		if n.Has("sourceId") && CopyOwner(doc, n) == nil {
			return instErr(`"%s" has a sourceId outside an instance; sourceId is generated by instances`, id)
		}
	}
	for _, id := range keys {
		if n := GetNode(doc, id); IsInstance(n) {
			if err := buildInstance(doc, n); err != nil {
				return err
			}
		}
	}
	return nil
}

func buildInstance(doc *Document, inst *Node) error {
	comp := GetNode(doc, inst.Str("instanceOf"))
	compID := comp.Str("id")
	instID := inst.Str("id")
	s := 1.0
	if v, ok := inst.Get("scale"); ok {
		s, _ = v.(float64)
	}
	overrides := inst.Obj("overrides")
	if overrides == nil {
		overrides = jsonv.NewObject()
	}
	for _, srcID := range overrides.Keys() {
		for _, k := range overrides.Obj(srcID).Keys() {
			ok := inList(CopyOverrides, k)
			if srcID == compID {
				ok = k == "fill"
			}
			if !ok {
				return instErr(`instance "%s": override "%s" in "%s" is not allowed (root: fill; copies: %s)`, instID, k, srcID, strings.Join(CopyOverrides, ", "))
			}
		}
	}

	root := inst.Spread()
	for _, k := range RootDerived {
		if v, ok := comp.Get(k); ok {
			root.Set(k, jsonv.Clone(v))
		} else {
			root.Delete(k)
		}
	}
	scaleGeometry(root, s, false)
	if ro := overrides.Obj(compID); ro != nil && ro.Has("fill") {
		f, _ := ro.Get("fill")
		root.Set("fill", jsonv.Clone(f))
	}
	parsedRoot, err := z.Parse(NodeSchema, root)
	if err != nil {
		return instErr(`instance "%s": invalid override on the root: %s`, instID, formatZod(err))
	}

	inComp := map[string]bool{}
	for _, d := range descendants(doc, comp.Str("id")) {
		inComp[d] = true
	}
	var want []*jsonv.Object
	var copyFn func(srcID, parentID string) (string, error)
	copyFn = func(srcID, parentID string) (string, error) {
		src := GetNode(doc, srcID)
		id := CopyID(instID, srcID)
		if ex := GetNode(doc, id); ex != nil {
			p, _ := ex.Get("parentId")
			if ex.Str("type") == "page" || sourceValue(ex, "sourceId") != srcID || InstanceOwner(doc, p) != inst {
				return "", instErr(`instance "%s": the generated id "%s" is already used by another node`, instID, id)
			}
		}
		n := jsonv.Clone(src).(*jsonv.Object)
		n.Set("id", id)
		n.Set("parentId", parentID)
		n.Set("sourceId", srcID)
		n.Delete("component")
		scaleGeometry(n, s, true)
		// A connector inside the component attaches to the copies of the same instance.
		if n.Str("type") == "connector" {
			for _, k := range []string{"from", "to"} {
				if e := n.Obj(k); e != nil {
					n.Set(k, copyEnd(e, instID, inComp, s))
				}
			}
		}
		if ov := overrides.Obj(srcID); ov != nil {
			for _, k := range ov.Keys() {
				v, _ := ov.Get(k)
				n.Set(k, jsonv.Clone(v))
			}
		}
		slot := len(want)
		want = append(want, nil)
		if IsContainer(src.Str("type")) {
			kids := []any{}
			for _, c := range src.Strings("children") {
				cid, err := copyFn(c, id)
				if err != nil {
					return "", err
				}
				kids = append(kids, cid)
			}
			n.Set("children", kids)
		}
		parsed, err := z.Parse(NodeSchema, n)
		if err != nil {
			return "", instErr(`instance "%s": invalid override on "%s": %s`, instID, srcID, formatZod(err))
		}
		want[slot] = parsed.(*jsonv.Object)
		return id, nil
	}
	children := []any{}
	for _, c := range comp.Strings("children") {
		cid, err := copyFn(c, instID)
		if err != nil {
			return err
		}
		children = append(children, cid)
	}
	nextRoot := parsedRoot.(*jsonv.Object)
	nextRoot.Set("children", children)

	old := descendants(doc, instID)
	same := jsonEqual(nextRoot, inst) && len(old) == len(want)
	if same {
		for k, n := range want {
			if old[k] != n.Str("id") || !jsonEqual(GetNode(doc, old[k]), n) {
				same = false
				break
			}
		}
	}
	if same {
		return nil
	}
	for _, id := range old {
		Nodes(doc).Delete(id)
	}
	Nodes(doc).Set(instID, nextRoot)
	for _, n := range want {
		Nodes(doc).Set(n.Str("id"), n)
	}
	return nil
}

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
		ops = append(ops, jsonv.NewObject("op", "update", "id", id, "props", jsonv.NewObject("instanceOf", nil, "scale", nil, "overrides", nil)))
		for _, d := range descendants(doc, id) {
			ops = append(ops, jsonv.NewObject("op", "update", "id", d, "props", jsonv.NewObject("sourceId", nil)))
		}
	}
	return ops, nil
}
