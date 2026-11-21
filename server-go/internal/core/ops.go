package core

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

// NewID returns a short random id (10 base36 chars), like newId() in the TypeScript core.
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

// NodeInputSchema: a partial node with optional nested children (frames only); extra keys kept.
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
			z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		)),
		z.Option("set_tokens", z.Object(
			z.Field{Name: "op", Schema: z.Literal("set_tokens")},
			z.Field{Name: "tokens", Schema: z.Record(TokenNameSchema, z.Nullable(TokenValueSchema))},
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
	)
}

const sourceIDRule = "sourceId é gerado pelas instâncias; não pode ser escrito"

func inInstance(inst string) string {
	return fmt.Sprintf(`"%s" é uma instância: o conteúdo vem do componente; edite o componente, use overrides ou desanexe (detach)`, inst)
}

func copyRule(id, inst string) string {
	return fmt.Sprintf(`"%s" é cópia dentro da instância "%s": só %s podem ser trocados (viram overrides); edite o componente ou desanexe (detach)`, id, inst, strings.Join(CopyOverrides, ", "))
}

func updatePlain(doc *Document, node *Node, props *jsonv.Object, i int) (any, error) {
	id := node.Str("id")
	allowed := KnownKeys(node.Str("type"))
	next := node.Spread()
	prev := jsonv.NewObject()
	for _, k := range props.Keys() {
		v, _ := props.Get(k)
		if ImmutableKeys[k] {
			return nil, opErr(i, `campo "%s" não pode ser alterado por update (use move/create)`, k)
		}
		if !allowed[k] {
			return nil, opErr(i, "campo desconhecido para %s: %s", node.Str("type"), k)
		}
		if node.Str("type") == "group" && (k == "width" || k == "height") {
			return nil, opErr(i, groupSize)
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
		return nil, opErr(i, `update inválido em "%s": %s`, id, formatZod(err))
	}
	Nodes(doc).Set(id, parsed)
	return jsonv.NewObject("op", "update", "id", id, "props", prev), nil
}

// updateOverride: an update on a copy (or on an instance root's fill) is stored in overrides.
func updateOverride(doc *Document, inst, node *Node, srcID string, props *jsonv.Object, i int) (any, error) {
	id := node.Str("id")
	src := GetNode(doc, srcID)
	prev := jsonv.NewObject()
	allowed := KnownKeys(node.Str("type"))
	var unknown []string
	for _, k := range props.Keys() {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		return nil, opErr(i, "campo desconhecido para %s: %s", node.Str("type"), strings.Join(unknown, ", "))
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
		return nil, opErr(i, `update inválido em "%s": %s`, id, formatZod(err))
	}
	Nodes(doc).Set(id, parsed)
	return jsonv.NewObject("op", "update", "id", id, "props", prev), nil
}

var nodeInput *z.ObjectSchema

// OpSchema is the discriminated union of operations.
var OpSchema *z.DiscUnion

// OpError is an operation failure; Index is the op position in the transaction.
type OpError struct {
	Msg   string
	Index int
}

func (e *OpError) Error() string { return fmt.Sprintf("op[%d]: %s", e.Index, e.Msg) }

func opErr(i int, format string, a ...any) *OpError { return &OpError{fmt.Sprintf(format, a...), i} }

// ApplyResult is the outcome of a transaction.
type ApplyResult struct {
	Doc     *Document
	Inverse []any // ops that undo the transaction, in application order
	Created []string
}

// listRef addresses a mutable id list (doc.rootIds or a frame's children).
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

// removeAt is Array#splice(index, 1) (index -1 removes the last element, like JavaScript).
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
		return listRef{}, opErr(i, `pai "%s" não existe`, pid)
	}
	if t := parent.Str("type"); !IsContainer(t) {
		return listRef{}, opErr(i, `pai "%s" é %s; só frame, group e page têm filhos`, pid, t)
	}
	return listRef{parent, "children"}, nil
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
	pageAtRoot = "página só pode ficar no nível do canvas (parentId null)"
	groupSize  = "width/height de um group seguem os filhos; mova ou redimensione os filhos"
)

// checkPlacement: pages only at the top. That a paged document only has pages at the top is
// checked at the end of the transaction (checkPages): mid-transaction states may be mixed.
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

