package core

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

func tokenAlive(doc *Document, name string) bool {
	if Tokens(doc).Has(name) {
		return true
	}
	if modes := Modes(doc); modes != nil {
		for _, m := range modes.Keys() {
			if modes.Obj(m).Has(name) {
				return true
			}
		}
	}
	return false
}

func clearTokenMeta(doc *Document, name string) {
	meta := TokenMeta(doc)
	if meta == nil || !meta.Has(name) {
		return
	}
	meta.Delete(name)
	if meta.Len() == 0 {
		doc.Delete("tokenMeta")
	}
}

func writeTokenMeta(doc *Document, name string, typ any, hasType bool, collection any, hasCollection bool) {
	meta := TokenMeta(doc)
	if meta == nil {
		meta = jsonv.NewObject()
	}
	next := jsonv.NewObject()
	if cur := meta.Obj(name); cur != nil {
		for _, k := range cur.Keys() {
			v, _ := cur.Get(k)
			next.Set(k, v)
		}
	}
	if hasType {
		if typ == nil {
			next.Delete("type")
		} else {
			next.Set("type", typ)
		}
	}
	if hasCollection {
		if collection == nil {
			next.Delete("collection")
		} else {
			next.Set("collection", collection)
		}
	}
	if next.Len() == 0 {
		meta.Delete(name)
	} else {
		meta.Set(name, next)
	}
	if meta.Len() == 0 {
		doc.Delete("tokenMeta")
	} else {
		doc.Set("tokenMeta", meta)
	}
}

func shownJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func tokenAssignProblem(doc *Document, name string, value any, kind, mode string) string {
	literal := value
	if s, ok := value.(string); ok && strings.HasPrefix(s, "$") {
		resolved := ResolveValue(doc, s, mode)
		if t, ok := resolved.(string); ok && strings.HasPrefix(t, "$") {
			return fmt.Sprintf("token %q: %q does not resolve to a %s", name, s, kind)
		}
		if _, ok := resolved.(string); !ok {
			if _, ok := resolved.(float64); !ok {
				return fmt.Sprintf("token %q: %q does not resolve to a %s", name, s, kind)
			}
		}
		literal = resolved
	}
	shown := shownJSON(literal)
	switch kind {
	case "color":
		s, ok := literal.(string)
		if !ok {
			return fmt.Sprintf("token %q: type color expects a color, got %s", name, shown)
		}
		if _, ok := ParseColor(s); !ok {
			return fmt.Sprintf("token %q: type color expects a color, got %s", name, shown)
		}
	case "length":
		n, ok := literal.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return fmt.Sprintf("token %q: type length expects a number, got %s", name, shown)
		}
	case "fontFamily":
		s, ok := literal.(string)
		if !ok || s == "" || len(s) > 200 || reFontForbidden.MatchString(s) {
			return fmt.Sprintf("token %q: type fontFamily expects a font family, got %s", name, shown)
		}
	case "fontWeight":
		n, ok := literal.(float64)
		if !ok || n != math.Trunc(n) || n < 100 || n > 900 {
			return fmt.Sprintf("token %q: type fontWeight expects an integer from 100 to 900, got %s", name, shown)
		}
	case "fontSize":
		n, ok := literal.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 1 || n > 1000 {
			return fmt.Sprintf("token %q: type fontSize expects a number from 1 to 1000, got %s", name, shown)
		}
	case "lineHeight":
		n, ok := literal.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 10 {
			return fmt.Sprintf("token %q: type lineHeight expects a number from 0 to 10, got %s", name, shown)
		}
	case "letterSpacing":
		n, ok := literal.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
			return fmt.Sprintf("token %q: type letterSpacing expects a number, got %s", name, shown)
		}
	default:
		return fmt.Sprintf("token %q: unknown type %s", name, kind)
	}
	return ""
}

