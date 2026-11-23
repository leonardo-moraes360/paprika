// Package core is the Go port of @paprika/core: document model, atomic operations, undo history,
// style engine, HTML/React export, lint and outline. The TypeScript package is the reference;
// parity is locked by fixtures generated from it (see testdata/golden.json).
package core

import (
	"fmt"
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
			return "a color cannot contain ; { } < >"
		}
		return ""
	})
}

func size() z.Schema {
	return z.Union(z.Number().Min(0).Max(100_000), z.Enum("hug", "fill"))
}

var lengthTokenRe = regexp.MustCompile(`^\$[A-Za-z0-9_.-]+$`)

func lengthToken() z.Schema {
	return z.String().Regex(`^\$[A-Za-z0-9_.-]+$`, `/^\$[\w.-]+$/`, "")
}

func lengthAny() z.Schema { return z.NumberOrToken(z.Number(), lengthTokenRe) }

func lengthMin(min float64) z.Schema {
	return z.NumberOrToken(z.Number().Min(min), lengthTokenRe)
}

func lengthMinMax(min, max float64) z.Schema {
	return z.NumberOrToken(z.Number().Min(min).Max(max), lengthTokenRe)
}

var (
	strokeSchema = z.Object(
		z.Field{Name: "color", Schema: colorValue()},
		z.Field{Name: "width", Schema: lengthMinMax(0, 1000)},
		z.Field{Name: "style", Schema: z.Optional(z.Enum("solid", "dashed", "dotted"))},
		z.Field{Name: "position", Schema: z.Optional(z.Enum("inside", "center", "outside"))},
	)
	shadowSchema = z.Object(
		z.Field{Name: "x", Schema: lengthAny()},
		z.Field{Name: "y", Schema: lengthAny()},
		z.Field{Name: "blur", Schema: lengthMin(0)},
		z.Field{Name: "spread", Schema: z.Default(lengthAny(), 0.0)},
		z.Field{Name: "color", Schema: colorValue()},
		z.Field{Name: "inner", Schema: z.Optional(z.Bool())},
	)
	shadowValue   = z.Union(shadowSchema, z.Array(shadowSchema).Min(1).Max(8))
	outlineSchema = z.Object(
		z.Field{Name: "color", Schema: colorValue()},
		z.Field{Name: "width", Schema: lengthMinMax(0, 1000)},
		z.Field{Name: "style", Schema: z.Optional(z.Enum("solid", "dashed", "dotted"))},
		z.Field{Name: "offset", Schema: z.Optional(lengthMinMax(-1000, 1000))},
	)
	filterSchema = z.Object(
		z.Field{Name: "blur", Schema: z.Optional(lengthMinMax(0, 1000))},
		z.Field{Name: "saturate", Schema: z.Optional(z.Number().Min(0).Max(10))},
		z.Field{Name: "grayscale", Schema: z.Optional(z.Number().Min(0).Max(1))},
		z.Field{Name: "brightness", Schema: z.Optional(z.Number().Min(0).Max(10))},
		z.Field{Name: "sepia", Schema: z.Optional(z.Number().Min(0).Max(1))},
		z.Field{Name: "invert", Schema: z.Optional(z.Number().Min(0).Max(1))},
		z.Field{Name: "hueRotate", Schema: z.Optional(z.Number().Min(-360).Max(360))},
	).Check(func(v any) string {
		o, _ := v.(*jsonv.Object)
		if o != nil {
			for _, k := range []string{"blur", "saturate", "grayscale", "brightness", "sepia", "invert", "hueRotate"} {
				if _, ok := o.Get(k); ok {
					return ""
				}
			}
		}
		return "filter needs at least one of blur, saturate, grayscale, brightness, sepia, invert, hueRotate"
	})
	padLength          = lengthMin(0)
	cornerOne          = lengthMin(0)
	gradientStopSchema = z.Object(
		z.Field{Name: "color", Schema: colorValue()},
		z.Field{Name: "offset", Schema: z.Number().Min(0).Max(1)},
	)
	gradientSchema = z.Object(
		z.Field{Name: "type", Schema: z.Enum("linear", "radial", "conic")},
		z.Field{Name: "angle", Schema: z.Default(z.Number().Min(-3600).Max(3600), 180.0)},
		z.Field{Name: "cx", Schema: z.Default(z.Number().Min(0).Max(1), 0.5)},
		z.Field{Name: "cy", Schema: z.Default(z.Number().Min(0).Max(1), 0.5)},
		z.Field{Name: "radius", Schema: z.Default(z.Number().Min(0).Max(2), 0.5)},
		z.Field{Name: "stops", Schema: z.Array(gradientStopSchema).Min(2).Max(12)},
	)
	layoutSchema = z.Object(
		z.Field{Name: "mode", Schema: z.Default(z.Enum("none", "row", "column"), "none")},
		z.Field{Name: "gap", Schema: z.Default(lengthMin(0), 0.0)},
		z.Field{Name: "padding", Schema: z.Default(z.Union(
			padLength,
			z.Tuple(padLength, padLength, padLength, padLength),
		), 0.0)},
		z.Field{Name: "align", Schema: z.Default(z.Enum("start", "center", "end", "stretch"), "start")},
		z.Field{Name: "justify", Schema: z.Default(z.Enum("start", "center", "end", "between"), "start")},
		z.Field{Name: "wrap", Schema: z.Default(z.Bool(), false)},
	)
)

