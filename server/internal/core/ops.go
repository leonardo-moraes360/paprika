package core

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server/internal/zod"
)

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

func NewID() string {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	out := make([]byte, len(b))
	for i, c := range b {
		out[i] = idAlphabet[int(c)%len(idAlphabet)]
	}
	return string(out)
}

var NodeInputSchema z.Schema

func init() {
	NodeInputSchema = z.Lazy(func() z.Schema { return nodeInput })
	nodeInput = z.Object(
		z.Field{Name: "type", Schema: NodeTypeSchema},
		z.Field{Name: "id", Schema: z.Optional(z.String())},
		z.Field{Name: "children", Schema: z.Optional(z.Array(NodeInputSchema))},
	).Catchall(z.Unknown())
	OpSchema = z.DiscriminatedUnion("op",
		z.Option("create", z.Object(
			z.Field{Name: "op", Schema: z.Literal("create")},
			z.Field{Name: "node", Schema: NodeInputSchema},
			z.Field{Name: "parentId", Schema: z.Default(z.Nullable(z.String()), nil)},
			z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
			z.Field{Name: "place", Schema: z.Optional(z.Union(
				z.Enum("free", "below", "right", "none"),
				z.Object(
					z.Field{Name: "near", Schema: z.String().Min(1).Max(64)},
					z.Field{Name: "side", Schema: z.Enum("left", "right", "above", "below")},
				),
			))},
		)),
		z.Option("update", z.Object(
			z.Field{Name: "op", Schema: z.Literal("update")},
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "props", Schema: z.Record(z.String(), z.Unknown())},
		)),
		z.Option("delete", z.Object(
			z.Field{Name: "op", Schema: z.Literal("delete")},
			z.Field{Name: "id", Schema: z.String()},
		)),
		z.Option("move", z.Object(
			z.Field{Name: "op", Schema: z.Literal("move")},
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "parentId", Schema: z.Nullable(z.String())},
			z.Field{Name: "index", Schema: z.Optional(z.Union(z.Int().Min(0), z.Enum("front", "back", "forward", "backward")))},
		)),
		z.Option("set_tokens", z.Object(
			z.Field{Name: "op", Schema: z.Literal("set_tokens")},
			z.Field{Name: "tokens", Schema: z.Record(TokenNameSchema, z.Nullable(TokenValueSchema))},
			z.Field{Name: "mode", Schema: z.Optional(ModeNameSchema)},
			z.Field{Name: "type", Schema: z.Optional(z.Nullable(TokenTypeSchema))},
			z.Field{Name: "collection", Schema: z.Optional(z.Nullable(CollectionNameSchema))},
		)),
		z.Option("rename_document", z.Object(
			z.Field{Name: "op", Schema: z.Literal("rename_document")},
			z.Field{Name: "name", Schema: z.String().Min(1).Max(200)},
		)),
		z.Option("restore", z.Object(
			z.Field{Name: "op", Schema: z.Literal("restore")},
			z.Field{Name: "nodes", Schema: z.Array(NodeSchema)},
			z.Field{Name: "rootId", Schema: z.String()},
			z.Field{Name: "parentId", Schema: z.Nullable(z.String())},
			z.Field{Name: "index", Schema: z.Int().Min(0)},
		)),
		z.Option("group", z.Object(
			z.Field{Name: "op", Schema: z.Literal("group")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
			z.Field{Name: "id", Schema: z.Optional(z.String())},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		)),
		z.Option("ungroup", z.Object(
			z.Field{Name: "op", Schema: z.Literal("ungroup")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		)),
		z.Option("add_page", z.Object(
			z.Field{Name: "op", Schema: z.Literal("add_page")},
			z.Field{Name: "id", Schema: z.Optional(z.String())},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
			z.Field{Name: "firstId", Schema: z.Optional(z.String())},
			z.Field{Name: "firstName", Schema: z.Optional(z.String().Max(200))},
		)),
		z.Option("detach", z.Object(
			z.Field{Name: "op", Schema: z.Literal("detach")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		)),
		z.Option("detach_tokens", z.Object(
			z.Field{Name: "op", Schema: z.Literal("detach_tokens")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
			z.Field{Name: "fields", Schema: z.Optional(z.Array(z.String().Regex(`^[A-Za-z][A-Za-z.]{0,39}$`, `/^[a-zA-Z][a-zA-Z.]{0,39}$/`, "field must be a token field name")).Max(20))},
		)),
		z.Option("combine_paths", z.Object(
			z.Field{Name: "op", Schema: z.Literal("combine_paths")},
			z.Field{Name: "ids", Schema: z.Optional(z.Array(z.String()).Min(2).Max(500))},
			z.Field{Name: "operation", Schema: z.Optional(combineOperationSchema)},
			z.Field{Name: "operations", Schema: z.Optional(z.Array(combineStepSchema).Min(1).Max(50))},
			z.Field{Name: "style", Schema: z.Optional(combineStyleSchema)},
			z.Field{Name: "id", Schema: z.Optional(z.String())},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		)),
		z.Option("align", z.Object(
			z.Field{Name: "op", Schema: z.Literal("align")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(2).Max(500)},
			z.Field{Name: "edge", Schema: z.Enum("left", "center", "right", "top", "middle", "bottom")},
		)),
		z.Option("distribute", z.Object(
			z.Field{Name: "op", Schema: z.Literal("distribute")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(3).Max(500)},
			z.Field{Name: "axis", Schema: z.Enum("horizontal", "vertical")},
		)),
		z.Option("wrap", z.Object(
			z.Field{Name: "op", Schema: z.Literal("wrap")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
			z.Field{Name: "id", Schema: z.Optional(z.String())},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		)),
		z.Option("reveal", z.Object(
			z.Field{Name: "op", Schema: z.Literal("reveal")},
			z.Field{Name: "kind", Schema: z.Enum("hidden", "locked")},
			z.Field{Name: "pageId", Schema: z.Optional(z.String())},
		)),
		z.Option("convert_to_path", z.Object(
			z.Field{Name: "op", Schema: z.Literal("convert_to_path")},
			z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		)),
		z.Option("set_assets", z.Object(
			z.Field{Name: "op", Schema: z.Literal("set_assets")},
			z.Field{Name: "assets", Schema: z.Record(AssetNameSchema, z.Nullable(AssetSrcSchema))},
		)),
	)
}

var (
	combineOperationSchema = z.Enum("union", "subtract", "intersect", "exclude")
	combineStepSchema      = z.Object(
		z.Field{Name: "op", Schema: combineOperationSchema},
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(2).Max(500)},
		z.Field{Name: "as", Schema: z.Optional(z.String().Min(1).Max(100))},
	)
	combineStyleSchema = z.Union(
		z.Enum("first", "last", "bottom", "top"),
		z.Object(
			z.Field{Name: "from", Schema: z.Optional(z.String())},
			z.Field{Name: "fill", Schema: z.Optional(colorValue())},
			z.Field{Name: "gradient", Schema: z.Optional(gradientSchema)},
			z.Field{Name: "stroke", Schema: z.Optional(strokeSchema)},
			z.Field{Name: "opacity", Schema: z.Optional(z.Number().Min(0).Max(1))},
			z.Field{Name: "shadow", Schema: z.Optional(shadowValue)},
			z.Field{Name: "outline", Schema: z.Optional(outlineSchema)},
			z.Field{Name: "filter", Schema: z.Optional(filterSchema)},
			z.Field{Name: "backdropFilter", Schema: z.Optional(filterSchema)},
		),
	)
)

var (
	CombineOperationSchema = combineOperationSchema
	CombineStepSchema      = combineStepSchema
	CombineStyleSchema     = combineStyleSchema
)

var connectorDerived = map[string]bool{"x": true, "y": true, "width": true, "height": true, "d": true}

const connectorGeometry = "a connector's x, y, width, height and d follow its ends; change from/to (nodeId, side, or x/y of a free end)"

const sourceIDRule = "sourceId is generated by instances; it cannot be written"

func inInstance(inst string) string {
	return fmt.Sprintf(`"%s" is an instance: its content comes from the component; edit the component, use overrides or detach it`, inst)
}

func copyRule(id, inst string) string {
	return fmt.Sprintf(`"%s" is a copy inside the instance "%s": only %s can change (they become overrides); edit the component or detach it`, id, inst, strings.Join(CopyOverrides, ", "))
}

func renormalizeUpdate(node *Node, props *jsonv.Object, i int) (*jsonv.Object, error) {
	if node.Str("type") != "path" {
		return props, nil
	}
	on := !props.Has("width") && !props.Has("height") && !props.Has("viewBox")
	if props.Has("normalize") {
		v, _ := props.Get("normalize")
		flag, isBool := v.(bool)
		if !isBool {
			return nil, opErr(i, "normalize must be true or false")
		}
		props = props.Spread()
		props.Delete("normalize")
		on = flag
	}
	dv, _ := props.Get("d")
	ds, isStr := dv.(string)
	if !on || !isStr {
		return props, nil
	}
	if node.Has("viewBox") {
		if vb, has := props.Get("viewBox"); !has || vb != nil {
			return props, nil
		}
	}
	segs, perr := ParsePath(ds)
	if perr != nil {
		return props, nil
	}
	moved, origin, b := NormalizePath(segs)
	out := props.Spread()
	out.Set("d", SerializePath(moved))
	out.Set("width", jsMax1(math.Ceil(b.X+b.Width)))
	out.Set("height", jsMax1(math.Ceil(b.Y+b.Height)))
	if origin.X != 0 || origin.Y != 0 {
		x, y := node.Num("x"), node.Num("y")
		if f, ok := props.Get("x"); ok {
			if n, isNum := f.(float64); isNum {
				x = n
			}
		}
		if f, ok := props.Get("y"); ok {
			if n, isNum := f.(float64); isNum {
				y = n
			}
		}
		out.Set("x", Round4(x+origin.X))
		out.Set("y", Round4(y+origin.Y))
	}
	return out, nil
}

func updatePlain(doc *Document, node *Node, props *jsonv.Object, i int) (any, error) {
	id := node.Str("id")
	allowed := KnownKeys(node.Str("type"))
	next := node.Spread()
	prev := jsonv.NewObject()
	for _, k := range props.Keys() {
		v, _ := props.Get(k)
		if ImmutableKeys[k] {
			return nil, opErr(i, `field "%s" cannot be changed by update (use move/create)`, k)
		}
		if !allowed[k] {
			return nil, opErr(i, "unknown field for %s: %s", node.Str("type"), k)
		}
		if node.Str("type") == "group" && (k == "width" || k == "height") {
			return nil, opErr(i, groupSize)
		}
		if node.Str("type") == "connector" && connectorDerived[k] {
			return nil, opErr(i, connectorGeometry)
		}
		if old, has := node.Get(k); has {
			prev.Set(k, jsonv.Clone(old))
		} else {
			prev.Set(k, nil)
		}
		if v == nil {
			next.Delete(k)
		} else {
			next.Set(k, jsonv.Clone(v))
		}
	}
	parsed, err := z.Parse(NodeSchema, next)
	if err != nil {
		return nil, opErr(i, `invalid update on "%s": %s`, id, formatZod(err))
	}
	Nodes(doc).Set(id, parsed)
	return jsonv.NewObject("op", "update", "id", id, "props", prev), nil
}

func updateOverride(doc *Document, inst, node *Node, srcID string, props *jsonv.Object, i int) (any, error) {
	id := node.Str("id")
	leaf := srcID
	if i := strings.LastIndex(srcID, "/"); i >= 0 {
		leaf = srcID[i+1:]
	}
	src := GetNode(doc, leaf)
	prev := jsonv.NewObject()
	allowed := KnownKeys(node.Str("type"))
	var unknown []string
	for _, k := range props.Keys() {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		return nil, opErr(i, "unknown field for %s: %s", node.Str("type"), strings.Join(unknown, ", "))
	}
	for _, k := range props.Keys() {
		v, _ := props.Get(k)
		setOverride(inst, srcID, k, v, src)
	}
	next := GetNode(doc, id).Spread()
	for _, k := range props.Keys() {
		v, _ := props.Get(k)
		if old, has := node.Get(k); has {
			prev.Set(k, jsonv.Clone(old))
		} else {
			prev.Set(k, nil)
		}
		if v == nil {
			if sv, has := src.Get(k); src != nil && has {
				next.Set(k, jsonv.Clone(sv))
			} else {
				next.Delete(k)
			}
		} else {
			next.Set(k, jsonv.Clone(v))
		}
	}
	parsed, err := z.Parse(NodeSchema, next)
	if err != nil {
		return nil, opErr(i, `invalid update on "%s": %s`, id, formatZod(err))
	}
	Nodes(doc).Set(id, parsed)
	return jsonv.NewObject("op", "update", "id", id, "props", prev), nil
}

var nodeInput *z.ObjectSchema

var OpSchema *z.DiscUnion

type OpError struct {
	Msg   string
	Index int
}

func (e *OpError) Error() string { return fmt.Sprintf("op[%d]: %s", e.Index, e.Msg) }

func opErr(i int, format string, a ...any) *OpError { return &OpError{fmt.Sprintf(format, a...), i} }

type ApplyResult struct {
	Doc     *Document
	Inverse []any
	Created []string
	Removed []string
	Touched []string
	Journal *Journal
	Scope   *ScopeIndex
}

func (r *ApplyResult) Scoped() bool { return r.Touched != nil }

type listRef struct {
	owner *jsonv.Object
	key   string
}

func (l listRef) get() []any  { return l.owner.Arr(l.key) }
func (l listRef) set(v []any) { l.owner.Set(l.key, v) }
func (l listRef) indexOf(id string) int {
	for i, v := range l.get() {
		if v == id {
			return i
		}
	}
	return -1
}

func (l listRef) insertAt(id string, index *int) {
	list := l.get()
	at := len(list)
	if index != nil && *index < at {
		at = *index
	}
	list = append(list, nil)
	copy(list[at+1:], list[at:])
	list[at] = id
	l.set(list)
}

func (l listRef) removeAt(index int) {
	list := l.get()
	if index < 0 {
		index += len(list)
		if index < 0 {
			index = 0
		}
	}
	if index >= len(list) {
		return
	}
	l.set(append(list[:index:index], list[index+1:]...))
}

func container(doc *Document, parentID any, i int) (listRef, error) {
	pid, ok := parentID.(string)
	if !ok {
		return listRef{doc, "rootIds"}, nil
	}
	parent := GetNode(doc, pid)
	if parent == nil {
		return listRef{}, opErr(i, `parent "%s" does not exist`, pid)
	}
	if t := parent.Str("type"); !IsContainer(t) {
		return listRef{}, opErr(i, `parent "%s" is %s; only frame, group and page have children`, pid, t)
	}
	return listRef{own(doc, pid), "children"}, nil
}

func subtree(doc *Document, id string) []*Node {
	var out []*Node
	var walk func(string)
	walk = func(nid string) {
		n := GetNode(doc, nid)
		if n == nil {
			return
		}
		out = append(out, n)
		if IsContainer(n.Str("type")) {
			for _, c := range n.Strings("children") {
				walk(c)
			}
		}
	}
	walk(id)
	return out
}

const (
	pageAtRoot = "a page can only be at the canvas level (parentId null)"
	groupSize  = "a group's width/height follow its children; move or resize the children"
)

func checkPlacement(typ string, parentID any, i int) error {
	if _, inParent := parentID.(string); typ == "page" && inParent {
		return opErr(i, pageAtRoot)
	}
	return nil
}

func isDescendant(doc *Document, maybeChild, ancestor string) bool {
	n := GetNode(doc, maybeChild)
	if n == nil {
		return false
	}
	cur, ok := ParentID(n)
	for ok && cur != "" {
		if cur == ancestor {
			return true
		}
		p := GetNode(doc, cur)
		if p == nil {
			return false
		}
		cur, ok = ParentID(p)
	}
	return false
}

func jsToNumber(v any, present bool) float64 {
	if !present {
		return math.NaN()
	}
	switch t := v.(type) {
	case nil:
		return 0
	case bool:
		if t {
			return 1
		}
		return 0
	case float64:
		return t
	case string:
		return jsonv.ToNumber(t)
	case []any:
		if len(t) == 0 {
			return 0
		}
		if len(t) == 1 {
			switch e := t[0].(type) {
			case float64:
				return e
			case string:
				return jsonv.ToNumber(e)
			case nil:
				return 0
			}
		}
	}
	return math.NaN()
}

func formatZod(err error) string {
	if ze, ok := errors.AsType[*z.Error](err); ok {
		return z.Format(ze)
	}
	return err.Error()
}

func createNode(doc *Document, input *jsonv.Object, parentID any, index *int, i int, created *[]string) error {
	rest := input.Spread()
	rest.Delete("children")
	childrenV, hasChildren := input.Get("children")
	typ := input.Str("type")
	id, hasID := input.Get("id")
	idStr, _ := id.(string)
	if !hasID {
		idStr = NewID()
	}
	if idStr == "__proto__" {
		return opErr(i, `id "__proto__" is reserved`)
	}
	if GetNode(doc, idStr) != nil {
		return opErr(i, `id "%s" already exists`, idStr)
	}
	if hasChildren && !IsContainer(typ) {
		return opErr(i, "only frame, group and page take children (got %s)", typ)
	}
	doNormalize := typ == "path" && !rest.Has("width") && !rest.Has("height") && !rest.Has("viewBox")
	if rest.Has("normalize") {
		if typ != "path" {
		} else {
			v, _ := rest.Get("normalize")
			switch b := v.(type) {
			case bool:
				doNormalize = b
				rest.Delete("normalize")
			default:
				return opErr(i, "normalize must be true or false")
			}
		}
	}
	allowed := KnownKeys(typ)
	var unknown []string
	for _, k := range rest.Keys() {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		return opErr(i, "unknown fields for %s: %s", typ, strings.Join(unknown, ", "))
	}
	if rest.Has("parentId") {
		return opErr(i, "use the operation's parentId, not the node's")
	}
	if typ == "group" && (rest.Has("width") || rest.Has("height")) {
		return opErr(i, groupSize)
	}
	if typ == "connector" {
		for _, k := range rest.Keys() {
			if connectorDerived[k] {
				return opErr(i, connectorGeometry)
			}
		}
	}
	if rest.Has("sourceId") {
		return opErr(i, sourceIDRule)
	}
	if owner := InstanceOwner(doc, parentID); owner != nil {
		return opErr(i, "%s", inInstance(owner.Str("id")))
	}
	if inst, ok := rest.Get("instanceOf"); ok {
		if _, isStr := inst.(string); isStr && hasChildren && len(childrenV.([]any)) > 0 {
			return opErr(i, "an instance's children come from the component; create the instance without children")
		}
	}
	list, err := container(doc, parentID, i)
	if err != nil {
		return err
	}
	if err := checkPlacement(typ, parentID, i); err != nil {
		return err
	}
	props := rest.Spread()
	if doNormalize && typ == "path" {
		if d, ok := props.Get("d"); ok {
			if ds, isStr := d.(string); isStr {
				if segs, perr := ParsePath(ds); perr == nil {
					moved, origin, _ := NormalizePath(segs)
					props.Set("d", SerializePath(moved))
					if origin.X != 0 || origin.Y != 0 {
						x := 0.0
						y := 0.0
						if v, has := props.Get("x"); has {
							x = jsToNumber(v, true)
						}
						if v, has := props.Get("y"); has {
							y = jsToNumber(v, true)
						}
						props.Set("x", Round4(x+origin.X))
						props.Set("y", Round4(y+origin.Y))
					}
				}
			}
		}
	}
	if d, ok := props.Get("d"); ok && typ == "path" {
		if ds, isStr := d.(string); isStr && (!props.Has("width") || !props.Has("height")) {
			var w, h float64
			if vb, isArr := props.Arr("viewBox"), props.Has("viewBox"); isArr && vb != nil {
				w = jsToNumberAt(vb, 2)
				h = jsToNumberAt(vb, 3)
			} else if segs, perr := ParsePath(ds); perr == nil {
				b := PathBounds(segs)
				w, h = b.X+b.Width, b.Y+b.Height
			} else {
				w, h = 100, 100
			}
			for _, kv := range []struct {
				key string
				val float64
			}{{"width", w}, {"height", h}} {
				if v, has := props.Get(kv.key); !has || v == nil {
					props.Set(kv.key, jsMax1(math.Ceil(kv.val)))
				}
			}
		}
	}
	if typ == "text" {
		for _, k := range []string{"width", "height"} {
			if v, has := props.Get(k); !has || v == nil {
				props.Set(k, "hug")
			}
		}
	}
	if typ == "shape" {
		kind := "rect"
		if k, ok := props.Get("shape"); ok {
			if ks, isStr := k.(string); isStr {
				kind = ks
			}
		}
		if kind == "rect" || kind == "ellipse" || kind == "diamond" || kind == "triangle" || kind == "cylinder" || kind == "parallelogram" || kind == "cloud" || kind == "note" {
			defaults := ShapeDefaults(kind)
			for _, k := range defaults.Keys() {
				if !props.Has(k) {
					v, _ := defaults.Get(k)
					props.Set(k, v)
				}
			}
		}
	}
	if typ == "frame" {
		if compID, isStr := props.Get("instanceOf"); isStr && props.Has("fill") {
			if cid, ok := compID.(string); ok {
				fill, _ := props.Get("fill")
				props.Delete("fill")
				base := GetNode(doc, cid)
				if fill != nil && !(base != nil && jsonEqual(fill, sourceValue(base, "fill"))) {
					ovs := props.Obj("overrides")
					if ovs == nil {
						ovs = jsonv.NewObject()
					} else {
						ovs = ovs.Spread()
					}
					own := ovs.Obj(cid)
					if own == nil {
						own = jsonv.NewObject()
					} else {
						own = own.Spread()
					}
					own.Set("fill", fill)
					ovs.Set(cid, own)
					props.Set("overrides", ovs)
				}
			}
		}
	}
	props.Set("id", idStr)
	props.Set("parentId", parentID)
	if IsContainer(typ) {
		props.Set("children", []any{})
	} else {
		props.Delete("children")
	}
	parsed, perr := z.Parse(NodeSchema, props)
	if perr != nil {
		return opErr(i, "invalid node: %s", formatZod(perr))
	}
	Nodes(doc).Set(idStr, parsed)
	list.insertAt(idStr, index)
	*created = append(*created, idStr)
	if hasChildren {
		for _, child := range childrenV.([]any) {
			if err := createNode(doc, child.(*jsonv.Object), idStr, nil, i, created); err != nil {
				return err
			}
		}
	}
	return nil
}

func jsToNumberAt(arr []any, i int) float64 {
	if i >= len(arr) {
		return math.NaN()
	}
	return jsToNumber(arr[i], true)
}

func jsMax1(v float64) float64 {
	if math.IsNaN(v) {
		return v
	}
	return math.Max(1, v)
}

func optIndex(op *jsonv.Object) *int {
	v, ok := op.Get("index")
	if !ok {
		return nil
	}
	n := int(v.(float64))
	return &n
}

const zIndexHint = `props.index must be a number (0 is the back) or "front", "back", "forward" or "backward"`

func validZIndex(v any) bool {
	switch t := v.(type) {
	case float64:
		return !math.IsInf(t, 0) && !math.IsNaN(t) && t == math.Trunc(t) && t >= 0
	case string:
		switch t {
		case "front", "back", "forward", "backward":
			return true
		}
	}
	return false
}

func zStepToIndex(v any, fromIndex int) *int {
	switch t := v.(type) {
	case nil:
		return nil
	case float64:
		n := int(t)
		return &n
	case string:
		switch t {
		case "front":
			return nil
		case "back":
			n := 0
			return &n
		case "forward":
			n := fromIndex + 1
			return &n
		default:
			n := max(fromIndex-1, 0)
			return &n
		}
	}
	return nil
}

func moveIndex(op *jsonv.Object, fromIndex int) *int {
	v, ok := op.Get("index")
	if !ok {
		return nil
	}
	return zStepToIndex(v, fromIndex)
}

func withReorder(inv any, reorder []any) any {
	if len(reorder) == 0 {
		return inv
	}
	return append(flatten(inv), reorder...)
}

func gradientColorProblem(input any, path []string) string {
	switch t := input.(type) {
	case []any:
		for k, v := range t {
			if m := gradientColorProblem(v, append(slices.Clip(path), strconv.Itoa(k))); m != "" {
				return m
			}
		}
	case *jsonv.Object:
		for _, key := range t.Keys() {
			v, _ := t.Get(key)
			if s, ok := v.(string); ok && (key == "fill" || key == "color") && reColorGradient.MatchString(s) {
				return strings.Join(append(slices.Clip(path), key), ".") + ": " + gradientColorMsg
			}
			if m := gradientColorProblem(v, append(slices.Clip(path), key)); m != "" {
				return m
			}
		}
	}
	return ""
}

func applyOne(doc *Document, op *jsonv.Object, i int, created *[]string) (any, error) {
	switch op.Str("op") {
	case "create":
		if m := gradientColorProblem(op.Obj("node"), nil); m != "" {
			return nil, opErr(i, "invalid node: %s", m)
		}
	case "update":
		if m := gradientColorProblem(op.Obj("props"), nil); m != "" {
			return nil, opErr(i, "invalid props: %s", m)
		}
	}
	switch op.Str("op") {
	case "create":
		parentID, _ := op.Get("parentId")
		node := op.Obj("node")
		if op.Has("place") {
			p, _ := op.Get("place")
			next, err := ResolvePlace(doc, parentID, node, p)
			if err != nil {
				return nil, opErr(i, "%s", err.Error())
			}
			parentID = next
		}
		before := len(*created)
		if err := createNode(doc, node, parentID, optIndex(op), i, created); err != nil {
			return nil, err
		}
		return jsonv.NewObject("op", "delete", "id", (*created)[before]), nil

	case "update":
		id := op.Str("id")
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, `node "%s" does not exist`, id)
		}
		props := op.Obj("props")
		var reorder []any
		if props.Has("index") {
			v, _ := props.Get("index")
			if !validZIndex(v) {
				return nil, opErr(i, "%s (got %s)", zIndexHint, jsonv.Stringify(v, ""))
			}
			if owner := CopyOwner(doc, node); owner != nil {
				return nil, opErr(i, "%s", copyRule(id, owner.Str("id")))
			}
			parentID := mustGet(node, "parentId")
			list, err := container(doc, parentID, i)
			if err != nil {
				return nil, err
			}
			fromIndex := list.indexOf(id)
			list.removeAt(fromIndex)
			list.insertAt(id, zStepToIndex(v, fromIndex))
			reorder = append(reorder, jsonv.NewObject("op", "move", "id", id, "parentId", parentID, "index", float64(fromIndex)))
			props = props.Spread()
			props.Delete("index")
		}
		if inst, key, ok := CopyOverrideTarget(doc, node); ok {
			var bad []string
			for _, k := range props.Keys() {
				if !inList(OverrideFields(node), k) {
					bad = append(bad, k)
				}
			}
			if len(bad) > 0 {
				return nil, opErr(i, "%s (got %s)", copyRule(id, inst.Str("id")), strings.Join(bad, ", "))
			}
			inv, err := updateOverride(doc, ownNode(doc, inst), node, key, props, i)
			if err != nil {
				return nil, err
			}
			return withReorder(inv, reorder), nil
		}
		if props.Has("sourceId") && InstanceOwner(doc, mustGet(node, "parentId")) != nil {
			return nil, opErr(i, sourceIDRule)
		}
		if !IsInstance(node) {
			np, err := renormalizeUpdate(node, props, i)
			if err != nil {
				return nil, err
			}
			inv, err := updatePlain(doc, node, np, i)
			if err != nil {
				return nil, err
			}
			return withReorder(inv, reorder), nil
		}
		var derived []string
		for _, k := range props.Keys() {
			if inList(RootDerived, k) && k != "fill" {
				derived = append(derived, k)
			}
		}
		if len(derived) > 0 {
			return nil, opErr(i, `%s of "%s" come from the component "%s"; edit the component, change scale or detach it`, strings.Join(derived, ", "), id, node.Str("instanceOf"))
		}
		rest := props.Spread()
		rest.Delete("fill")
		inverse := []any{}
		if rest.Len() > 0 {
			inv, err := updatePlain(doc, node, rest, i)
			if err != nil {
				return nil, err
			}
			inverse = append(inverse, inv)
		}
		if fill, ok := props.Get("fill"); ok {
			cur := GetNode(doc, id)
			fp := jsonv.NewObject("fill", fill)
			var inv any
			var err error
			if IsInstance(cur) {
				inv, err = updateOverride(doc, ownNode(doc, cur), cur, cur.Str("instanceOf"), fp, i)
			} else {
				inv, err = updatePlain(doc, cur, fp, i)
			}
			if err != nil {
				return nil, err
			}
			inverse = append([]any{inv}, inverse...)
		}
		return withReorder(inverse, reorder), nil

	case "delete":
		id := op.Str("id")
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, `node "%s" does not exist`, id)
		}
		if owner := CopyOwner(doc, node); owner != nil {
			return nil, opErr(i, "%s; to hide it, use visible: false", copyRule(id, owner.Str("id")))
		}
		gone := map[string]bool{}
		for _, n := range subtree(doc, id) {
			gone[n.Str("id")] = true
		}
		var attached []string
		for _, cid := range ConnectorsAttachedTo(doc, gone) {
			if CopyOwner(doc, GetNode(doc, cid)) == nil {
				attached = append(attached, cid)
			}
		}
		if len(attached) > 0 {
			var inverse []any
			for _, cid := range attached {
				inv, err := applyOne(doc, jsonv.NewObject("op", "delete", "id", cid), i, created)
				if err != nil {
					return nil, err
				}
				inverse = append(flatten(inv), inverse...)
			}
			main, err := applyOne(doc, op, i, created)
			if err != nil {
				return nil, err
			}
			return append(flatten(main), inverse...), nil
		}
		nodes := subtree(doc, id)
		parentID, _ := node.Get("parentId")
		list, err := container(doc, parentID, i)
		if err != nil {
			return nil, err
		}
		index := list.indexOf(id)
		list.removeAt(index)
		saved := make([]any, len(nodes))
		goneIDs := make([]string, len(nodes))
		for k, n := range nodes {
			saved[k] = jsonv.Clone(n)
			goneIDs[k] = n.Str("id")
		}
		Nodes(doc).DeleteAll(goneIDs)
		return jsonv.NewObject("op", "restore", "nodes", saved, "rootId", id, "parentId", parentID, "index", float64(index)), nil

	case "restore":
		nodes := op.Arr("nodes")
		for _, n := range nodes {
			nid := n.(*jsonv.Object).Str("id")
			if nid == "__proto__" {
				return nil, opErr(i, `id "__proto__" is reserved`)
			}
			if GetNode(doc, nid) != nil {
				return nil, opErr(i, `id "%s" already exists`, nid)
			}
		}
		parentID, _ := op.Get("parentId")
		list, err := container(doc, parentID, i)
		if err != nil {
			return nil, err
		}
		for _, n := range nodes {
			if no := n.(*jsonv.Object); no.Str("id") == op.Str("rootId") {
				if err := checkPlacement(no.Str("type"), parentID, i); err != nil {
					return nil, err
				}
				break
			}
		}
		for _, n := range nodes {
			no := n.(*jsonv.Object)
			Nodes(doc).Set(no.Str("id"), jsonv.Clone(no))
		}
		list.insertAt(op.Str("rootId"), optIndex(op))
		return jsonv.NewObject("op", "delete", "id", op.Str("rootId")), nil

	case "move":
		id := op.Str("id")
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, `node "%s" does not exist`, id)
		}
		target, _ := op.Get("parentId")
		if ts, ok := target.(string); ok && (ts == id || isDescendant(doc, ts, id)) {
			return nil, opErr(i, `moving "%s" into itself would create a cycle`, id)
		}
		if owner := CopyOwner(doc, node); owner != nil {
			return nil, opErr(i, "%s", copyRule(id, owner.Str("id")))
		}
		if t := InstanceOwner(doc, target); t != nil {
			return nil, opErr(i, "%s", inInstance(t.Str("id")))
		}
		oldParent, _ := node.Get("parentId")
		from, err := container(doc, oldParent, i)
		if err != nil {
			return nil, err
		}
		fromIndex := from.indexOf(id)
		to, err := container(doc, target, i)
		if err != nil {
			return nil, err
		}
		if err := checkPlacement(node.Str("type"), target, i); err != nil {
			return nil, err
		}
		from.removeAt(fromIndex)
		to.insertAt(id, moveIndex(op, fromIndex))
		own(doc, id).Set("parentId", target)
		return jsonv.NewObject("op", "move", "id", id, "parentId", oldParent, "index", float64(fromIndex)), nil

	case "set_tokens":
		ownDocMaps(doc)
		return applySetTokens(doc, op, i)
	case "detach_tokens":
		ownDocMaps(doc)
		return applyDetachTokens(doc, op, i, created)

	case "set_assets":
		ownDocMaps(doc)
		prev := jsonv.NewObject()
		assets := doc.Obj("assets")
		if assets == nil {
			assets = jsonv.NewObject()
			doc.Set("assets", assets)
		}
		in := op.Obj("assets")
		for _, k := range in.Keys() {
			if k == "__proto__" {
				continue
			}
			v, _ := in.Get(k)
			if old, has := assets.Get(k); has && old != nil {
				prev.Set(k, old)
			} else {
				prev.Set(k, nil)
			}
			if v == nil {
				assets.Delete(k)
			} else {
				assets.Set(k, v)
			}
		}
		if assets.Len() == 0 {
			doc.Delete("assets")
		}
		return jsonv.NewObject("op", "set_assets", "assets", prev), nil

	case "rename_document":
		prev := doc.Str("name")
		doc.Set("name", op.Str("name"))
		return jsonv.NewObject("op", "rename_document", "name", prev), nil

	case "group", "ungroup", "add_page", "detach", "combine_paths", "align", "distribute", "wrap", "reveal", "convert_to_path":
		var plan []any
		var err error
		switch op.Str("op") {
		case "group":
			plan, _, err = GroupOps(doc, op.Strings("ids"), op.Str("id"), op.Str("name"))
		case "ungroup":
			plan, _, err = UngroupOps(doc, op.Strings("ids"))
		case "detach":
			if err = SyncInstances(doc); err == nil {
				plan, err = DetachOps(doc, op.Strings("ids"))
			}
		case "combine_paths":
			plan, _, err = CombinePathsOps(doc, op)
		case "align":
			plan, err = AlignOps(doc, op.Strings("ids"), op.Str("edge"))
		case "distribute":
			plan, err = DistributeOps(doc, op.Strings("ids"), op.Str("axis"))
		case "wrap":
			plan, _, err = WrapOps(doc, op.Strings("ids"), op.Str("id"), op.Str("name"))
		case "reveal":
			plan, _, err = RevealOps(doc, op.Str("kind"), op.Str("pageId"))
		case "convert_to_path":
			plan, err = ConvertToPathOps(doc, op.Strings("ids"))
		default:
			plan, _ = AddPageOps(doc, op.Str("id"), op.Str("name"), op.Str("firstId"), op.Str("firstName"))
		}
		if err != nil {
			return nil, opErr(i, "%s", err.Error())
		}
		var inverse []any
		for _, sub := range plan {
			parsed, perr := z.Parse(OpSchema, sub)
			if perr != nil {
				return nil, opErr(i, "invalid operation: %s", formatZod(perr))
			}
			inv, aerr := applyOne(doc, parsed.(*jsonv.Object), i, created)
			if aerr != nil {
				return nil, aerr
			}
			inverse = append(flatten(inv), inverse...)
		}
		return inverse, nil
	}
	return nil, opErr(i, "unknown operation")
}