func applySetTokens(doc *Document, op *jsonv.Object, i int) (any, error) {
	mode := op.Str("mode")
	if mode == "__proto__" {
		return nil, fmt.Errorf("mode name cannot be __proto__")
	}
	prev := jsonv.NewObject()
	prevMeta := map[string]*jsonv.Object{}
	tokens := Tokens(doc)
	if mode != "" {
		modes := Modes(doc)
		if modes == nil {
			modes = jsonv.NewObject()
			doc.Set("modes", modes)
		}
		tokens = modes.Obj(mode)
		if tokens == nil {
			tokens = jsonv.NewObject()
			modes.Set(mode, tokens)
		}
	}
	in := op.Obj("tokens")
	keys := in.Keys()
	meta := TokenMeta(doc)
	for _, k := range keys {
		if meta != nil && meta.Obj(k) != nil {
			prevMeta[k] = jsonv.Clone(meta.Obj(k)).(*jsonv.Object)
		}
		v, _ := in.Get(k)
		if old, has := tokens.Get(k); has && old != nil {
			prev.Set(k, old)
		} else {
			prev.Set(k, nil)
		}
		if v == nil {
			tokens.Delete(k)
		} else {
			tokens.Set(k, v)
		}
	}
	_, hasType := op.Get("type")
	_, hasCollection := op.Get("collection")
	if hasType || hasCollection {
		var typ, collection any
		if hasType {
			typ, _ = op.Get("type")
		}
		if hasCollection {
			collection, _ = op.Get("collection")
		}
		for _, k := range keys {
			v, _ := in.Get(k)
			if v == nil {
				continue
			}
			writeTokenMeta(doc, k, typ, hasType, collection, hasCollection)
		}
	}
	for _, k := range keys {
		if !tokenAlive(doc, k) {
			clearTokenMeta(doc, k)
		}
	}
	for _, k := range keys {
		v, _ := in.Get(k)
		if v == nil {
			continue
		}
		kind := ""
		if m := TokenMeta(doc); m != nil && m.Obj(k) != nil {
			kind = m.Obj(k).Str("type")
		}
		if kind == "" {
			continue
		}
		if problem := tokenAssignProblem(doc, k, v, kind, mode); problem != "" {
			return nil, opErr(i, "%s", problem)
		}
	}
	if mode != "" {
		modes := Modes(doc)
		if tokens.Len() == 0 {
			modes.Delete(mode)
		}
		if modes.Len() == 0 {
			doc.Delete("modes")
		}
	}
	split := hasType || hasCollection
	if !split {
		for _, k := range keys {
			if prevMeta[k] != nil {
				split = true
				break
			}
		}
	}
	if !split {
		if mode != "" {
			return jsonv.NewObject("op", "set_tokens", "tokens", prev, "mode", mode), nil
		}
		return jsonv.NewObject("op", "set_tokens", "tokens", prev), nil
	}
	var inverse []any
	for _, k := range keys {
		was := prevMeta[k]
		died := !tokenAlive(doc, k)
		inv := jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject(k, mustToken(prev, k)))
		if mode != "" {
			inv.Set("mode", mode)
		}
		if hasType || (died && was != nil && was.Str("type") != "") {
			if was != nil && was.Has("type") {
				t, _ := was.Get("type")
				inv.Set("type", t)
			} else {
				inv.Set("type", nil)
			}
		}
		if hasCollection || (died && was != nil && was.Str("collection") != "") {
			if was != nil && was.Has("collection") {
				c, _ := was.Get("collection")
				inv.Set("collection", c)
			} else {
				inv.Set("collection", nil)
			}
		}
		inverse = append(inverse, inv)
	}
	return inverse, nil
}

func mustToken(obj *jsonv.Object, k string) any {
	v, _ := obj.Get(k)
	return v
}

var tokenFields = map[string]bool{
	"fill": true, "radius": true, "stroke": true, "stroke.color": true, "stroke.width": true,
	"shadow": true, "shadow.x": true, "shadow.y": true, "shadow.blur": true, "shadow.spread": true, "shadow.color": true,
	"outline": true, "outline.color": true, "outline.width": true, "outline.offset": true,
	"filter": true, "filter.blur": true, "backdropFilter": true, "backdropFilter.blur": true,
	"layout": true, "layout.gap": true, "layout.padding": true,
	"color": true, "fontFamily": true, "fontSize": true, "fontWeight": true, "lineHeight": true, "letterSpacing": true,
}

func fieldOn(fields map[string]bool, name string) bool {
	if fields == nil {
		return true
	}
	if fields[name] {
		return true
	}
	head, _, _ := strings.Cut(name, ".")
	return fields[head]
}

func detachScalar(doc *Document, id, field string, value any, mode, kind string, opIndex int) (any, bool, error) {
	s, ok := value.(string)
	if !ok || !strings.HasPrefix(s, "$") {
		return value, false, nil
	}
	resolved := ResolveValue(doc, s, mode)
	if t, ok := resolved.(string); ok && strings.HasPrefix(t, "$") {
		return nil, false, opErr(opIndex, "node %q %s: token %q does not resolve", id, field, s)
	}
	if kind == "number" {
		if _, ok := resolved.(float64); !ok {
			return nil, false, opErr(opIndex, "node %q %s: token %q resolved to %s, expected a length", id, field, s, shownJSON(resolved))
		}
	}
	if kind == "string" {
		if _, ok := resolved.(string); !ok {
			return nil, false, opErr(opIndex, "node %q %s: token %q resolved to %s, expected text", id, field, s, shownJSON(resolved))
		}
	}
	return resolved, true, nil
}

