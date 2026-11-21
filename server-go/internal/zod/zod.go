// Package zod is a small validator that reproduces the subset of zod v4 behavior the Paprika
// TypeScript reference relies on: the same defaults, the same stripping of unknown keys, the
// same issue order and the same messages ("Invalid input: expected number, received string"…).
// Agents read these messages, so the Go server must say exactly what the TypeScript one says.
package zod

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Issue is one validation problem. Fields is the full zod issue (ordered like zod emits it) for
// JSON output; Path and Message are what the formatter needs.
type Issue struct {
	Code    string
	Path    []any
	Message string
	pre     []any // ordered key/value pairs that come before "path" in zod's JSON
	// cont marks issues from checks (min, max, regex, refine): zod keeps parsing after them and a
	// union whose only failing option has nothing but such issues reports them instead of "Invalid input".
	cont bool
}

// JSON returns the issue as zod serializes it inside ZodError#message.
func (i Issue) JSON() *jsonv.Object {
	o := jsonv.NewObject(i.pre...)
	path := make([]any, len(i.Path))
	for k, p := range i.Path {
		if n, ok := p.(int); ok {
			path[k] = float64(n)
		} else {
			path[k] = p
		}
	}
	o.Set("path", path)
	o.Set("message", i.Message)
	return o
}

// Error carries the issues of a failed parse.
type Error struct{ Issues []Issue }

// Error is ZodError#message: the issues as pretty JSON.
func (e *Error) Error() string {
	arr := make([]any, len(e.Issues))
	for i, is := range e.Issues {
		arr[i] = is.JSON()
	}
	return jsonv.Stringify(arr, "  ")
}

// Format joins issues as `path: message` (the format used by applyOps errors).
func Format(e *Error) string {
	parts := make([]string, len(e.Issues))
	for i, is := range e.Issues {
		p := DotPath(is.Path, ".")
		if p == "" {
			p = "(root)"
		}
		parts[i] = p + ": " + is.Message
	}
	return strings.Join(parts, "; ")
}

// DotPath joins a path with sep (numbers rendered as plain indexes).
func DotPath(path []any, sep string) string {
	s := make([]string, len(path))
	for i, p := range path {
		s[i] = fmt.Sprint(p)
	}
	return strings.Join(s, sep)
}

// SDKFormat is the MCP TypeScript SDK's getParseErrorMessage: `message at a.b[0]`, one per line.
func SDKFormat(e *Error) string {
	lines := make([]string, len(e.Issues))
	for i, is := range e.Issues {
		if len(is.Path) == 0 {
			lines[i] = is.Message
			continue
		}
		var b strings.Builder
		for k, p := range is.Path {
			switch t := p.(type) {
			case int:
				if k == 0 {
					fmt.Fprint(&b, t)
				} else {
					fmt.Fprintf(&b, "[%d]", t)
				}
			default:
				if k > 0 {
					b.WriteByte('.')
				}
				fmt.Fprint(&b, t)
			}
		}
		lines[i] = is.Message + " at " + b.String()
	}
	return strings.Join(lines, "\n")
}

type ctx struct{ issues []Issue }

func (c *ctx) add(path []any, code, msg string, pre ...any) {
	p := append([]any(nil), path...)
	c.issues = append(c.issues, Issue{Code: code, Path: p, Message: msg, pre: pre})
}

// addCheck records a non-aborting issue (zod's `continue: true`).
func (c *ctx) addCheck(path []any, code, msg string, pre ...any) {
	c.add(path, code, msg, pre...)
	c.issues[len(c.issues)-1].cont = true
}

func push(path []any, seg any) []any {
	p := make([]any, len(path)+1)
	copy(p, path)
	p[len(path)] = seg
	return p
}

// Schema validates and transforms a JSON value. present=false means "undefined".
type Schema interface {
	parse(v any, present bool, path []any, c *ctx) (out any, outPresent bool)
}

// Parse validates v and returns the transformed value.
func Parse(s Schema, v any) (any, error) {
	c := &ctx{}
	out, _ := s.parse(v, true, nil, c)
	if len(c.issues) > 0 {
		return nil, &Error{Issues: c.issues}
	}
	return out, nil
}