// jsToNumber is Number(v) for JSON values (used by Math.ceil in path sizing).
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
	var ze *z.Error
	if errors.As(err, &ze) {
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
	if GetNode(doc, idStr) != nil {
		return opErr(i, `id "%s" já existe`, idStr)
	}
	if hasChildren && !IsContainer(typ) {
		return opErr(i, "só frame, group e page aceitam children (recebido %s)", typ)
	}
	allowed := KnownKeys(typ)
	var unknown []string
	for _, k := range rest.Keys() {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		return opErr(i, "campos desconhecidos para %s: %s", typ, strings.Join(unknown, ", "))
	}
	if rest.Has("parentId") {
		return opErr(i, "use o parentId da operação, não do nó")
	}
	if typ == "group" && (rest.Has("width") || rest.Has("height")) {
		return opErr(i, groupSize)
	}
	if rest.Has("sourceId") {
		return opErr(i, sourceIDRule)
	}
	if owner := InstanceOwner(doc, parentID); owner != nil {
		return opErr(i, "%s", inInstance(owner.Str("id")))
	}
	if inst, ok := rest.Get("instanceOf"); ok {
		if _, isStr := inst.(string); isStr && hasChildren && len(childrenV.([]any)) > 0 {
			return opErr(i, "os filhos de uma instância vêm do componente; crie a instância sem children")
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
	// Without width/height a path gets the box of its own drawing (or of its viewBox).
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
				w, h = 100, 100 // the `d` error comes from validation below, with its position
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
	props.Set("id", idStr)
	props.Set("parentId", parentID)
	if IsContainer(typ) {
		props.Set("children", []any{})
	} else {
		props.Delete("children")
	}
	parsed, perr := z.Parse(NodeSchema, props)
	if perr != nil {
		return opErr(i, "nó inválido: %s", formatZod(perr))
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

// jsMax1 is Math.max(1, v) (NaN propagates).
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

func applyOne(doc *Document, op *jsonv.Object, i int, created *[]string) (any, error) {
	switch op.Str("op") {
	case "create":
		parentID, _ := op.Get("parentId")
		node := op.Obj("node")
		before := len(*created)
		if err := createNode(doc, node, parentID, optIndex(op), i, created); err != nil {
			return nil, err
		}
		return jsonv.NewObject("op", "delete", "id", (*created)[before]), nil

	case "update":
		id := op.Str("id")
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, `nó "%s" não existe`, id)
		}
		props := op.Obj("props")
		if owner := CopyOwner(doc, node); owner != nil {
			var bad []string
			for _, k := range props.Keys() {
				if !inList(CopyOverrides, k) {
					bad = append(bad, k)
				}
			}
			if len(bad) > 0 {
				return nil, opErr(i, "%s (recebido %s)", copyRule(id, owner.Str("id")), strings.Join(bad, ", "))
			}
			return updateOverride(doc, owner, node, node.Str("sourceId"), props, i)
		}
		if props.Has("sourceId") && InstanceOwner(doc, mustGet(node, "parentId")) != nil {
			return nil, opErr(i, sourceIDRule)
		}
		if !IsInstance(node) {
			return updatePlain(doc, node, props, i)
		}
		var derived []string
		for _, k := range props.Keys() {
			if inList(RootDerived, k) && k != "fill" {
				derived = append(derived, k)
			}
		}
		if len(derived) > 0 {
			return nil, opErr(i, `%s de "%s" vêm do componente "%s"; edite o componente, mude scale ou desanexe (detach)`, strings.Join(derived, ", "), id, node.Str("instanceOf"))
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
				inv, err = updateOverride(doc, cur, cur, cur.Str("instanceOf"), fp, i)
			} else {
				inv, err = updatePlain(doc, cur, fp, i)
			}
			if err != nil {
				return nil, err
			}
			inverse = append([]any{inv}, inverse...)
		}
		return inverse, nil

	case "delete":
		id := op.Str("id")
		node := GetNode(doc, id)
		if node == nil {
			return nil, opErr(i, `nó "%s" não existe`, id)
		}
		if owner := CopyOwner(doc, node); owner != nil {
			return nil, opErr(i, "%s; para esconder, use visible: false", copyRule(id, owner.Str("id")))
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
		for k, n := range nodes {
			saved[k] = jsonv.Clone(n)
			Nodes(doc).Delete(n.Str("id"))
		}
		return jsonv.NewObject("op", "restore", "nodes", saved, "rootId", id, "parentId", parentID, "index", float64(index)), nil

	case "restore":
		nodes := op.Arr("nodes")
		for _, n := range nodes {
			nid := n.(*jsonv.Object).Str("id")
			if GetNode(doc, nid) != nil {
				return nil, opErr(i, `id "%s" já existe`, nid)
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
			return nil, opErr(i, `nó "%s" não existe`, id)
		}
		target, _ := op.Get("parentId")
		if ts, ok := target.(string); ok && (ts == id || isDescendant(doc, ts, id)) {
			return nil, opErr(i, `mover "%s" para dentro de si mesmo criaria um ciclo`, id)
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
		to.insertAt(id, optIndex(op))
		node.Set("parentId", target)
		return jsonv.NewObject("op", "move", "id", id, "parentId", oldParent, "index", float64(fromIndex)), nil

	case "set_tokens":
		prev := jsonv.NewObject()
		tokens := Tokens(doc)
		in := op.Obj("tokens")
		for _, k := range in.Keys() {
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
		return jsonv.NewObject("op", "set_tokens", "tokens", prev), nil

	case "rename_document":
		prev := doc.Str("name")
		doc.Set("name", op.Str("name"))
		return jsonv.NewObject("op", "rename_document", "name", prev), nil

	case "group", "ungroup", "add_page", "detach":
		// Expanded against the *current* document, inside the same transaction.
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
				return nil, opErr(i, "operação inválida: %s", formatZod(perr))
			}
			inv, aerr := applyOne(doc, parsed.(*jsonv.Object), i, created)
			if aerr != nil {
				return nil, aerr
			}
			inverse = append(flatten(inv), inverse...)
		}
		return inverse, nil
	}
	return nil, opErr(i, "operação desconhecida")
}

// ApplyOps applies a transaction atomically: the input document is never mutated.
func ApplyOps(doc *Document, ops []any) (*ApplyResult, error) {
	draft := jsonv.Clone(doc).(*jsonv.Object)
	var inverse []any
	created := []string{}
	for i, raw := range ops {
		parsed, err := z.Parse(OpSchema, raw)
		if err != nil {
			return nil, opErr(i, "operação inválida: %s", formatZod(err))
		}
		inv, err := applyOne(draft, parsed.(*jsonv.Object), i, &created)
		if err != nil {
			return nil, err
		}
		inverse = append(flatten(inv), inverse...)
	}
	if len(ops) > 0 {
		if err := checkPages(draft, len(ops)-1); err != nil {
			return nil, err
		}
		inverse = append(fitGroups(draft), inverse...)
		if err := SyncInstances(draft); err != nil {
			return nil, opErr(len(ops)-1, "%s", err.Error())
		}
		// A group holding instances only knows their size after the sync.
		inverse = append(fitGroups(draft), inverse...)
	}
	if inverse == nil {
		inverse = []any{}
	}
	return &ApplyResult{Doc: draft, Inverse: inverse, Created: created}, nil
}

// CreateDocument returns an empty valid document.
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

// ParseDocument validates and normalizes a document read from disk.
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
				return fmt.Errorf(`documento inconsistente: "%s" referenciado mas ausente`, id)
			}
			if seen[id] {
				return fmt.Errorf(`documento inconsistente: "%s" aparece mais de uma vez`, id)
			}
			if p, _ := n.Get("parentId"); p != parentID {
				return fmt.Errorf(`documento inconsistente: parentId de "%s" diverge`, id)
			}
			if n.Str("type") == "page" && parentID != nil {
				return fmt.Errorf(`documento inconsistente: página "%s" fora do nível superior`, id)
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
		return nil, errors.New("documento inconsistente: com páginas, todo nó de nível superior precisa ser página")
	}
	var orphans []string
	for _, id := range Nodes(doc).Keys() {
		if !seen[id] {
			orphans = append(orphans, id)
		}
	}
	if len(orphans) > 0 {
		return nil, fmt.Errorf("documento inconsistente: nós órfãos %s", strings.Join(orphans, ", "))
	}
	return doc, nil
}

// checkPages: in a document with pages, the top level holds only pages.
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
	return opErr(i, "o documento tem páginas, mas %s ficou no nível do canvas; mova para uma página (parentId = id da página)", strings.Join(loose, ", "))
}