func applyDetachTokens(doc *Document, op *jsonv.Object, i int, created *[]string) (any, error) {
	var picked map[string]bool
	if op.Has("fields") {
		picked = map[string]bool{}
		for _, f := range op.Strings("fields") {
			if !tokenFields[f] {
				return nil, opErr(i, "field %q cannot hold a token", f)
			}
			picked[f] = true
		}
	}
	var inverse []any
	changed := 0
	for _, id := range op.Strings("ids") {
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, "node %q does not exist", id)
		}
		if owner := CopyOwner(doc, node); owner != nil {
			return nil, opErr(i, "%s", copyRule(id, owner.Str("id")))
		}
		props, err := detachTokenProps(doc, node, picked, i)
		if err != nil {
			return nil, err
		}
		if props == nil || props.Len() == 0 {
			continue
		}
		changed++
		parsed, perr := z.Parse(OpSchema, jsonv.NewObject("op", "update", "id", id, "props", props))
		if perr != nil {
			return nil, opErr(i, "invalid operation: %s", formatZod(perr))
		}
		inv, aerr := applyOne(doc, parsed.(*jsonv.Object), i, created)
		if aerr != nil {
			return nil, aerr
		}
		inverse = append(flatten(inv), inverse...)
	}
	if changed == 0 {
		ids := op.Strings("ids")
		quoted := make([]string, len(ids))
		for n, id := range ids {
			quoted[n] = fmt.Sprintf("%q", id)
		}
		return nil, opErr(i, "no token to detach on %s", strings.Join(quoted, ", "))
	}
	return inverse, nil
}