// ParseUndefined validates an absent value (`schema.safeParse(undefined)`).
func ParseUndefined(s Schema) (any, bool, error) {
	c := &ctx{}
	out, ok := s.parse(nil, false, nil, c)
	if len(c.issues) > 0 {
		return nil, false, &Error{Issues: c.issues}
	}
	return out, ok, nil
}

func invalidType(c *ctx, path []any, expected string, v any, present bool) {
	c.add(path, "invalid_type", fmt.Sprintf("Invalid input: expected %s, received %s", expected, jsonv.TypeName(v, present)),
		"expected", expected, "code", "invalid_type")
}

// ---- string ----

type check struct {
	regex   *regexp.Regexp
	pattern string // JavaScript source of the regex, for messages
	msg     string
	refine  func(string) string
}

type StringSchema struct {
	min, max *int
	checks   []check
}

func String() *StringSchema { return &StringSchema{} }

func (s *StringSchema) Min(n int) *StringSchema { s.min = &n; return s }
func (s *StringSchema) Max(n int) *StringSchema { s.max = &n; return s }

// Regex adds a pattern check; msg "" uses zod's default message.
func (s *StringSchema) Regex(goRe, jsPattern, msg string) *StringSchema {
	s.checks = append(s.checks, check{regex: regexp.MustCompile(goRe), pattern: jsPattern, msg: msg})
	return s
}

// Refine adds a custom check; fn returns the error message or "".
func (s *StringSchema) Refine(fn func(string) string) *StringSchema {
	s.checks = append(s.checks, check{refine: fn})
	return s
}

func (s *StringSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	str, ok := v.(string)
	if !present || !ok {
		invalidType(c, path, "string", v, present)
		return nil, false
	}
	n := jsonv.Len16(str)
	if s.min != nil && n < *s.min {
		c.addCheck(path, "too_small", fmt.Sprintf("Too small: expected string to have >=%d characters", *s.min),
			"origin", "string", "code", "too_small", "minimum", float64(*s.min), "inclusive", true)
	}
	if s.max != nil && n > *s.max {
		c.addCheck(path, "too_big", fmt.Sprintf("Too big: expected string to have <=%d characters", *s.max),
			"origin", "string", "code", "too_big", "maximum", float64(*s.max), "inclusive", true)
	}
	for _, ch := range s.checks {
		if ch.regex != nil {
			if !ch.regex.MatchString(str) {
				msg := ch.msg
				if msg == "" {
					msg = "Invalid string: must match pattern " + ch.pattern
				}
				c.addCheck(path, "invalid_format", msg, "origin", "string", "code", "invalid_format", "format", "regex", "pattern", ch.pattern)
			}
			continue
		}
		if m := ch.refine(str); m != "" {
			c.addCheck(path, "custom", m, "code", "custom")
		}
	}
	return str, true
}

// ---- number ----

type NumberSchema struct {
	isInt        bool
	min, max     *float64
	minExclusive bool
}

func Number() *NumberSchema { return &NumberSchema{} }

// Int is z.number().int().
func Int() *NumberSchema { return &NumberSchema{isInt: true} }

func (s *NumberSchema) Min(n float64) *NumberSchema { s.min = &n; return s }
func (s *NumberSchema) Max(n float64) *NumberSchema { s.max = &n; return s }

// Positive is .positive() (> 0).
func (s *NumberSchema) Positive() *NumberSchema {
	z := 0.0
	s.min = &z
	s.minExclusive = true
	return s
}

const maxSafe = 9007199254740991