func baseFields() []z.Field {
	return []z.Field{
		{Name: "id", Schema: z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "id must be [A-Za-z0-9_-]{1,64}")},
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
		{Name: "layoutPositioning", Schema: z.Optional(z.Enum("auto", "absolute"))},
		{Name: "constraints", Schema: z.Optional(z.Object(
			z.Field{Name: "horizontal", Schema: z.Default(z.Enum("left", "right", "center", "scale"), "left")},
			z.Field{Name: "vertical", Schema: z.Default(z.Enum("top", "bottom", "center", "scale"), "top")},
		))},
		{Name: "fill", Schema: z.Optional(colorValue())},
		{Name: "gradient", Schema: z.Optional(gradientSchema)},
		{Name: "stroke", Schema: z.Optional(strokeSchema)},
		{Name: "radius", Schema: z.Default(lengthMin(0), 0.0)},
		{Name: "shadow", Schema: z.Optional(shadowValue)},
		{Name: "outline", Schema: z.Optional(outlineSchema)},
		{Name: "filter", Schema: z.Optional(filterSchema)},
		{Name: "backdropFilter", Schema: z.Optional(filterSchema)},
		{Name: "notes", Schema: z.Optional(z.String().Max(4000))},
		{Name: "sourceId", Schema: z.Optional(z.String())},
		{Name: "lintIgnore", Schema: z.Optional(z.Array(z.String().Regex(`^[a-z0-9-]{1,40}$`, `/^[a-z0-9-]{1,40}$/`, "lint rule must be [a-z0-9-]{1,40}")).Max(20))},
	}
}

func nodeSchema(typ string, extra ...z.Field) *z.ObjectSchema {
	fields := append(baseFields(), z.Field{Name: "type", Schema: z.Literal(typ)})
	return z.Object(append(fields, extra...)...)
}

// NodeTypes in schema order.
var NodeTypes = []string{"frame", "rect", "ellipse", "text", "image", "path", "group", "page", "shape", "connector"}

// baseField returns one of the base fields by name.
func baseField(name string) z.Field {
	for _, f := range baseFields() {
		if f.Name == name {
			return f
		}
	}
	panic("unknown base field " + name)
}

// groupSchema: a container that paints nothing; its box follows the children (see fitGroups).
func groupSchema() *z.ObjectSchema {
	return z.Object(
		baseField("id"), baseField("name"), baseField("parentId"),
		z.Field{Name: "type", Schema: z.Literal("group")},
		baseField("x"), baseField("y"),
		z.Field{Name: "width", Schema: z.Default(z.Number().Min(0), 0.0)},
		z.Field{Name: "height", Schema: z.Default(z.Number().Min(0), 0.0)},
		baseField("opacity"), baseField("visible"), baseField("locked"), baseField("notes"), baseField("sourceId"), baseField("lintIgnore"),
		baseField("layoutPositioning"),
		baseField("constraints"),
		z.Field{Name: "children", Schema: z.Default(z.Array(z.String()), []any{})},
	)
}

