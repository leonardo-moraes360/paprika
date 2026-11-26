package opgen

import (
	"fmt"
	"math/rand"
	"slices"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

const Seed = `[
	{"op":"set_tokens","tokens":{"r":6,"gap":8,"brand":"#c43d27"}},
	{"op":"set_assets","assets":{"logo":"data:image/png;base64,iVBORw0KGgo="}},
	{"op":"create","node":{"type":"page","id":"pg","name":"P"}},
	{"op":"create","node":{"type":"page","id":"pg2","name":"Q"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"card","width":300,"height":200,"layout":{"mode":"column","gap":"$gap","padding":10},"radius":"$r","fill":"$brand","children":[
		{"type":"text","id":"t1","text":"Hello","fontSize":14},
		{"type":"rect","id":"r1","width":40,"height":20,"fill":"#ff0000","radius":4},
		{"type":"image","id":"img","width":30,"height":30,"src":"$logo"},
		{"type":"frame","id":"inner","width":"hug","height":"hug","layout":{"mode":"row","gap":4},"children":[
			{"type":"ellipse","id":"e1","width":10,"height":10},
			{"type":"text","id":"t2","text":"x"}
		]}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"free","x":0,"y":300,"width":200,"height":120,"children":[
		{"type":"rect","id":"pin1","x":170,"y":90,"width":20,"height":20,"constraints":{"horizontal":"right","vertical":"bottom"}},
		{"type":"rect","id":"pin2","x":10,"y":10,"width":180,"height":20,"constraints":{"horizontal":"scale","vertical":"top"}}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"hugf","x":300,"y":300,"width":"hug","height":"hug","layout":{"mode":"row","gap":4},"children":[
		{"type":"rect","id":"h1","width":20,"height":20},
		{"type":"rect","id":"h2","width":20,"height":20,"layoutPositioning":"absolute","x":50,"y":5,"constraints":{"horizontal":"right"}}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"group","id":"g1","children":[
		{"type":"rect","id":"ga","x":0,"y":0,"width":20,"height":20},
		{"type":"rect","id":"gb","x":30,"y":10,"width":20,"height":20}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"path","id":"pa","x":500,"y":0,"d":"M0 0 L20 0 L20 20 Z"}},
	{"op":"create","parentId":"pg","node":{"type":"path","id":"pb","x":510,"y":5,"d":"M0 0 L20 0 L20 20 L0 20 Z"}},
	{"op":"create","parentId":"pg","node":{"type":"connector","id":"c1","from":{"nodeId":"ga"},"to":{"nodeId":"r1"},"route":"elbow"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"btn","component":true,"x":400,"width":120,"height":40,"layout":{"mode":"row","gap":4,"padding":4},"componentProps":[{"name":"label","type":"text","default":"OK"}],"children":[
		{"type":"text","id":"lbl","text":"OK","bind":{"text":"label"}},
		{"type":"frame","id":"icon","slot":"icon","width":16,"height":16}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"rect","id":"gem","x":600,"width":16,"height":16,"fill":"#00ff00"}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i1","instanceOf":"btn","x":400,"y":100,"slots":{"icon":["gem"]}}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"i2","instanceOf":"btn","x":400,"y":200}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"outerc","component":true,"x":700,"width":300,"height":100,"children":[
		{"type":"frame","id":"nest","instanceOf":"btn","x":0,"y":0}
	]}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"o1","instanceOf":"outerc","x":700,"y":300}},
	{"op":"create","parentId":"pg","node":{"type":"frame","id":"wcomp","component":true,"x":900,"width":160,"height":60,"children":[
		{"type":"rect","id":"wa","x":0,"y":0,"width":20,"height":20},
		{"type":"rect","id":"wb","x":100,"y":30,"width":20,"height":20},
		{"type":"connector","id":"wc","from":{"nodeId":"wa"},"to":{"nodeId":"wb"}}
	]}},
	{"op":"create","parentId":"pg2","node":{"type":"frame","id":"w1","instanceOf":"wcomp","x":0,"y":0}},
	{"op":"create","parentId":"pg2","node":{"type":"frame","id":"root","x":0,"y":200,"width":400,"height":100,"minWidth":300}}
]`

func PlainSeed() string {
	out := Seed
	a := strings.Index(out, `	{"op":"create","parentId":"pg","node":{"type":"frame","id":"wcomp"`)
	b := strings.Index(out, `	{"op":"create","parentId":"pg2","node":{"type":"frame","id":"root"`)
	out = out[:a] + out[b:]
	return strings.Replace(out, `,"layoutPositioning":"absolute","x":50,"y":5,"constraints":{"horizontal":"right"}`, `,"layoutPositioning":"absolute","x":50,"y":5`, 1)
}

func Ops(rng *rand.Rand, doc *jsonv.Object, serial *int) []any {
	nodes := doc.Obj("nodes")
	getNode := func(id string) *jsonv.Object { return nodes.Obj(id) }
	keys := nodes.Keys()
	if len(keys) == 0 {
		return []any{}
	}
	pick := func() string {
		if rng.Intn(25) == 0 {
			return "ghost"
		}
		return keys[rng.Intn(len(keys))]
	}
	pickOf := func(types ...string) string {
		var cand []string
		for _, k := range keys {
			if slices.Contains(types, getNode(k).Str("type")) {
				cand = append(cand, k)
			}
		}
		if len(cand) == 0 {
			return "ghost"
		}
		return cand[rng.Intn(len(cand))]
	}
	pickParent := func(types ...string) string {
		var cand []string
		for _, k := range keys {
			n := getNode(k)
			if !slices.Contains(types, n.Str("type")) || n.Str("instanceOf") != "" {
				continue
			}
			inside := false
			for cur := n; cur != nil; cur = getNode(cur.Str("parentId")) {
				if cur.Bool("component") {
					inside = true
				}
			}
			if !inside {
				cand = append(cand, k)
			}
		}
		if len(cand) == 0 {
			return "ghost"
		}
		return cand[rng.Intn(len(cand))]
	}
	pickIDs := func(n int, types ...string) []any {
		out := make([]any, n)
		for i := range out {
			if len(types) == 0 {
				out[i] = pick()
			} else {
				out[i] = pickOf(types...)
			}
		}
		return out
	}
	fresh := func() string {
		*serial++
		return fmt.Sprintf("w%d", *serial)
	}
	newNode := func() *jsonv.Object {
		id := fresh()
		switch rng.Intn(9) {
		case 0:
			return jsonv.NewObject("type", "frame", "id", id, "width", 80.0, "height", 60.0, "children", []any{
				jsonv.NewObject("type", "rect", "id", id+"a", "width", 10.0, "height", 10.0),
				jsonv.NewObject("type", "text", "id", id+"b", "text", "k"),
			})
		case 1:
			return jsonv.NewObject("type", "text", "id", id, "text", "new")
		case 2:
			return jsonv.NewObject("type", "ellipse", "id", id, "width", 9.0, "height", 9.0)
		case 3:
			return jsonv.NewObject("type", "group", "id", id, "children", []any{jsonv.NewObject("type", "rect", "id", id+"a", "x", 5.0, "width", 10.0, "height", 10.0)})
		case 4:
			return jsonv.NewObject("type", "frame", "id", id, "instanceOf", []string{"btn", "outerc", "wcomp"}[rng.Intn(3)])
		case 5:
			return jsonv.NewObject("type", "connector", "id", id, "from", jsonv.NewObject("nodeId", pickOf("rect", "text", "frame")), "to", jsonv.NewObject("x", 5.0, "y", 7.0))
		case 6:
			return jsonv.NewObject("type", "frame", "id", id, "component", true, "width", 50.0, "height", 50.0, "children", []any{jsonv.NewObject("type", "rect", "id", id+"a", "width", 5.0, "height", 5.0)})
		case 7:
			return jsonv.NewObject("type", "path", "id", id, "d", "M0 0 L9 9 L0 9 Z")
		default:
			return jsonv.NewObject("type", "rect", "id", id, "width", 12.0, "height", 12.0)
		}
	}
	props := []func() *jsonv.Object{
		func() *jsonv.Object { return jsonv.NewObject("opacity", float64(rng.Intn(10))/10) },
		func() *jsonv.Object { return jsonv.NewObject("text", fmt.Sprintf("t%d", rng.Intn(6))) },
		func() *jsonv.Object { return jsonv.NewObject("width", float64(20+rng.Intn(120))) },
		func() *jsonv.Object { return jsonv.NewObject("height", float64(20+rng.Intn(120))) },
		func() *jsonv.Object {
			return jsonv.NewObject("width", []any{"hug", "fill", 90.0}[rng.Intn(3)], "height", []any{"hug", 40.0}[rng.Intn(2)])
		},
		func() *jsonv.Object { return jsonv.NewObject("x", float64(rng.Intn(80)), "y", float64(rng.Intn(80))) },
		func() *jsonv.Object {
			return jsonv.NewObject("fill", []any{"#111111", "$brand", "$nope", "#222222"}[rng.Intn(4)])
		},
		func() *jsonv.Object { return jsonv.NewObject("radius", []any{3.0, "$r", "$nope", 8.0}[rng.Intn(4)]) },
		func() *jsonv.Object {
			return jsonv.NewObject("layout", jsonv.NewObject("mode", []any{"row", "column", "none"}[rng.Intn(3)], "gap", []any{4.0, "$gap", 12.0}[rng.Intn(3)]))
		},
		func() *jsonv.Object { return jsonv.NewObject("visible", rng.Intn(2) == 0) },
		func() *jsonv.Object { return jsonv.NewObject("rotation", float64(rng.Intn(4)*15)) },
		func() *jsonv.Object { return jsonv.NewObject("name", fmt.Sprintf("n%d", rng.Intn(4))) },
		func() *jsonv.Object {
			return jsonv.NewObject("constraints", jsonv.NewObject("horizontal", []any{"left", "right", "center", "scale"}[rng.Intn(4)], "vertical", []any{"top", "bottom", "scale"}[rng.Intn(3)]))
		},
		func() *jsonv.Object { return jsonv.NewObject("minWidth", float64(100+rng.Intn(200))) },
		func() *jsonv.Object { return jsonv.NewObject("src", []any{"$logo", "$missing", "x.png"}[rng.Intn(3)]) },
		func() *jsonv.Object { return jsonv.NewObject("d", "M0 0 L30 0 L30 30 Z") },
		func() *jsonv.Object {
			return jsonv.NewObject("index", []any{"front", "back", "forward", "backward", 0.0}[rng.Intn(5)])
		},
		func() *jsonv.Object {
			return jsonv.NewObject("propValues", jsonv.NewObject("label", fmt.Sprintf("L%d", rng.Intn(4))))
		},
		func() *jsonv.Object { return jsonv.NewObject("scale", []float64{1, 1.5, 2}[rng.Intn(3)]) },
		func() *jsonv.Object {
			return jsonv.NewObject("slots", jsonv.NewObject("icon", []any{[]any{pickOf("rect", "ellipse")}, []any{}}[rng.Intn(2)]))
		},
		func() *jsonv.Object {
			return jsonv.NewObject("from", jsonv.NewObject("nodeId", pickOf("rect", "frame", "text")))
		},
		func() *jsonv.Object { return jsonv.NewObject("bogus", 1.0) },
	}
	one := func() any {
		switch k := rng.Intn(40); {
		case k < 5:
			ps := []any{pickParent("frame", "page", "group"), nil}
			op := jsonv.NewObject("op", "create", "parentId", ps[rng.Intn(2)], "node", newNode())
			if rng.Intn(4) == 0 {
				op.Set("index", float64(rng.Intn(3)))
			}
			return op
		case k < 17:
			ids := []string{pick(), pickOf("rect"), pickOf("text"), pickOf("frame"), pickOf("path"), pickOf("connector"), "i1", "i2", "o1", "w1"}
			pr := props[rng.Intn(len(props))]()
			if rng.Intn(3) == 0 {
				pr2 := props[rng.Intn(len(props))]()
				for _, kk := range pr2.Keys() {
					v, _ := pr2.Get(kk)
					pr.Set(kk, v)
				}
			}
			return jsonv.NewObject("op", "update", "id", ids[rng.Intn(len(ids))], "props", pr)
		case k < 20:
			return jsonv.NewObject("op", "delete", "id", pick())
		case k < 24:
			op := jsonv.NewObject("op", "move", "id", pick(), "parentId", []any{pickParent("frame", "page", "group"), nil}[rng.Intn(2)])
			if rng.Intn(2) == 0 {
				op.Set("index", []any{"front", "back", float64(rng.Intn(3))}[rng.Intn(3)])
			}
			return op
		case k == 24:
			return jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject([]string{"r", "gap", "brand", "extra"}[rng.Intn(4)], []any{4.0, 10.0, "#123456", nil}[rng.Intn(4)]))
		case k == 25:
			return jsonv.NewObject("op", "set_tokens", "mode", "dark", "tokens", jsonv.NewObject("brand", "#000000"))
		case k == 26:
			return jsonv.NewObject("op", "rename_document", "name", fmt.Sprintf("doc%d", rng.Intn(5)))
		case k == 27:
			return jsonv.NewObject("op", "group", "id", fresh(), "ids", pickIDs(1+rng.Intn(2), "rect", "ellipse", "text"))
		case k == 28:
			return jsonv.NewObject("op", "ungroup", "ids", pickIDs(1, "group"))
		case k == 29:
			return jsonv.NewObject("op", "add_page", "id", fresh(), "firstId", fresh(), "name", "np")
		case k == 30:
			return jsonv.NewObject("op", "detach", "ids", []any{[]string{"i1", "i2", "o1", "w1", "nest"}[rng.Intn(5)]})
		case k == 31:
			return jsonv.NewObject("op", "detach_tokens", "ids", pickIDs(1, "frame", "rect"))
		case k == 32:
			return jsonv.NewObject("op", "combine_paths", "id", fresh(), "ids", pickIDs(2, "path", "rect", "ellipse"), "operation", []any{"union", "subtract"}[rng.Intn(2)])
		case k == 33:
			return jsonv.NewObject("op", "align", "ids", pickIDs(2+rng.Intn(2), "rect", "ellipse"), "edge", []any{"left", "center", "top"}[rng.Intn(3)])
		case k == 34:
			return jsonv.NewObject("op", "distribute", "ids", pickIDs(3, "rect", "ellipse"), "axis", []any{"horizontal", "vertical"}[rng.Intn(2)])
		case k == 35:
			return jsonv.NewObject("op", "wrap", "id", fresh(), "ids", pickIDs(1, "rect", "text", "frame"))
		case k == 36:
			return jsonv.NewObject("op", "reveal", "kind", []any{"hidden", "locked"}[rng.Intn(2)])
		case k == 37:
			return jsonv.NewObject("op", "convert_to_path", "ids", pickIDs(1, "rect", "ellipse"))
		case k == 38:
			return jsonv.NewObject("op", "set_assets", "assets", jsonv.NewObject([]string{"logo", "other"}[rng.Intn(2)], []any{"data:image/png;base64,AAAA", nil}[rng.Intn(2)]))
		default:
			id, par := fresh(), pickParent("frame", "page")
			return jsonv.NewObject("op", "restore", "rootId", id, "parentId", par, "index", 0.0,
				"nodes", []any{jsonv.NewObject("id", id, "type", "rect", "parentId", par, "width", 5.0, "height", 5.0)})
		}
	}
	ops := make([]any, 1+rng.Intn(3))
	for i := range ops {
		ops[i] = one()
	}
	return ops
}