func (s *NumberSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	f, ok := v.(float64)
	if !present || !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		invalidType(c, path, "number", v, present)
		return nil, false
	}
	if s.isInt {
		if f != math.Trunc(f) {
			c.add(path, "invalid_type", "Invalid input: expected int, received number", "expected", "int", "format", "safeint", "code", "invalid_type")
			return f, true
		}
		if f > maxSafe {
			c.add(path, "too_big", "Too big: expected int to be <=9007199254740991", "origin", "number", "code", "too_big", "maximum", float64(maxSafe), "inclusive", true)
			return f, true
		}
		if f < -maxSafe {
			c.add(path, "too_small", "Too small: expected int to be >=-9007199254740991", "origin", "number", "code", "too_small", "minimum", float64(-maxSafe), "inclusive", true)
			return f, true
		}
	}
	if s.min != nil && (f < *s.min || (s.minExclusive && f == *s.min)) {
		op := ">="
		if s.minExclusive {
			op = ">"
		}
		c.addCheck(path, "too_small", fmt.Sprintf("Too small: expected number to be %s%s", op, jsonv.FormatNumber(*s.min)),
			"origin", "number", "code", "too_small", "minimum", *s.min, "inclusive", !s.minExclusive)
	}
	if s.max != nil && f > *s.max {
		c.addCheck(path, "too_big", fmt.Sprintf("Too big: expected number to be <=%s", jsonv.FormatNumber(*s.max)),
			"origin", "number", "code", "too_big", "maximum", *s.max, "inclusive", true)
	}
	return f, true
}

// ---- boolean, literal, enum, unknown ----

type boolSchema struct{}

func Bool() Schema { return boolSchema{} }

func (boolSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	b, ok := v.(bool)
	if !present || !ok {
		invalidType(c, path, "boolean", v, present)
		return nil, false
	}
	return b, true
}

type LiteralSchema struct{ Value string }

func Literal(v string) *LiteralSchema { return &LiteralSchema{v} }

func (s *LiteralSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if str, ok := v.(string); present && ok && str == s.Value {
		return str, true
	}
	c.add(path, "invalid_value", fmt.Sprintf("Invalid input: expected %s", jsonv.Quote(s.Value)), "code", "invalid_value", "values", []any{s.Value})
	return nil, false
}

type EnumSchema struct{ Values []string }

func Enum(values ...string) *EnumSchema { return &EnumSchema{values} }

func (s *EnumSchema) Has(v string) bool {
	for _, x := range s.Values {
		if x == v {
			return true
		}
	}
	return false
}

func (s *EnumSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if str, ok := v.(string); present && ok && s.Has(str) {
		return str, true
	}
	vals := make([]any, len(s.Values))
	quoted := make([]string, len(s.Values))
	for i, x := range s.Values {
		vals[i] = x
		quoted[i] = jsonv.Quote(x)
	}
	msg := "Invalid option: expected one of " + strings.Join(quoted, "|")
	if len(s.Values) == 1 {
		msg = "Invalid input: expected " + quoted[0]
	}
	c.add(path, "invalid_value", msg, "code", "invalid_value", "values", vals)
	return nil, false
}

type unknownSchema struct{}

// Unknown accepts anything, including undefined.
func Unknown() Schema { return unknownSchema{} }

func (unknownSchema) parse(v any, present bool, _ []any, _ *ctx) (any, bool) { return v, present }

// ---- wrappers ----

type optional struct{ inner Schema }

func Optional(s Schema) Schema { return optional{s} }

func (o optional) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if !present {
		return nil, false
	}
	return o.inner.parse(v, present, path, c)
}

type nullable struct{ inner Schema }

func Nullable(s Schema) Schema { return nullable{s} }

func (n nullable) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if present && v == nil {
		return nil, true
	}
	return n.inner.parse(v, present, path, c)
}

type withDefault struct {
	inner Schema
	value func() any
}

// Default fills undefined with a fresh copy of value (not validated, like zod).
func Default(s Schema, value any) Schema {
	return withDefault{s, func() any { return jsonv.Clone(value) }}
}

func (d withDefault) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if !present {
		return d.value(), true
	}
	return d.inner.parse(v, present, path, c)
}

type lazy struct{ fn func() Schema }

func Lazy(fn func() Schema) Schema { return &lazy{fn: fn} }

func (l *lazy) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	return l.fn().parse(v, present, path, c)
}

// ---- array, tuple ----

type ArraySchema struct {
	item     Schema
	min, max *int
}

func Array(item Schema) *ArraySchema { return &ArraySchema{item: item} }

func (s *ArraySchema) Min(n int) *ArraySchema { s.min = &n; return s }
func (s *ArraySchema) Max(n int) *ArraySchema { s.max = &n; return s }