// pageSchema: a separate canvas in the file, top level only, without geometry.
func pageSchema() *z.ObjectSchema {
	return z.Object(
		baseField("id"), baseField("name"), baseField("parentId"),
		z.Field{Name: "type", Schema: z.Literal("page")},
		z.Field{Name: "fill", Schema: z.Optional(colorValue())},
		z.Field{Name: "gradient", Schema: z.Optional(gradientSchema)},
		z.Field{Name: "mode", Schema: z.Optional(ModeNameSchema)},
		baseField("notes"), baseField("lintIgnore"),
		z.Field{Name: "children", Schema: z.Default(z.Array(z.String()), []any{})},
	)
}

func fontFamilySchema() z.Schema {
	return z.Default(z.String().Max(200).Refine(func(v string) string {
		if reFontForbidden.MatchString(v) {
			return "fontFamily cannot contain ; { } < > ( )"
		}
		return ""
	}), "Inter, system-ui, sans-serif")
}

func fontSizeSchema() z.Schema {
	return z.Default(z.Union(
		z.Number().Min(1).Max(1000),
		lengthToken(),
	), 16.0)
}

func fontWeightSchema(def float64) z.Schema {
	return z.Default(z.Union(z.Int().Min(100).Max(900), lengthToken()), def)
}

// ShapeKinds: the outlines a diagram shape can take.
var ShapeKinds = []string{"rect", "ellipse", "diamond", "triangle", "note"}

// shapeSchema: a diagram shape with text inside (see diagram.go).
func shapeSchema() *z.ObjectSchema {
	fields := baseFields()
	for k, f := range fields {
		switch f.Name {
		case "width":
			fields[k].Schema = z.Default(z.Number().Min(1).Max(100_000), 160.0)
		case "height":
			fields[k].Schema = z.Default(z.Number().Min(1).Max(100_000), 80.0)
		}
	}
	fields = append(fields,
		z.Field{Name: "type", Schema: z.Literal("shape")},
		z.Field{Name: "shape", Schema: z.Default(z.Enum(ShapeKinds...), "rect")},
		z.Field{Name: "text", Schema: z.Default(z.String().Max(20_000), "")},
		z.Field{Name: "color", Schema: z.Default(colorValue(), "#1e2336")},
		z.Field{Name: "fontFamily", Schema: fontFamilySchema()},
		z.Field{Name: "fontSize", Schema: fontSizeSchema()},
		z.Field{Name: "fontWeight", Schema: fontWeightSchema(500)},
		z.Field{Name: "lineHeight", Schema: z.Default(lengthMinMax(0, 10), 1.3)},
		z.Field{Name: "textAlign", Schema: z.Default(z.Enum("left", "center", "right"), "center")},
	)
	return z.Object(fields...)
}

func connectorEndSchema() z.Schema {
	return z.Object(
		z.Field{Name: "nodeId", Schema: z.Optional(z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "nodeId must be [A-Za-z0-9_-]{1,64}"))},
		z.Field{Name: "side", Schema: z.Optional(z.Enum("auto", "top", "right", "bottom", "left"))},
		z.Field{Name: "x", Schema: z.Optional(z.Number())},
		z.Field{Name: "y", Schema: z.Optional(z.Number())},
	)
}

// connectorSchema: a line/arrow between two nodes; x, y, width, height and d are derived (see diagram.go).
func connectorSchema() *z.ObjectSchema {
	return z.Object(
		baseField("id"), baseField("name"), baseField("parentId"),
		z.Field{Name: "type", Schema: z.Literal("connector")},
		baseField("x"), baseField("y"),
		z.Field{Name: "width", Schema: z.Default(z.Number().Min(0), 0.0)},
		z.Field{Name: "height", Schema: z.Default(z.Number().Min(0), 0.0)},
		baseField("opacity"), baseField("visible"), baseField("locked"), baseField("notes"), baseField("sourceId"), baseField("lintIgnore"),
		baseField("layoutPositioning"),
		z.Field{Name: "from", Schema: connectorEndSchema()},
		z.Field{Name: "to", Schema: connectorEndSchema()},
		z.Field{Name: "route", Schema: z.Default(z.Enum("straight", "elbow", "rounded", "curve"), "straight")},
		z.Field{Name: "radius", Schema: z.Default(z.Number().Min(0).Max(1000), 0.0)},
		z.Field{Name: "control", Schema: z.Optional(z.Object(
			z.Field{Name: "x", Schema: z.Number()},
			z.Field{Name: "y", Schema: z.Number()},
		))},
		z.Field{Name: "startArrow", Schema: z.Default(z.Enum("none", "arrow"), "none")},
		z.Field{Name: "endArrow", Schema: z.Default(z.Enum("none", "arrow"), "arrow")},
		z.Field{Name: "stroke", Schema: z.Default(strokeSchema, jsonv.NewObject("color", "#1e2336", "width", 2.0))},
		z.Field{Name: "dashed", Schema: z.Default(z.Bool(), false)},
		z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))},
		z.Field{Name: "d", Schema: z.Default(z.String().Max(10_000), "")},
	)
}