// Round4 rounds computed coordinates to 4 decimals (and -0 to 0), stable across TS and Go.
func Round4(v float64) float64 { return jsonv.Round(v*10_000)/10_000 + 0 }

const fitEps = 1e-3

// Box is an axis-aligned box in the parent's coordinates.
type Box struct{ MinX, MinY, MaxX, MaxY float64 }

func numOr0(n *Node, key string) float64 {
	if v, ok := n.Get(key); ok {
		if f, isNum := v.(float64); isNum {
			return f
		}
	}
	return 0
}

// LocalBox is a node's box in its parent (its own rotation around the center included).
func LocalBox(n *Node) Box {
	if n.Str("type") == "page" {
		return Box{}
	}
	x, y := n.Num("x"), n.Num("y")
	w, h := numOr0(n, "width"), numOr0(n, "height")
	rotation := 0.0
	if n.Str("type") != "group" {
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

// fitGroups fits every group's box to its children (deepest first), keeping the drawing still.
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
		if k := GetNode(doc, c); k != nil && k.Str("type") != "page" {
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
	if shift {
		for _, k := range kids {
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

// flatten turns applyOne's inverse (one op, or a list for composite ops) into a list.
func flatten(inv any) []any {
	if list, ok := inv.([]any); ok {
		return list
	}
	return []any{inv}
}