func (s *ArraySchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	arr, ok := v.([]any)
	if !present || !ok {
		invalidType(c, path, "array", v, present)
		return nil, false
	}
	// zod checks the maximum before parsing items (and stops there).
	if s.max != nil && len(arr) > *s.max {
		c.addCheck(path, "too_big", fmt.Sprintf("Too big: expected array to have <=%d items", *s.max),
			"origin", "array", "code", "too_big", "maximum", float64(*s.max), "inclusive", true)
		return arr, true
	}
	out := make([]any, len(arr))
	for i, x := range arr {
		o, _ := s.item.parse(x, true, push(path, i), c)
		out[i] = o
	}
	if s.min != nil && len(arr) < *s.min {
		c.addCheck(path, "too_small", fmt.Sprintf("Too small: expected array to have >=%d items", *s.min),
			"origin", "array", "code", "too_small", "minimum", float64(*s.min), "inclusive", true)
	}
	return out, true
}

type tuple struct{ items []Schema }

func Tuple(items ...Schema) Schema { return tuple{items} }

func (t tuple) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	arr, ok := v.([]any)
	if !present || !ok {
		invalidType(c, path, "array", v, present)
		return nil, false
	}
	n := len(t.items)
	if len(arr) < n {
		c.add(path, "too_small", fmt.Sprintf("Too small: expected array to have >=%d items", n),
			"code", "too_small", "minimum", float64(n), "inclusive", true, "origin", "array")
		return arr, true
	}
	if len(arr) > n {
		c.add(path, "too_big", fmt.Sprintf("Too big: expected array to have <=%d items", n),
			"code", "too_big", "maximum", float64(n), "inclusive", true, "origin", "array")
	}
	out := make([]any, n)
	for i := 0; i < n; i++ {
		o, _ := t.items[i].parse(arr[i], true, push(path, i), c)
		out[i] = o
	}
	return out, true
}

// ---- union ----

type union struct{ options []Schema }

func Union(options ...Schema) Schema { return union{options} }

func (u union) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	var errs []any
	var nonAborted []*ctx
	var nonAbortedOut []any
	for _, opt := range u.options {
		sub := &ctx{}
		out, ok := opt.parse(v, present, path, sub)
		if len(sub.issues) == 0 {
			return out, ok
		}
		aborted := false
		list := make([]any, len(sub.issues))
		for i, is := range sub.issues {
			if !is.cont {
				aborted = true
			}
			rel := is
			rel.Path = is.Path[len(path):]
			list[i] = rel.JSON()
		}
		if !aborted {
			nonAborted = append(nonAborted, sub)
			nonAbortedOut = append(nonAbortedOut, out)
		}
		errs = append(errs, list)
	}
	if len(nonAborted) == 1 {
		c.issues = append(c.issues, nonAborted[0].issues...)
		return nonAbortedOut[0], true
	}
	c.add(path, "invalid_union", "Invalid input", "code", "invalid_union", "errors", errs)
	return nil, false
}

// ---- object ----

// Field is one entry of an object shape (order matters: it is the output order).
type Field struct {
	Name   string
	Schema Schema
}

type ObjectSchema struct {
	Fields   []Field
	catchall Schema
}

func Object(fields ...Field) *ObjectSchema { return &ObjectSchema{Fields: fields} }

// Catchall keeps unknown keys, validated by s (z.object().catchall()).
func (o *ObjectSchema) Catchall(s Schema) *ObjectSchema {
	return &ObjectSchema{Fields: o.Fields, catchall: s}
}

// Extend returns a new shape with extra fields appended (or replaced in place).
func (o *ObjectSchema) Extend(fields ...Field) *ObjectSchema {
	out := append([]Field(nil), o.Fields...)
	for _, f := range fields {
		replaced := false
		for i := range out {
			if out[i].Name == f.Name {
				out[i] = f
				replaced = true
			}
		}
		if !replaced {
			out = append(out, f)
		}
	}
	return &ObjectSchema{Fields: out, catchall: o.catchall}
}