// StrokeSchema is Stroke in schema.ts ({color, width}).
var StrokeSchema = strokeSchema

// ConnectorSideSchema is ConnectorSide in schema.ts.
var ConnectorSideSchema = z.Enum("auto", "top", "right", "bottom", "left")

// IsContainer reports whether a node type takes children.
func IsContainer(typ string) bool { return typ == "frame" || typ == "group" || typ == "page" }

// FirstPage returns the first top-level node when it is a page (the document has pages), or nil.
func FirstPage(doc *Document) *Node {
	roots := doc.Strings("rootIds")
	if len(roots) == 0 {
		return nil
	}
	if n := GetNode(doc, roots[0]); n != nil && n.Str("type") == "page" {
		return n
	}
	return nil
}

// PageRoots lists the top-level nodes of a page ("" = the first page, or the document without pages).
func PageRoots(doc *Document, pageID string) ([]string, error) {
	var page *Node
	if pageID != "" {
		page = GetNode(doc, pageID)
		if page == nil || page.Str("type") != "page" {
			return nil, fmt.Errorf(`page "%s" does not exist`, pageID)
		}
	} else {
		page = FirstPage(doc)
	}
	if page != nil {
		return page.Strings("children"), nil
	}
	return doc.Strings("rootIds"), nil
}

func cornerRadiusSchema() z.Schema {
	return z.Default(z.Union(cornerOne, z.Tuple(cornerOne, cornerOne, cornerOne, cornerOne)), 0.0)
}

// NodeSchemas by type.
var NodeSchemas = map[string]*z.ObjectSchema{
	"frame": nodeSchema("frame",
		z.Field{Name: "children", Schema: z.Default(z.Array(z.String()), []any{})},
		z.Field{Name: "clip", Schema: z.Default(z.Bool(), true)},
		z.Field{Name: "layout", Schema: z.Optional(layoutSchema)},
		z.Field{Name: "component", Schema: z.Optional(z.Bool())},
		z.Field{Name: "instanceOf", Schema: z.Optional(z.String())},
		z.Field{Name: "scale", Schema: z.Optional(z.Number().Min(0.01).Max(100))},
		z.Field{Name: "overrides", Schema: z.Optional(overridesSchema())},
		z.Field{Name: "mode", Schema: z.Optional(ModeNameSchema)},
		z.Field{Name: "scaledMock", Schema: z.Optional(z.Bool())},
	).Extend(z.Field{Name: "radius", Schema: cornerRadiusSchema()}),
	"rect":    nodeSchema("rect").Extend(z.Field{Name: "radius", Schema: cornerRadiusSchema()}),
	"ellipse": nodeSchema("ellipse"),
	"text": nodeSchema("text",
		z.Field{Name: "text", Schema: z.Default(z.String().Max(20_000), "")},
		z.Field{Name: "color", Schema: z.Default(colorValue(), "#111111")},
		z.Field{Name: "fontFamily", Schema: z.Default(z.String().Max(200).Refine(func(v string) string {
			if reFontForbidden.MatchString(v) {
				return "fontFamily cannot contain ; { } < > ( )"
			}
			return ""
		}), "Inter, system-ui, sans-serif")},
		z.Field{Name: "fontSize", Schema: fontSizeSchema()},
		z.Field{Name: "fontWeight", Schema: fontWeightSchema(400)},
		z.Field{Name: "lineHeight", Schema: z.Default(lengthMinMax(0, 10), 1.4)},
		z.Field{Name: "letterSpacing", Schema: z.Default(lengthAny(), 0.0)},
		z.Field{Name: "textAlign", Schema: z.Default(z.Enum("left", "center", "right"), "left")},
	),
	"image": nodeSchema("image",
		z.Field{Name: "src", Schema: z.String().Max(5_000_000).Refine(func(v string) string {
			if !reImageSrc.MatchString(v) {
				return "src must be http(s) or data:image/"
			}
			return ""
		})},
		z.Field{Name: "fit", Schema: z.Default(z.Enum("cover", "contain", "fill"), "cover")},
		z.Field{Name: "alt", Schema: z.Default(z.String().Max(1000), "")},
	).Extend(z.Field{Name: "radius", Schema: cornerRadiusSchema()}),
	"path": nodeSchema("path",
		z.Field{Name: "d", Schema: z.String().Min(1).Max(200_000).Refine(func(v string) string {
			if msg := PathErrorMessage(v); msg != "" {
				return "invalid d: " + msg
			}
			return ""
		})},
		z.Field{Name: "fillRule", Schema: z.Default(z.Enum("nonzero", "evenodd"), "nonzero")},
		z.Field{Name: "strokeCap", Schema: z.Default(z.Enum("butt", "round", "square"), "round")},
		z.Field{Name: "strokeJoin", Schema: z.Default(z.Enum("miter", "round", "bevel"), "round")},
		z.Field{Name: "viewBox", Schema: z.Optional(z.Tuple(z.Number(), z.Number(), z.Number().Positive(), z.Number().Positive()))},
	),
	"group":     groupSchema(),
	"page":      pageSchema(),
	"shape":     shapeSchema(),
	"connector": connectorSchema(),
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
	TokenNameSchema  = z.String().Regex(`^[A-Za-z0-9_.-]{1,100}$`, `/^[\w.-]{1,100}$/`, `token name must be [\w.-]{1,100}`).
				Refine(func(v string) string { return notProto(v, "token name cannot be __proto__") })
)