func detachTokenProps(doc *Document, node *Node, fields map[string]bool, opIndex int) (*jsonv.Object, error) {
	id := node.Str("id")
	mode := ModeOf(doc, node)
	props := jsonv.NewObject()
	on := func(name string) bool { return fieldOn(fields, name) }
	take := func(field, kind string, value any) (any, bool, error) {
		return detachScalar(doc, id, field, value, mode, kind, opIndex)
	}
	if node.Has("fill") && on("fill") {
		v, _ := node.Get("fill")
		if v != nil {
			got, changed, err := take("fill", "string", v)
			if err != nil {
				return nil, err
			}
			if changed {
				props.Set("fill", got)
			}
		}
	}
	for _, key := range []string{"color", "fontFamily"} {
		if node.Has(key) && on(key) {
			v, _ := node.Get(key)
			got, changed, err := take(key, "string", v)
			if err != nil {
				return nil, err
			}
			if changed {
				props.Set(key, got)
			}
		}
	}
	for _, key := range []string{"fontSize", "fontWeight", "lineHeight", "letterSpacing"} {
		if node.Has(key) && on(key) {
			v, _ := node.Get(key)
			got, changed, err := take(key, "number", v)
			if err != nil {
				return nil, err
			}
			if changed {
				props.Set(key, got)
			}
		}
	}
	if node.Has("radius") && on("radius") {
		v, _ := node.Get("radius")
		if arr, ok := v.([]any); ok {
			changed := false
			next := make([]any, len(arr))
			for n, item := range arr {
				got, ch, err := take(fmt.Sprintf("radius.%d", n), "number", item)
				if err != nil {
					return nil, err
				}
				changed = changed || ch
				next[n] = got
			}
			if changed {
				props.Set("radius", next)
			}
		} else {
			got, changed, err := take("radius", "number", v)
			if err != nil {
				return nil, err
			}
			if changed {
				props.Set("radius", got)
			}
		}
	}
	if st := node.Obj("stroke"); st != nil && (on("stroke") || on("stroke.color") || on("stroke.width")) {
		next := jsonv.Clone(st).(*jsonv.Object)
		changed := false
		if on("stroke") || on("stroke.color") {
			v, _ := st.Get("color")
			got, ch, err := take("stroke.color", "string", v)
			if err != nil {
				return nil, err
			}
			if ch {
				next.Set("color", got)
				changed = true
			}
		}
		if on("stroke") || on("stroke.width") {
			v, _ := st.Get("width")
			got, ch, err := take("stroke.width", "number", v)
			if err != nil {
				return nil, err
			}
			if ch {
				next.Set("width", got)
				changed = true
			}
		}
		if changed {
			props.Set("stroke", next)
		}
	}
	if v, ok := node.Get("shadow"); ok && v != nil && (on("shadow") || on("shadow.x") || on("shadow.y") || on("shadow.blur") || on("shadow.spread") || on("shadow.color")) {
		one := func(sh *jsonv.Object, prefix string) (*jsonv.Object, bool, error) {
			next := jsonv.Clone(sh).(*jsonv.Object)
			changed := false
			for _, key := range []string{"x", "y", "blur", "spread"} {
				if !(on("shadow") || on("shadow."+key)) {
					continue
				}
				raw, _ := sh.Get(key)
				got, ch, err := take(prefix+"."+key, "number", raw)
				if err != nil {
					return nil, false, err
				}
				if ch {
					next.Set(key, got)
					changed = true
				}
			}
			if on("shadow") || on("shadow.color") {
				raw, _ := sh.Get("color")
				got, ch, err := take(prefix+".color", "string", raw)
				if err != nil {
					return nil, false, err
				}
				if ch {
					next.Set("color", got)
					changed = true
				}
			}
			return next, changed, nil
		}
		if sh, ok := v.(*jsonv.Object); ok {
			next, changed, err := one(sh, "shadow")
			if err != nil {
				return nil, err
			}
			if changed {
				props.Set("shadow", next)
			}
		} else if arr, ok := v.([]any); ok {
			next := make([]any, len(arr))
			changed := false
			for n, item := range arr {
				sh, ok := item.(*jsonv.Object)
				if !ok {
					next[n] = item
					continue
				}
				got, ch, err := one(sh, fmt.Sprintf("shadow.%d", n))
				if err != nil {
					return nil, err
				}
				changed = changed || ch
				next[n] = got
			}
			if changed {
				props.Set("shadow", next)
			}
		}
	}
	if o := node.Obj("outline"); o != nil && (on("outline") || on("outline.color") || on("outline.width") || on("outline.offset")) {
		next := jsonv.Clone(o).(*jsonv.Object)
		changed := false
		if on("outline") || on("outline.color") {
			raw, _ := o.Get("color")
			got, ch, err := take("outline.color", "string", raw)
			if err != nil {
				return nil, err
			}
			if ch {
				next.Set("color", got)
				changed = true
			}
		}
		if on("outline") || on("outline.width") {
			raw, _ := o.Get("width")
			got, ch, err := take("outline.width", "number", raw)
			if err != nil {
				return nil, err
			}
			if ch {
				next.Set("width", got)
				changed = true
			}
		}
		if on("outline") || on("outline.offset") {
			if raw, ok := o.Get("offset"); ok {
				got, ch, err := take("outline.offset", "number", raw)
				if err != nil {
					return nil, err
				}
				if ch {
					next.Set("offset", got)
					changed = true
				}
			}
		}
		if changed {
			props.Set("outline", next)
		}
	}
	for _, key := range []string{"filter", "backdropFilter"} {
		f := node.Obj(key)
		if f == nil || !(on(key) || on(key+".blur")) {
			continue
		}
		raw, ok := f.Get("blur")
		if !ok {
			continue
		}
		got, ch, err := take(key+".blur", "number", raw)
		if err != nil {
			return nil, err
		}
		if ch {
			next := jsonv.Clone(f).(*jsonv.Object)
			next.Set("blur", got)
			props.Set(key, next)
		}
	}
	if node.Str("type") == "frame" {
		if l := node.Obj("layout"); l != nil && (on("layout") || on("layout.gap") || on("layout.padding")) {
			next := jsonv.Clone(l).(*jsonv.Object)
			changed := false
			if on("layout") || on("layout.gap") {
				v, _ := l.Get("gap")
				got, ch, err := take("layout.gap", "number", v)
				if err != nil {
					return nil, err
				}
				if ch {
					next.Set("gap", got)
					changed = true
				}
			}
			if on("layout") || on("layout.padding") {
				v, _ := l.Get("padding")
				if arr, ok := v.([]any); ok {
					pad := make([]any, len(arr))
					padChanged := false
					for n, item := range arr {
						got, ch, err := take(fmt.Sprintf("layout.padding.%d", n), "number", item)
						if err != nil {
							return nil, err
						}
						padChanged = padChanged || ch
						pad[n] = got
					}
					if padChanged {
						next.Set("padding", pad)
						changed = true
					}
				} else {
					got, ch, err := take("layout.padding", "number", v)
					if err != nil {
						return nil, err
					}
					if ch {
						next.Set("padding", got)
						changed = true
					}
				}
			}
			if changed {
				props.Set("layout", next)
			}
		}
	}
	return props, nil
}