// Keys lists the shape's keys.
func (o *ObjectSchema) Keys() []string {
	k := make([]string, len(o.Fields))
	for i, f := range o.Fields {
		k[i] = f.Name
	}
	return k
}

func (o *ObjectSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	in, ok := v.(*jsonv.Object)
	if !present || !ok {
		invalidType(c, path, "object", v, present)
		return nil, false
	}
	out := jsonv.NewObject()
	known := map[string]bool{}
	for _, f := range o.Fields {
		known[f.Name] = true
		val, has := in.Get(f.Name)
		r, rok := f.Schema.parse(val, has, push(path, f.Name), c)
		if rok {
			out.Set(f.Name, r)
		}
	}
	if o.catchall != nil {
		for _, k := range in.Keys() {
			if known[k] {
				continue
			}
			val, _ := in.Get(k)
			r, rok := o.catchall.parse(val, true, push(path, k), c)
			if rok {
				out.Set(k, r)
			}
		}
	}
	return out, true
}

// ---- record ----

type record struct{ key, value Schema }

func Record(key, value Schema) Schema { return record{key, value} }

func (r record) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	in, ok := v.(*jsonv.Object)
	if !present || !ok {
		invalidType(c, path, "record", v, present)
		return nil, false
	}
	out := jsonv.NewObject()
	for _, k := range in.Keys() {
		// zod skips "__proto__" in records: assigning it in JavaScript would replace the prototype.
		if k == "__proto__" {
			continue
		}
		sub := &ctx{}
		r.key.parse(k, true, nil, sub)
		if len(sub.issues) > 0 {
			list := make([]any, len(sub.issues))
			for i, is := range sub.issues {
				list[i] = is.JSON()
			}
			c.add(push(path, k), "invalid_key", "Invalid key in record", "code", "invalid_key", "origin", "record", "issues", list)
			continue
		}
		val, _ := in.Get(k)
		res, rok := r.value.parse(val, true, push(path, k), c)
		if rok {
			out.Set(k, res)
		}
	}
	return out, true
}

// ---- discriminated union ----

type DiscUnion struct {
	key     string
	order   []string
	options map[string]Schema
}

// DiscriminatedUnion is z.discriminatedUnion(key, options); each option is keyed by its literal.
func DiscriminatedUnion(key string, options ...struct {
	Value  string
	Schema Schema
}) *DiscUnion {
	d := &DiscUnion{key: key, options: map[string]Schema{}}
	for _, o := range options {
		d.order = append(d.order, o.Value)
		d.options[o.Value] = o.Schema
	}
	return d
}

// Option builds an entry for DiscriminatedUnion.
func Option(value string, s Schema) struct {
	Value  string
	Schema Schema
} {
	return struct {
		Value  string
		Schema Schema
	}{value, s}
}

func (d *DiscUnion) Options() []string { return d.order }

func (d *DiscUnion) Get(v string) Schema { return d.options[v] }

func (d *DiscUnion) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	in, ok := v.(*jsonv.Object)
	if !present || !ok {
		c.add(path, "invalid_type", fmt.Sprintf("Invalid input: expected object, received %s", jsonv.TypeName(v, present)),
			"code", "invalid_type", "expected", "object")
		return nil, false
	}
	disc, _ := in.Get(d.key)
	if s, ok := disc.(string); ok {
		if opt, found := d.options[s]; found {
			return opt.parse(v, present, path, c)
		}
	}
	quoted := make([]string, len(d.order))
	opts := make([]any, len(d.order))
	for i, o := range d.order {
		quoted[i] = "'" + o + "'"
		opts[i] = o
	}
	c.add(push(path, d.key), "invalid_union", "Invalid discriminator value. Expected "+strings.Join(quoted, " | "),
		"code", "invalid_union", "errors", []any{}, "note", "No matching discriminator", "discriminator", d.key, "options", opts)
	return nil, false
}

type nullSchema struct{}

// Null is z.null().
func Null() Schema { return nullSchema{} }

func (nullSchema) parse(v any, present bool, path []any, c *ctx) (any, bool) {
	if present && v == nil {
		return nil, true
	}
	invalidType(c, path, "null", v, present)
	return nil, false
}