// DocumentSchema validates a whole document.
var DocumentSchema = z.Object(
	z.Field{Name: "format", Schema: z.Literal(Format)},
	z.Field{Name: "id", Schema: z.String()},
	z.Field{Name: "name", Schema: z.Default(z.String(), "Untitled")},
	z.Field{Name: "tokens", Schema: z.Default(z.Record(TokenNameSchema, TokenValueSchema), jsonv.NewObject())},
	z.Field{Name: "modes", Schema: z.Optional(z.Record(ModeNameSchema, z.Record(TokenNameSchema, TokenValueSchema)))},
	z.Field{Name: "tokenMeta", Schema: z.Optional(z.Record(TokenNameSchema, TokenMetaSchema))},
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

// ModeNameSchema is ModeName in schema.ts: the name of a theme mode.
var ModeNameSchema = z.String().Regex(`^[A-Za-z0-9_-]{1,40}$`, `/^[A-Za-z0-9_-]{1,40}$/`, "mode name must be [A-Za-z0-9_-]{1,40}").
	Refine(func(v string) string { return notProto(v, "mode name cannot be __proto__") })

// notProto rejects "__proto__" as a map key (parity with the TS reference, which writes to plain objects).
func notProto(v, msg string) string {
	if v == "__proto__" {
		return msg
	}
	return ""
}

// Modes returns doc.modes (nil when the document has none).
func Modes(doc *Document) *jsonv.Object { return doc.Obj("modes") }

func TokenMeta(doc *Document) *jsonv.Object { return doc.Obj("tokenMeta") }

var TokenTypeSchema = z.Enum("color", "length", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing")

var CollectionNameSchema = z.String().Regex(`^[A-Za-z0-9_-]{1,40}$`, `/^[A-Za-z0-9_-]{1,40}$/`, "collection name must be [A-Za-z0-9_-]{1,40}").
	Refine(func(v string) string { return notProto(v, "collection name cannot be __proto__") })

var TokenMetaSchema = z.Object(
	z.Field{Name: "type", Schema: z.Optional(TokenTypeSchema)},
	z.Field{Name: "collection", Schema: z.Optional(CollectionNameSchema)},
)

// overridesSchema is Overrides in schema.ts: keys shaped like node ids and field names.
func overridesSchema() z.Schema {
	source := z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "id must be [A-Za-z0-9_-]{1,64}")
	field := z.String().Regex(`^[A-Za-z]{1,32}$`, `/^[A-Za-z]{1,32}$/`, "field must be [A-Za-z]{1,32}")
	return z.Record(source, z.Record(field, z.Unknown()))
}