func ApplyOps(doc *Document, ops []any) (*ApplyResult, error) {
	return applyOps(doc, ops, false, nil)
}

func applyOps(doc *Document, ops []any, settled bool, idx *ScopeIndex) (r *ApplyResult, err error) {
	if !isShared(doc) {
		return applyOpsOn(doc, jsonv.Clone(doc).(*jsonv.Object), ops, settled, false, nil)
	}
	defer func() {
		p := recover()
		if p == nil {
			return
		}
		if _, ok := p.(*jsonv.FrozenError); !ok || strictOwnership.Load() {
			panic(p)
		}
		ownershipFallbacks.Add(1)
		r, err = applyOpsOn(doc, jsonv.Clone(doc).(*jsonv.Object), ops, settled, false, nil)
		if err == nil {
			jsonv.Freeze(r.Doc)
		}
	}()
	return applyOpsOn(doc, newDraft(doc), ops, settled, true, idx)
}

func applyOpsOn(doc, draft *Document, ops []any, settled, cow bool, idx *ScopeIndex) (*ApplyResult, error) {
	var inverse []any
	var scope *ScopeIndex
	created := []string{}
	deleted := map[string]bool{}
	for i, raw := range ops {
		parsed, err := z.Parse(OpSchema, raw)
		if err != nil {
			return nil, opErr(i, "invalid operation: %s", formatZod(err))
		}
		op := parsed.(*jsonv.Object)
		if op.Str("op") == "delete" {
			id := op.Str("id")
			if GetNode(draft, id) == nil && !deleted[id] {
				if orig := GetNode(doc, id); orig != nil && orig.Str("type") == "connector" {
					deleted[id] = true
					continue
				}
			}
			deleted[id] = true
		}
		inv, err := applyOne(draft, op, i, &created)
		if err != nil {
			return nil, err
		}
		inverse = append(flatten(inv), inverse...)
	}
	if len(ops) > 0 {
		if err := checkPages(draft, len(ops)-1); err != nil {
			return nil, err
		}
		var d *derivedScope
		if cow && settled && idx != nil && !ScopedDerivedOff {
			if d = planDerived(doc, draft, idx); d != nil && !d.prepare() {
				d = nil
			}
		}
		if d != nil {
			inv, err := d.run(len(ops) - 1)
			if err != nil {
				return nil, err
			}
			inverse = append(inv, inverse...)
			scope = d.next
		} else {
			applyConstraints(doc, draft)
			inverse = append(fitGroups(draft), inverse...)
			var base *Document
			if settled {
				base = doc
			}
			if err := syncInstances(base, draft); err != nil {
				return nil, opErr(len(ops)-1, "%s", err.Error())
			}
			inverse = append(fitGroups(draft), inverse...)
			if msg := LengthTokenError(draft); msg != "" {
				return nil, opErr(len(ops)-1, "%s", msg)
			}
			if msg := webSemanticsError(draft); msg != "" {
				return nil, opErr(len(ops)-1, "%s", msg)
			}
			if err := RouteConnectors(draft); err != nil {
				return nil, opErr(len(ops)-1, "%s", err.Error())
			}
		}
	}
	if inverse == nil {
		inverse = []any{}
	}
	res := &ApplyResult{Doc: draft, Inverse: inverse, Created: created, Scope: scope}
	if cow {
		res.Journal = sealDraft(draft)
	}
	return res, nil
}

