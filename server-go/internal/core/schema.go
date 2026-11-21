// Package core is the Go port of @paprika/core: document model, atomic operations, undo history,
// style engine, HTML/React export, lint and outline. The TypeScript package is the reference;
// parity is locked by fixtures generated from it (see testdata/golden.json).
package core

import (
	"regexp"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

// Format of the `.paprika.json` file.
const Format = "paprika/1"

var (
	reColorForbidden = regexp.MustCompile(`[;{}<>]`)
	reFontForbidden  = regexp.MustCompile(`[;{}<>()]`)
	reImageSrc       = regexp.MustCompile(`^(https?:|data:image/)`)
)

// ColorValue: a CSS color or a `$token` reference.
func colorValue() *z.StringSchema {
	return z.String().Min(1).Max(200).Refine(func(v string) string {
		if reColorForbidden.MatchString(v) {
			return "cor não pode conter ; { } < >"
		}
		return ""
	})
}

func size() z.Schema {
	return z.Union(z.Number().Min(0).Max(100_000), z.Enum("hug", "fill"))
}

var (
	strokeSchema = z.Object(
		z.Field{Name: "color", Schema: colorValue()},
		z.Field{Name: "width", Schema: z.Number().Min(0).Max(1000)},
	)
	shadowSchema = z.Object(
		z.Field{Name: "x", Schema: z.Number()},
		z.Field{Name: "y", Schema: z.Number()},
		z.Field{Name: "blur", Schema: z.Number().Min(0)},
		z.Field{Name: "spread", Schema: z.Default(z.Number(), 0.0)},
		z.Field{Name: "color", Schema: colorValue()},
	)
	layoutSchema = z.Object(
		z.Field{Name: "mode", Schema: z.Default(z.Enum("none", "row", "column"), "none")},
		z.Field{Name: "gap", Schema: z.Default(z.Number().Min(0), 0.0)},
		z.Field{Name: "padding", Schema: z.Default(z.Union(
			z.Number().Min(0),
			z.Tuple(z.Number().Min(0), z.Number().Min(0), z.Number().Min(0), z.Number().Min(0)),
		), 0.0)},
		z.Field{Name: "align", Schema: z.Default(z.Enum("start", "center", "end", "stretch"), "start")},
		z.Field{Name: "justify", Schema: z.Default(z.Enum("start", "center", "end", "between"), "start")},
		z.Field{Name: "wrap", Schema: z.Default(z.Bool(), false)},
	)
)

func baseFields() []z.Field {
	return []z.Field{
		{Name: "id", Schema: z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "id deve ser [A-Za-z0-9_-]{1,64}")},
		{Name: "name", Schema: z.Default(z.String().Max(200), "")},
		{Name: "parentId", Schema: z.Default(z.Nullable(z.String()), nil)},
		{Name: "x", Schema: z.Default(z.Number(), 0.0)},
		{Name: "y", Schema: z.Default(z.Number(), 0.0)},
		{Name: "width", Schema: z.Default(size(), 100.0)},
		{Name: "height", Schema: z.Default(size(), 100.0)},
		{Name: "rotation", Schema: z.Default(z.Number(), 0.0)},
		{Name: "opacity", Schema: z.Default(z.Number().Min(0).Max(1), 1.0)},
		{Name: "visible", Schema: z.Default(z.Bool(), true)},
		{Name: "locked", Schema: z.Default(z.Bool(), false)},
		{Name: "fill", Schema: z.Optional(colorValue())},
		{Name: "stroke", Schema: z.Optional(strokeSchema)},
		{Name: "radius", Schema: z.Default(z.Number().Min(0), 0.0)},
		{Name: "shadow", Schema: z.Optional(shadowSchema)},
		{Name: "notes", Schema: z.Optional(z.String().Max(4000))},
	}
}

func nodeSchema(typ string, extra ...z.Field) *z.ObjectSchema {
	fields := append(baseFields(), z.Field{Name: "type", Schema: z.Literal(typ)})
	return z.Object(append(fields, extra...)...)
}

// NodeTypes in schema order.
var NodeTypes = []string{"frame", "rect", "ellipse", "text", "image", "path"}

