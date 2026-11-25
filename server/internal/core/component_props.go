package core

import (
	"fmt"
	"strings"

	z "github.com/leonardo-moraes360/paprika/server/internal/zod"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func asObj(v any) *jsonv.Object {
	o, _ := v.(*jsonv.Object)
	return o
}

func num64(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok
}

func owningComponent(doc *Document, id string) *Node {
	n := GetNode(doc, id)
	if n == nil {
		return nil
	}
	cur, _ := n.Get("parentId")
	for {
		s, ok := cur.(string)
		if !ok || s == "" {
			return nil
		}
		p := GetNode(doc, s)
		if p == nil {
			return nil
		}
		if IsInstance(p) {
			return nil
		}
		if p.Str("type") == "frame" && p.Bool("component") {
			return p
		}
		cur, _ = p.Get("parentId")
	}
}

func insideOf(doc *Document, id, ancestor string) bool {
	for id != "" {
		if id == ancestor {
			return true
		}
		n := GetNode(doc, id)
		if n == nil {
			return false
		}
		p, _ := n.Get("parentId")
		id, _ = p.(string)
	}
	return false
}

func subtreeHas(doc *Document, root, target string) bool {
	if root == target {
		return true
	}
	n := GetNode(doc, root)
	if n == nil || !IsContainer(n.Str("type")) {
		return false
	}
	for _, c := range n.Strings("children") {
		if subtreeHas(doc, c, target) {
			return true
		}
	}
	return false
}

func componentRefs(doc *Document, compID string) []string {
	var out []string
	var walk func(id string)
	walk = func(id string) {
		n := GetNode(doc, id)
		if n == nil || !IsContainer(n.Str("type")) {
			return
		}
		for _, c := range n.Strings("children") {
			ch := GetNode(doc, c)
			if ch == nil || ch.Has("sourceId") {
				continue
			}
			if IsInstance(ch) {
				out = append(out, ch.Str("instanceOf"))
				continue
			}
			walk(c)
		}
	}
	walk(compID)
	return out
}

func checkCycles(doc *Document) error {
	edges := map[string][]string{}
	var comps []string
	for _, id := range Nodes(doc).Keys() {
		n := GetNode(doc, id)
		if n != nil && n.Str("type") == "frame" && n.Bool("component") {
			comps = append(comps, id)
			edges[id] = componentRefs(doc, id)
		}
	}
	color := map[string]int{}
	var stack []string
	var dfs func(string) error
	dfs = func(id string) error {
		color[id] = 1
		stack = append(stack, id)
		for _, next := range edges[id] {
			if _, ok := edges[next]; !ok {
				continue
			}
			switch color[next] {
			case 1:
				i := 0
				for k, s := range stack {
					if s == next {
						i = k
						break
					}
				}
				parts := append(append([]string{}, stack[i:]...), next)
				quoted := make([]string, len(parts))
				for k, s := range parts {
					quoted[k] = `"` + s + `"`
				}
				return instErr("component cycle: %s", strings.Join(quoted, " → "))
			case 0:
				if err := dfs(next); err != nil {
					return err
				}
			}
		}
		stack = stack[:len(stack)-1]
		color[id] = 2
		return nil
	}
	for _, id := range comps {
		if color[id] == 0 {
			if err := dfs(id); err != nil {
				return err
			}
		}
	}
	return nil
}

func definitionSlots(doc *Document, compID string) (map[string]string, error) {
	out := map[string]string{}
	var walk func(string) error
	walk = func(id string) error {
		n := GetNode(doc, id)
		if n == nil || !IsContainer(n.Str("type")) {
			return nil
		}
		for _, c := range n.Strings("children") {
			ch := GetNode(doc, c)
			if ch == nil || ch.Has("sourceId") {
				continue
			}
			if slot := ch.Str("slot"); slot != "" {
				if _, ok := out[slot]; ok {
					return instErr(`component "%s": duplicate slot "%s"`, compID, slot)
				}
				out[slot] = ch.Str("id")
			}
			if !IsInstance(ch) {
				if err := walk(c); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk(compID); err != nil {
		return nil, err
	}
	return out, nil
}

func checkPropDecls(comp *Node) error {
	seen := map[string]bool{}
	for _, raw := range comp.Arr("componentProps") {
		p := asObj(raw)
		if p == nil {
			continue
		}
		name := p.Str("name")
		if seen[name] {
			return instErr(`component "%s": duplicate prop "%s"`, comp.Str("id"), name)
		}
		seen[name] = true
		switch p.Str("type") {
		case "text":
			if v, ok := p.Get("default"); ok {
				if _, isStr := v.(string); !isStr {
					return instErr(`component "%s": text prop "%s" default must be text`, comp.Str("id"), name)
				}
			}
		case "boolean":
			if v, ok := p.Get("default"); ok {
				if _, isBool := v.(bool); !isBool {
					return instErr(`component "%s": boolean prop "%s" default must be boolean`, comp.Str("id"), name)
				}
			}
		case "variant":
			opts := p.Arr("options")
			if len(opts) == 0 {
				return instErr(`component "%s": variant "%s" needs options`, comp.Str("id"), name)
			}
			def, ok := p.Get("default")
			ds, isStr := def.(string)
			found := false
			if isStr {
				for _, o := range opts {
					if o == ds {
						found = true
					}
				}
			}
			shown := "undefined"
			if ok {
				shown = fmt.Sprint(def)
			}
			if !ok || !found {
				return instErr(`component "%s": variant "%s" default "%s" is not an option`, comp.Str("id"), name, shown)
			}
		}
	}
	return nil
}

func bindOutsideMessage(doc *Document, id string) string {
	inInstance := ""
	if n := GetNode(doc, id); n != nil {
		for cur := n.Str("parentId"); cur != ""; {
			a := GetNode(doc, cur)
			if a == nil {
				break
			}
			if IsInstance(a) {
				inInstance = a.Str("id")
				break
			}
			cur = a.Str("parentId")
		}
	}
	why := "none of its ancestors is a component"
	if inInstance != "" {
		why = fmt.Sprintf(`it sits inside the instance "%s", and a bind belongs on the component's own nodes`, inInstance)
	}
	return fmt.Sprintf(`"%s" has a bind outside a component: %s; the frame that contains it must be a component (component: true, or create_component) when the transaction ends`, id, why)
}

func validateBind(comp, n *Node) error {
	b := n.Obj("bind")
	if b == nil {
		return nil
	}
	props := map[string]*jsonv.Object{}
	for _, raw := range comp.Arr("componentProps") {
		p := asObj(raw)
		if p != nil {
			props[p.Str("name")] = p
		}
	}
	if name := b.Str("text"); name != "" {
		p := props[name]
		if p == nil || p.Str("type") != "text" {
			return instErr(`component "%s": "%s" binds text prop "%s", which is not a text prop`, comp.Str("id"), n.Str("id"), name)
		}
		if typ := n.Str("type"); typ != "text" && typ != "shape" {
			return instErr(`component "%s": "%s" binds text, but only text and shape nodes can`, comp.Str("id"), n.Str("id"))
		}
	}
	if name := b.Str("visible"); name != "" {
		p := props[name]
		if p == nil || p.Str("type") != "boolean" {
			return instErr(`component "%s": "%s" binds visible prop "%s", which is not a boolean prop`, comp.Str("id"), n.Str("id"), name)
		}
	}
	if vr := b.Obj("variant"); vr != nil {
		for _, k := range vr.Keys() {
			want := vr.Str(k)
			p := props[k]
			okOpt := false
			if p != nil && p.Str("type") == "variant" {
				for _, o := range p.Arr("options") {
					if o == want {
						okOpt = true
					}
				}
			}
			if !okOpt {
				return instErr(`component "%s": "%s" variant bind "%s=%s" does not match a variant prop`, comp.Str("id"), n.Str("id"), k, want)
			}
		}
	}
	return nil
}

func validateInstanceValues(doc *Document, inst, comp *Node) error {
	byName := map[string]*jsonv.Object{}
	for _, raw := range comp.Arr("componentProps") {
		p := asObj(raw)
		if p != nil {
			byName[p.Str("name")] = p
		}
	}
	if pv := inst.Obj("propValues"); pv != nil {
		for _, k := range pv.Keys() {
			p := byName[k]
			v, _ := pv.Get(k)
			if p == nil {
				return instErr(`instance "%s": unknown prop "%s"`, inst.Str("id"), k)
			}
			switch p.Str("type") {
			case "boolean":
				if _, ok := v.(bool); !ok {
					return instErr(`instance "%s": prop "%s" expects a boolean`, inst.Str("id"), k)
				}
			case "variant":
				s, ok := v.(string)
				if !ok {
					return instErr(`instance "%s": prop "%s" expects text`, inst.Str("id"), k)
				}
				found := false
				for _, o := range p.Arr("options") {
					if o == s {
						found = true
					}
				}
				if !found {
					return instErr(`instance "%s": prop "%s" value "%s" is not an option`, inst.Str("id"), k, s)
				}
			default:
				if _, ok := v.(string); !ok {
					return instErr(`instance "%s": prop "%s" expects text`, inst.Str("id"), k)
				}
			}
		}
	}
	slots, err := definitionSlots(doc, comp.Str("id"))
	if err != nil {
		return err
	}
	if sl := inst.Obj("slots"); sl != nil {
		for _, name := range sl.Keys() {
			if _, ok := slots[name]; !ok {
				return instErr(`instance "%s": unknown slot "%s"`, inst.Str("id"), name)
			}
			for _, id := range sl.Strings(name) {
				node := GetNode(doc, id)
				if node == nil || node.Str("type") == "page" {
					return instErr(`instance "%s": slot "%s" node "%s" does not exist`, inst.Str("id"), name, id)
				}
				if insideOf(doc, id, inst.Str("id")) || subtreeHas(doc, id, inst.Str("id")) {
					return instErr(`instance "%s": slot "%s" node "%s" is inside the instance`, inst.Str("id"), name, id)
				}
			}
		}
	}
	return nil
}

func resolvedProps(comp, inst *Node) map[string]any {
	given := inst.Obj("propValues")
	out := map[string]any{}
	for _, raw := range comp.Arr("componentProps") {
		p := asObj(raw)
		if p == nil {
			continue
		}
		name := p.Str("name")
		if given != nil {
			if v, ok := given.Get(name); ok {
				out[name] = v
				continue
			}
		}
		if v, ok := p.Get("default"); ok {
			out[name] = v
			continue
		}
		switch p.Str("type") {
		case "boolean":
			out[name] = false
		case "text":
			out[name] = ""
		default:
			if opts := p.Arr("options"); len(opts) > 0 {
				out[name] = opts[0]
			} else {
				out[name] = ""
			}
		}
	}
	return out
}

func variantShows(bind *jsonv.Object, values map[string]any) bool {
	if bind == nil {
		return true
	}
	vr := bind.Obj("variant")
	if vr == nil {
		return true
	}
	for _, k := range vr.Keys() {
		want, _ := vr.Get(k)
		if values[k] != want {
			return false
		}
	}
	return true
}

func applyBind(n *jsonv.Object, values map[string]any) {
	b := n.Obj("bind")
	if b == nil {
		return
	}
	if name := b.Str("text"); name != "" && (n.Str("type") == "text" || n.Str("type") == "shape") {
		if s, ok := values[name].(string); ok {
			n.Set("text", s)
		}
	}
	if name := b.Str("visible"); name != "" {
		if v, ok := values[name].(bool); ok {
			n.Set("visible", v)
		}
	}
}

func mergeOverrides(base, extra *jsonv.Object) *jsonv.Object {
	all := jsonv.NewObject()
	if base != nil {
		for _, k := range base.Keys() {
			v, _ := base.Get(k)
			all.Set(k, jsonv.Clone(v))
		}
	}
	if extra != nil {
		for _, k := range extra.Keys() {
			src := extra.Obj(k)
			prev := all.Obj(k)
			if prev == nil {
				prev = jsonv.NewObject()
			} else {
				prev = prev.Spread()
			}
			if src != nil {
				for _, fk := range src.Keys() {
					v, _ := src.Get(fk)
					prev.Set(fk, jsonv.Clone(v))
				}
			}
			if prev.Len() > 0 {
				all.Set(k, prev)
			} else {
				all.Delete(k)
			}
		}
	}
	if all.Len() == 0 {
		return nil
	}
	return all
}

func ownedBy(doc *Document, nodeID, instID string) bool {
	cur := InstanceOwner(doc, nodeID)
	for cur != nil {
		if cur.Str("id") == instID {
			return true
		}
		if !cur.Has("sourceId") {
			return false
		}
		p, _ := cur.Get("parentId")
		ps, _ := p.(string)
		cur = InstanceOwner(doc, ps)
	}
	return false
}

func definitionIDs(doc *Document, compID string) map[string]bool {
	out := map[string]bool{}
	var walk func(string)
	walk = func(id string) {
		n := GetNode(doc, id)
		if n == nil || !IsContainer(n.Str("type")) {
			return
		}
		for _, c := range n.Strings("children") {
			ch := GetNode(doc, c)
			if ch == nil || ch.Has("sourceId") {
				continue
			}
			out[c] = true
			if !IsInstance(ch) {
				walk(c)
			}
		}
	}
	walk(compID)
	return out
}

func overrideAllowed(doc *Document, comp *Node, srcID, key string) bool {
	if srcID == comp.Str("id") {
		return key == "fill"
	}
	if key == "propValues" || key == "slots" {
		head, _, _ := strings.Cut(srcID, "/")
		return IsInstance(GetNode(doc, head))
	}
	return inList(CopyOverrides, key)
}

func parseNode(n *jsonv.Object) (*jsonv.Object, error) {
	parsed, err := z.Parse(NodeSchema, n)
	if err != nil {
		return nil, err
	}
	return parsed.(*jsonv.Object), nil
}

type builtTree struct {
	root  *jsonv.Object
	nodes []*jsonv.Object
}

func materialize(doc *Document, inst *Node) (*builtTree, error) {
	comp := GetNode(doc, inst.Str("instanceOf"))
	s := 1.0
	if v, ok := inst.Get("scale"); ok {
		if f, isNum := num64(v); isNum {
			s = f
		}
	}
	overrides := inst.Obj("overrides")
	if overrides == nil {
		overrides = jsonv.NewObject()
	}
	values := resolvedProps(comp, inst)
	for _, srcID := range overrides.Keys() {
		ov := overrides.Obj(srcID)
		if ov == nil {
			continue
		}
		for _, k := range ov.Keys() {
			if !overrideAllowed(doc, comp, srcID, k) {
				return nil, instErr(`instance "%s": override "%s" in "%s" is not allowed (root: fill; copies: %s; instance path: propValues, slots)`, inst.Str("id"), k, srcID, strings.Join(CopyOverrides, ", "))
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
	if ro := overrides.Obj(comp.Str("id")); ro != nil && ro.Has("fill") {
		f, _ := ro.Get("fill")
		root.Set("fill", jsonv.Clone(f))
	}
	parsedRoot, err := parseNode(root)
	if err != nil {
		return nil, instErr(`instance "%s": invalid override on the root: %s`, inst.Str("id"), formatZod(err))
	}
	inComp := definitionIDs(doc, comp.Str("id"))
	var want []*jsonv.Object
	claim := func(id, srcID string) error {
		ex := GetNode(doc, id)
		if ex == nil {
			return nil
		}
		p, _ := ex.Get("parentId")
		ps, _ := p.(string)
		src, _ := ex.Get("sourceId")
		ss, _ := src.(string)
		if ex.Str("type") == "page" || ss != srcID || !ownedBy(doc, ps, inst.Str("id")) {
			return instErr(`instance "%s": the generated id "%s" is already used by another node`, inst.Str("id"), id)
		}
		return nil
	}
	var copyFn func(srcID, parentID string) (string, bool, error)
	var nest func(src *Node, srcID, id, parentID string) (string, error)
	var cloneSlot func(slotFrameID, parentID string, ids []string) ([]any, error)
	copyFn = func(srcID, parentID string) (string, bool, error) {
		src := GetNode(doc, srcID)
		if src == nil || src.Has("sourceId") {
			return "", false, nil
		}
		if !variantShows(src.Obj("bind"), values) {
			return "", false, nil
		}
		id := CopyID(inst.Str("id"), srcID)
		if err := claim(id, srcID); err != nil {
			return "", false, err
		}
		if IsInstance(src) {
			nid, err := nest(src, srcID, id, parentID)
			return nid, err == nil, err
		}
		n := jsonv.Clone(src).(*jsonv.Object)
		n.Set("id", id)
		n.Set("parentId", parentID)
		n.Set("sourceId", srcID)
		n.Delete("component")
		scaleGeometry(n, s, true)
		if n.Str("type") == "connector" {
			if s != 1 {
				if ctl := n.Obj("control"); ctl != nil {
					ctl = ctl.Spread()
					if x, ok := num64(mustGet(ctl, "x")); ok {
						ctl.Set("x", Round4(x*s))
					}
					if y, ok := num64(mustGet(ctl, "y")); ok {
						ctl.Set("y", Round4(y*s))
					}
					n.Set("control", ctl)
				}
			}
			for _, k := range []string{"from", "to"} {
				if e := n.Obj(k); e != nil {
					n.Set(k, copyEnd(e, inst.Str("id"), inComp, s))
				}
			}
		}
		applyBind(n, values)
		if ov := overrides.Obj(srcID); ov != nil {
			for _, k := range ov.Keys() {
				v, _ := ov.Get(k)
				n.Set(k, jsonv.Clone(v))
			}
		}
		slot := len(want)
		want = append(want, nil)
		if slotName := src.Str("slot"); slotName != "" && inst.Obj("slots") != nil && inst.Obj("slots").Has(slotName) {
			kids, err := cloneSlot(srcID, id, inst.Obj("slots").Strings(slotName))
			if err != nil {
				return "", false, err
			}
			n.Set("children", kids)
		} else if IsContainer(src.Str("type")) {
			kids := []any{}
			for _, c := range src.Strings("children") {
				cid, ok, err := copyFn(c, id)
				if err != nil {
					return "", false, err
				}
				if ok {
					kids = append(kids, cid)
				}
			}
			n.Set("children", kids)
		}
		parsed, err := parseNode(n)
		if err != nil {
			return "", false, instErr(`instance "%s": invalid override on "%s": %s`, inst.Str("id"), srcID, formatZod(err))
		}
		want[slot] = parsed
		return id, true, nil
	}
	nest = func(src *Node, srcID, id, parentID string) (string, error) {
		n := jsonv.Clone(src).(*jsonv.Object)
		n.Set("id", id)
		n.Set("parentId", parentID)
		n.Set("sourceId", srcID)
		n.Delete("component")
		own := overrides.Obj(srcID)
		prefix := srcID + "/"
		nested := jsonv.NewObject()
		for _, k := range overrides.Keys() {
			if strings.HasPrefix(k, prefix) {
				nested.Set(k[len(prefix):], jsonv.Clone(overrides.Obj(k)))
			}
		}
		merged := mergeOverrides(src.Obj("overrides"), nested)
		if own != nil && own.Has("fill") {
			fill, _ := own.Get("fill")
			merged = mergeOverrides(merged, jsonv.NewObject(src.Str("instanceOf"), jsonv.NewObject("fill", jsonv.Clone(fill))))
		}
		if merged != nil {
			n.Set("overrides", merged)
		} else {
			n.Delete("overrides")
		}
		applyBind(n, values)
		if own != nil {
			for _, k := range own.Keys() {
				if k == "fill" {
					continue
				}
				if k == "propValues" || k == "slots" || inList(CopyOverrides, k) {
					v, _ := own.Get(k)
					n.Set(k, jsonv.Clone(v))
				}
			}
		}
		inner := 1.0
		if v, ok := n.Get("scale"); ok {
			if f, isNum := num64(v); isNum {
				inner = f
			}
		}
		eff := Round4(inner * s)
		if eff != 1 {
			n.Set("scale", eff)
		} else {
			n.Delete("scale")
		}
		if s != 1 {
			if x, ok := num64(mustGet(n, "x")); ok {
				n.Set("x", Round4(x*s))
			}
			if y, ok := num64(mustGet(n, "y")); ok {
				n.Set("y", Round4(y*s))
			}
		}
		n.Set("children", []any{})
		shell, err := parseNode(n)
		if err != nil {
			return "", instErr(`instance "%s": invalid override on "%s": %s`, inst.Str("id"), srcID, formatZod(err))
		}
		if shell.Str("type") != "frame" || !IsInstance(shell) {
			return "", instErr(`instance "%s": invalid override on "%s": not an instance`, inst.Str("id"), srcID)
		}
		innerTree, err := materialize(doc, shell)
		if err != nil {
			return "", err
		}
		want = append(want, innerTree.root)
		want = append(want, innerTree.nodes...)
		return innerTree.root.Str("id"), nil
	}
	cloneSlot = func(slotFrameID, parentID string, ids []string) ([]any, error) {
		mapped := map[string]string{}
		var index func(string)
		index = func(nid string) {
			node := GetNode(doc, nid)
			if node == nil || node.Str("type") == "page" {
				return
			}
			mapped[nid] = CopyID(inst.Str("id"), slotFrameID+"/"+nid)
			if IsContainer(node.Str("type")) && !IsInstance(node) {
				for _, c := range node.Strings("children") {
					index(c)
				}
			}
		}
		for _, id := range ids {
			index(id)
		}
		var walk func(nid, parent string) (string, error)
		walk = func(nid, parent string) (string, error) {
			src := GetNode(doc, nid)
			if src == nil || src.Str("type") == "page" {
				return "", instErr(`instance "%s": slot node "%s" does not exist`, inst.Str("id"), nid)
			}
			path := slotFrameID + "/" + nid
			id := mapped[nid]
			if err := claim(id, path); err != nil {
				return "", err
			}
			if IsInstance(src) {
				return nest(src, path, id, parent)
			}
			n := jsonv.Clone(src).(*jsonv.Object)
			n.Set("id", id)
			n.Set("parentId", parent)
			n.Set("sourceId", path)
			n.Delete("component")
			scaleGeometry(n, s, true)
			if n.Str("type") == "connector" {
				for _, k := range []string{"from", "to"} {
					if e := n.Obj(k); e != nil {
						end := e.Spread()
						if nid, ok := end.Get("nodeId"); ok {
							if id, isStr := nid.(string); isStr {
								if next, ok := mapped[id]; ok {
									end.Set("nodeId", next)
								}
							}
						}
						if s != 1 {
							if x, ok := num64(mustGet(end, "x")); ok {
								end.Set("x", Round4(x*s))
							}
							if y, ok := num64(mustGet(end, "y")); ok {
								end.Set("y", Round4(y*s))
							}
						}
						n.Set(k, end)
					}
				}
				if s != 1 {
					if ctl := n.Obj("control"); ctl != nil {
						ctl = ctl.Spread()
						if x, ok := num64(mustGet(ctl, "x")); ok {
							ctl.Set("x", Round4(x*s))
						}
						if y, ok := num64(mustGet(ctl, "y")); ok {
							ctl.Set("y", Round4(y*s))
						}
						n.Set("control", ctl)
					}
				}
			}
			if ov := overrides.Obj(path); ov != nil {
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
					cid, err := walk(c, id)
					if err != nil {
						return "", err
					}
					kids = append(kids, cid)
				}
				n.Set("children", kids)
			}
			parsed, err := parseNode(n)
			if err != nil {
				return "", instErr(`instance "%s": invalid override on "%s": %s`, inst.Str("id"), path, formatZod(err))
			}
			want[slot] = parsed
			return id, nil
		}
		out := []any{}
		for _, id := range ids {
			cid, err := walk(id, parentID)
			if err != nil {
				return nil, err
			}
			out = append(out, cid)
		}
		return out, nil
	}
	children := []any{}
	for _, c := range comp.Strings("children") {
		cid, ok, err := copyFn(c, inst.Str("id"))
		if err != nil {
			return nil, err
		}
		if ok {
			children = append(children, cid)
		}
	}
	next := parsedRoot
	next.Set("children", children)
	return &builtTree{root: next, nodes: want}, nil
}

// SyncInstances checks the rules and rebuilds the copies of every instance.
func SyncInstances(doc *Document) error {
	for _, id := range Nodes(doc).Keys() {
		n := GetNode(doc, id)
		if n == nil || n.Str("type") == "page" {
			continue
		}
		isComp := n.Str("type") == "frame" && n.Bool("component")
		if isComp && IsInstance(n) {
			return instErr(`"%s" is an instance and cannot be a component`, id)
		}
		if n.Has("componentProps") && !isComp {
			return instErr(`"%s" has componentProps but is not a component`, id)
		}
		if n.Has("propValues") && !IsInstance(n) {
			return instErr(`"%s" has propValues but is not an instance`, id)
		}
		if n.Has("slots") && !IsInstance(n) {
			return instErr(`"%s" has slots but is not an instance`, id)
		}
		if isComp {
			if err := checkPropDecls(n); err != nil {
				return err
			}
			if _, err := definitionSlots(doc, id); err != nil {
				return err
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
			if err := validateInstanceValues(doc, n, c); err != nil {
				return err
			}
		}
		if n.Has("bind") && !n.Has("sourceId") && !isComp {
			owner := owningComponent(doc, id)
			if owner == nil {
				return instErr("%s", bindOutsideMessage(doc, id))
			}
			if err := validateBind(owner, n); err != nil {
				return err
			}
		}
		if n.Has("sourceId") && CopyOwner(doc, n) == nil {
			return instErr(`"%s" has a sourceId outside an instance; sourceId is generated by instances`, id)
		}
	}
	if err := checkCycles(doc); err != nil {
		return err
	}
	keys := Nodes(doc).Keys()
	for _, id := range keys {
		n := GetNode(doc, id)
		if IsInstance(n) && !n.Has("sourceId") {
			if err := buildInstance(doc, n); err != nil {
				return err
			}
		}
	}
	return nil
}

func buildInstance(doc *Document, inst *Node) error {
	tree, err := materialize(doc, inst)
	if err != nil {
		return err
	}
	instID := inst.Str("id")
	old := descendants(doc, instID)
	same := jsonEqual(tree.root, inst) && len(old) == len(tree.nodes)
	if same {
		for k, n := range tree.nodes {
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
	Nodes(doc).Set(instID, tree.root)
	for _, n := range tree.nodes {
		Nodes(doc).Set(n.Str("id"), n)
	}
	return nil
}

// OverrideFields are the fields an update on this node may turn into overrides.
func OverrideFields(node *Node) []string {
	if IsInstance(node) {
		return append(append([]string{}, CopyOverrides...), "propValues", "slots")
	}
	return CopyOverrides
}

// CopyOverrideTarget is the instance that stores a copy override and the path key.
func CopyOverrideTarget(doc *Document, node *Node) (*Node, string, bool) {
	owner := CopyOwner(doc, node)
	if owner == nil || !node.Has("sourceId") {
		return nil, "", false
	}
	key := node.Str("sourceId")
	inst := owner
	for inst.Has("sourceId") {
		key = inst.Str("sourceId") + "/" + key
		outer := CopyOwner(doc, inst)
		if outer == nil {
			return nil, "", false
		}
		inst = outer
	}
	return inst, key, true
}