func CreateDocument(name, id string) *Document {
	if id == "" {
		id = NewID()
	}
	out, err := z.Parse(DocumentSchema, jsonv.NewObject("format", Format, "id", id, "name", name))
	if err != nil {
		panic(err)
	}
	return out.(*Document)
}

func ParseDocument(input any) (*Document, error) {
	out, err := z.Parse(DocumentSchema, input)
	if err != nil {
		return nil, err
	}
	doc := out.(*Document)
	seen := map[string]bool{}
	var check func(ids []string, parentID any) error
	check = func(ids []string, parentID any) error {
		for _, id := range ids {
			n := GetNode(doc, id)
			if n == nil {
				return fmt.Errorf(`inconsistent document: "%s" is referenced but missing`, id)
			}
			if seen[id] {
				return fmt.Errorf(`inconsistent document: "%s" appears more than once`, id)
			}
			if p, _ := n.Get("parentId"); p != parentID {
				return fmt.Errorf(`inconsistent document: parentId of "%s" differs`, id)
			}
			if n.Str("type") == "page" && parentID != nil {
				return fmt.Errorf(`inconsistent document: page "%s" outside the top level`, id)
			}
			seen[id] = true
			if IsContainer(n.Str("type")) {
				if err := check(n.Strings("children"), id); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := check(doc.Strings("rootIds"), nil); err != nil {
		return nil, err
	}
	pages, loose := 0, 0
	for _, id := range doc.Strings("rootIds") {
		if GetNode(doc, id).Str("type") == "page" {
			pages++
		} else {
			loose++
		}
	}
	if pages > 0 && loose > 0 {
		return nil, errors.New("inconsistent document: with pages, every top-level node must be a page")
	}
	var orphans []string
	for _, id := range Nodes(doc).Keys() {
		if !seen[id] {
			orphans = append(orphans, id)
		}
	}
	if len(orphans) > 0 {
		return nil, fmt.Errorf("inconsistent document: orphan nodes %s", strings.Join(orphans, ", "))
	}
	if msg := webSemanticsError(doc); msg != "" {
		return nil, fmt.Errorf("inconsistent document: %s", msg)
	}
	return doc, nil
}

func webSemanticsError(doc *Document) string {
	for _, id := range Nodes(doc).Keys() {
		n := GetNode(doc, id)
		if n == nil {
			continue
		}
		if n.Str("type") == "frame" {
			_, hasMin := n.Get("minWidth")
			_, hasMax := n.Get("maxWidth")
			if hasMin || hasMax {
				if !IsRootFrame(doc, n) {
					return fmt.Sprintf(`minWidth and maxWidth are only valid on a root frame ("%s")`, id)
				}
				if hasMin && hasMax && n.Num("minWidth") > n.Num("maxWidth") {
					return fmt.Sprintf(`minWidth cannot be greater than maxWidth on "%s"`, id)
				}
			}
		}
		if n.Str("type") == "image" && strings.HasPrefix(n.Str("src"), "$") {
			name := n.Str("src")[1:]
			assets := doc.Obj("assets")
			if assets == nil || !assets.Has(name) {
				return fmt.Sprintf(`image "%s" src "%s" does not match an asset (set_assets)`, id, n.Str("src"))
			}
		}
	}
	return ""
}

func checkPages(doc *Document, i int) error {
	var loose []string
	hasPage := false
	for _, id := range doc.Strings("rootIds") {
		if n := GetNode(doc, id); n != nil && n.Str("type") == "page" {
			hasPage = true
		} else {
			loose = append(loose, `"`+id+`"`)
		}
	}
	if !hasPage || len(loose) == 0 {
		return nil
	}
	return opErr(i, "the document has pages, but %s is at the canvas level; move it to a page (parentId = the page id)", strings.Join(loose, ", "))
}

func Round4(v float64) float64 { return jsonv.Round(v*10_000)/10_000 + 0 }

const fitEps = 1e-3

type Box struct{ MinX, MinY, MaxX, MaxY float64 }

func numOr0(n *Node, key string) float64 {
	if v, ok := n.Get(key); ok {
		if f, isNum := v.(float64); isNum {
			return f
		}
	}
	return 0
}

func LocalBox(n *Node) Box {
	return LocalBoxSized(n, numOr0(n, "width"), numOr0(n, "height"))
}

func LocalBoxSized(n *Node, w, h float64) Box {
	if n.Str("type") == "page" {
		return Box{}
	}
	x, y := n.Num("x"), n.Num("y")
	rotation := 0.0
	if t := n.Str("type"); t != "group" && t != "connector" {
		rotation = n.Num("rotation")
	}
	if rotation == 0 {
		return Box{x, y, x + w, y + h}
	}
	rad := rotation * math.Pi / 180
	cos := math.Abs(math.Cos(rad))
	sin := math.Abs(math.Sin(rad))
	hw := (w*cos + h*sin) / 2
	hh := (w*sin + h*cos) / 2
	cx := x + w/2
	cy := y + h/2
	return Box{cx - hw, cy - hh, cx + hw, cy + hh}
}

func fitGroups(doc *Document) []any {
	var inverse []any
	var visit func(id string)
	visit = func(id string) {
		n := GetNode(doc, id)
		if n == nil || !IsContainer(n.Str("type")) {
			return
		}
		for _, c := range n.Strings("children") {
			visit(c)
		}
		if n.Str("type") == "group" && !n.Has("sourceId") {
			inverse = fitGroup(doc, n, inverse)
		}
	}
	for _, id := range doc.Strings("rootIds") {
		visit(id)
	}
	return inverse
}

func fitGroup(doc *Document, g *Node, inverse []any) []any {
	var kids []*Node
	for _, c := range g.Strings("children") {
		if k := GetNode(doc, c); k != nil && k.Str("type") != "page" && k.Str("type") != "connector" {
			kids = append(kids, k)
		}
	}
	if len(kids) == 0 {
		return inverse
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for _, k := range kids {
		b := LocalBox(k)
		minX = math.Min(minX, b.MinX)
		minY = math.Min(minY, b.MinY)
		maxX = math.Max(maxX, b.MaxX)
		maxY = math.Max(maxY, b.MaxY)
	}
	minX = Round4(minX)
	minY = Round4(minY)
	w := Round4(maxX - minX)
	h := Round4(maxY - minY)
	shift := math.Abs(minX) >= fitEps || math.Abs(minY) >= fitEps
	if !shift && math.Abs(w-g.Num("width")) < fitEps && math.Abs(h-g.Num("height")) < fitEps {
		return inverse
	}
	g = own(doc, g.Str("id"))
	if shift {
		for i, k := range kids {
			k = own(doc, k.Str("id"))
			kids[i] = k
			inverse = append(inverse, jsonv.NewObject("op", "update", "id", k.Str("id"), "props", jsonv.NewObject("x", k.Num("x"), "y", k.Num("y"))))
			k.Set("x", Round4(k.Num("x")-minX))
			k.Set("y", Round4(k.Num("y")-minY))
		}
		inverse = append(inverse, jsonv.NewObject("op", "update", "id", g.Str("id"), "props", jsonv.NewObject("x", g.Num("x"), "y", g.Num("y"))))
		g.Set("x", Round4(g.Num("x")+minX))
		g.Set("y", Round4(g.Num("y")+minY))
	}
	g.Set("width", w)
	g.Set("height", h)
	return inverse
}

func mustGet(n *Node, k string) any {
	v, _ := n.Get(k)
	return v
}

func flatten(inv any) []any {
	if list, ok := inv.([]any); ok {
		return list
	}
	return []any{inv}
}