// NodeSchemas by type.
var NodeSchemas = map[string]*z.ObjectSchema{
	"frame": nodeSchema("frame",
		z.Field{Name: "children", Schema: z.Default(z.Array(z.String()), []any{})},
		z.Field{Name: "clip", Schema: z.Default(z.Bool(), true)},
		z.Field{Name: "layout", Schema: z.Optional(layoutSchema)},
	),
	"rect":    nodeSchema("rect"),
	"ellipse": nodeSchema("ellipse"),
	"text": nodeSchema("text",
		z.Field{Name: "text", Schema: z.Default(z.String().Max(20_000), "")},
		z.Field{Name: "color", Schema: z.Default(colorValue(), "#111111")},
		z.Field{Name: "fontFamily", Schema: z.Default(z.String().Max(200).Refine(func(v string) string {
			if reFontForbidden.MatchString(v) {
				return "fontFamily não pode conter ; { } < > ( )"
			}
			return ""
		}), "Inter, system-ui, sans-serif")},
		z.Field{Name: "fontSize", Schema: z.Default(z.Union(
			z.Number().Min(1).Max(1000),
			z.String().Regex(`^\$[A-Za-z0-9_.-]+$`, `/^\$[\w.-]+$/`, ""),
		), 16.0)},
		z.Field{Name: "fontWeight", Schema: z.Default(z.Int().Min(100).Max(900), 400.0)},
		z.Field{Name: "lineHeight", Schema: z.Default(z.Number().Min(0).Max(10), 1.4)},
		z.Field{Name: "letterSpacing", Schema: z.Default(z.Number(), 0.0)},
		z.Field{Name: "textAlign", Schema: z.Default(z.Enum("left", "center", "right"), "left")},
	),
	"image": nodeSchema("image",
		z.Field{Name: "src", Schema: z.String().Max(5_000_000).Refine(func(v string) string {
			if !reImageSrc.MatchString(v) {
				return "src deve ser http(s) ou data:image/"
			}
			return ""
		})},
		z.Field{Name: "fit", Schema: z.Default(z.Enum("cover", "contain", "fill"), "cover")},
		z.Field{Name: "alt", Schema: z.Default(z.String().Max(1000), "")},
	),
	"path": nodeSchema("path",
		z.Field{Name: "d", Schema: z.String().Min(1).Max(200_000).Refine(func(v string) string {
			if msg := PathErrorMessage(v); msg != "" {
				return "d inválido: " + msg
			}
			return ""
		})},
		z.Field{Name: "fillRule", Schema: z.Default(z.Enum("nonzero", "evenodd"), "nonzero")},
		z.Field{Name: "strokeCap", Schema: z.Default(z.Enum("butt", "round", "square"), "round")},
		z.Field{Name: "strokeJoin", Schema: z.Default(z.Enum("miter", "round", "bevel"), "round")},
		z.Field{Name: "viewBox", Schema: z.Optional(z.Tuple(z.Number(), z.Number(), z.Number().Positive(), z.Number().Positive()))},
	),
}

// NodeSchema is the discriminated union of all node types.
var NodeSchema = func() *z.DiscUnion {
	opts := make([]struct {
		Value  string
		Schema z.Schema
	}, len(NodeTypes))
	for i, t := range NodeTypes {
		opts[i] = z.Option(t, NodeSchemas[t])
	}
	return z.DiscriminatedUnion("type", opts...)
}()

// NodeTypeSchema is z.enum(NodeTypes).
var NodeTypeSchema = z.Enum(NodeTypes...)

var (
	TokenValueSchema = z.Union(z.String().Max(500), z.Number())
	TokenNameSchema  = z.String().Regex(`^[A-Za-z0-9_.-]{1,100}$`, `/^[\w.-]{1,100}$/`, `nome de token deve ser [\w.-]{1,100}`)
)

// DocumentSchema validates a whole document.
var DocumentSchema = z.Object(
	z.Field{Name: "format", Schema: z.Literal(Format)},
	z.Field{Name: "id", Schema: z.String()},
	z.Field{Name: "name", Schema: z.Default(z.String(), "Sem título")},
	z.Field{Name: "tokens", Schema: z.Default(z.Record(TokenNameSchema, TokenValueSchema), jsonv.NewObject())},
	z.Field{Name: "rootIds", Schema: z.Default(z.Array(z.String()), []any{})},
	z.Field{Name: "nodes", Schema: z.Default(z.Record(z.String(), NodeSchema), jsonv.NewObject())},
)

// ImmutableKeys cannot be changed by an `update` op.
var ImmutableKeys = map[string]bool{"id": true, "type": true, "parentId": true, "children": true}

// KnownKeys lists the accepted fields of a node type.
func KnownKeys(typ string) map[string]bool {
	out := map[string]bool{}
	for _, k := range NodeSchemas[typ].Keys() {
		out[k] = true
	}
	return out
}

// Document is a validated `.paprika.json` document (an ordered JSON object, as in JavaScript).
type Document = jsonv.Object

// Node is a validated node.
type Node = jsonv.Object

// Nodes returns doc.nodes.
func Nodes(doc *Document) *jsonv.Object { return doc.Obj("nodes") }

// Tokens returns doc.tokens.
func Tokens(doc *Document) *jsonv.Object { return doc.Obj("tokens") }

// GetNode returns doc.nodes[id] or nil.
func GetNode(doc *Document, id string) *Node { return Nodes(doc).Obj(id) }

// ParentID returns the node's parentId ("" for top level).
func ParentID(n *Node) (string, bool) {
	v, _ := n.Get("parentId")
	s, ok := v.(string)
	return s, ok
}
