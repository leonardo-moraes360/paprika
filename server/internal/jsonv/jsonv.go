package jsonv

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

type Object struct {
	keys []string
	m    map[string]any
}

func NewObject(kv ...any) *Object {
	o := &Object{m: map[string]any{}}
	for i := 0; i+1 < len(kv); i += 2 {
		o.Set(kv[i].(string), kv[i+1])
	}
	return o
}

func arrayIndex(k string) (uint64, bool) {
	if k == "" || len(k) > 10 || (len(k) > 1 && k[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(k, 10, 64)
	if err != nil || n >= math.MaxUint32 {
		return 0, false
	}
	return n, true
}

func (o *Object) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}

func (o *Object) Keys() []string {
	if o == nil {
		return nil
	}
	return o.keys
}

func (o *Object) Get(k string) (any, bool) {
	if o == nil {
		return nil, false
	}
	v, ok := o.m[k]
	return v, ok
}

func (o *Object) Has(k string) bool {
	_, ok := o.Get(k)
	return ok
}

func (o *Object) Set(k string, v any) {
	if o.m == nil {
		o.m = map[string]any{}
	}
	if _, ok := o.m[k]; ok {
		o.m[k] = v
		return
	}
	o.m[k] = v
	if n, ok := arrayIndex(k); ok {
		at := sort.Search(len(o.keys), func(i int) bool {
			m, isIdx := arrayIndex(o.keys[i])
			return !isIdx || m > n
		})
		o.keys = append(o.keys, "")
		copy(o.keys[at+1:], o.keys[at:])
		o.keys[at] = k
		return
	}
	o.keys = append(o.keys, k)
}

func (o *Object) Delete(k string) {
	if o == nil {
		return
	}
	if _, ok := o.m[k]; !ok {
		return
	}
	delete(o.m, k)
	for i, kk := range o.keys {
		if kk == k {
			o.keys = append(o.keys[:i:i], o.keys[i+1:]...)
			break
		}
	}
}

func (o *Object) DeleteAll(ks []string) {
	if o == nil || len(ks) == 0 {
		return
	}
	drop := make(map[string]struct{}, len(ks))
	for _, k := range ks {
		if _, ok := o.m[k]; ok {
			drop[k] = struct{}{}
			delete(o.m, k)
		}
	}
	if len(drop) == 0 {
		return
	}
	keys := make([]string, 0, len(o.keys)-len(drop))
	for _, k := range o.keys {
		if _, gone := drop[k]; !gone {
			keys = append(keys, k)
		}
	}
	o.keys = keys
}

func Clone(v any) any {
	switch t := v.(type) {
	case *Object:
		if t == nil {
			return (*Object)(nil)
		}
		c := &Object{keys: append([]string(nil), t.keys...), m: make(map[string]any, len(t.m))}
		for k, vv := range t.m {
			c.m[k] = Clone(vv)
		}
		return c
	case []any:
		c := make([]any, len(t))
		for i, vv := range t {
			c[i] = Clone(vv)
		}
		return c
	default:
		return v
	}
}

func (o *Object) Spread() *Object {
	c := &Object{keys: append([]string(nil), o.Keys()...)}
	if o == nil || o.m == nil {
		c.m = map[string]any{}
		return c
	}
	c.m = maps.Clone(o.m)
	return c
}

func (o *Object) Str(k string) string {
	v, _ := o.Get(k)
	s, _ := v.(string)
	return s
}

func (o *Object) Num(k string) float64 {
	v, _ := o.Get(k)
	f, _ := v.(float64)
	return f
}

func (o *Object) Bool(k string) bool {
	v, _ := o.Get(k)
	b, _ := v.(bool)
	return b
}

func (o *Object) Obj(k string) *Object {
	v, _ := o.Get(k)
	ob, _ := v.(*Object)
	return ob
}

func (o *Object) Arr(k string) []any {
	v, _ := o.Get(k)
	a, _ := v.([]any)
	return a
}

func (o *Object) Strings(k string) []string {
	arr := o.Arr(k)
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func (o *Object) MarshalJSON() ([]byte, error) {
	return []byte(Stringify(o, "")), nil
}

var ErrSyntax = errors.New("JSON inválido")

func Parse(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := parseValue(dec)
	if err != nil {
		return nil, err
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, fmt.Errorf("%w: conteúdo após o valor", ErrSyntax)
	}
	return v, nil
}

func parseValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
	}
	return fromToken(dec, tok)
}

func fromToken(dec *json.Decoder, tok json.Token) (any, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			o := NewObject()
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
				}
				k, ok := kt.(string)
				if !ok {
					return nil, ErrSyntax
				}
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				o.Set(k, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
			}
			return o, nil
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			if _, err := dec.Token(); err != nil {
				return nil, fmt.Errorf("%w: %v", ErrSyntax, err)
			}
			return arr, nil
		}
		return nil, ErrSyntax
	case json.Number:
		f, err := strconv.ParseFloat(string(t), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, fmt.Errorf("%w: número %q", ErrSyntax, string(t))
		}
		return f, nil
	case string, bool, nil:
		return t, nil
	}
	return nil, ErrSyntax
}

func FromGo(v any) any {
	switch t := v.(type) {
	case nil, bool, string, float64, *Object:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = FromGo(x)
		}
		return out
	case []string:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = x
		}
		return out
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	r, err := Parse(b)
	if err != nil {
		panic(err)
	}
	return r
}

func Stringify(v any, indent string) string {
	var b strings.Builder
	writeValue(&b, v, indent, "")
	return b.String()
}

func writeValue(b *strings.Builder, v any, indent, cur string) {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			b.WriteString("null")
		} else {
			b.WriteString(FormatNumber(t))
		}
	case int:
		b.WriteString(strconv.Itoa(t))
	case string:
		b.WriteString(Quote(t))
	case []string:
		arr := make([]any, len(t))
		for i, s := range t {
			arr[i] = s
		}
		writeValue(b, arr, indent, cur)
	case []any:
		if len(t) == 0 {
			b.WriteString("[]")
			return
		}
		next := cur + indent
		b.WriteByte('[')
		for i, x := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			if indent != "" {
				b.WriteByte('\n')
				b.WriteString(next)
			}
			writeValue(b, x, indent, next)
		}
		if indent != "" {
			b.WriteByte('\n')
			b.WriteString(cur)
		}
		b.WriteByte(']')
	case *Object:
		if t.Len() == 0 {
			b.WriteString("{}")
			return
		}
		next := cur + indent
		b.WriteByte('{')
		for i, k := range t.keys {
			if i > 0 {
				b.WriteByte(',')
			}
			if indent != "" {
				b.WriteByte('\n')
				b.WriteString(next)
			}
			b.WriteString(Quote(k))
			b.WriteByte(':')
			if indent != "" {
				b.WriteByte(' ')
			}
			writeValue(b, t.m[k], indent, next)
		}
		if indent != "" {
			b.WriteByte('\n')
			b.WriteString(cur)
		}
		b.WriteByte('}')
	default:
		writeValue(b, FromGo(v), indent, cur)
	}
}

func Quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

func FormatNumber(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		mant, exp, _ := strings.Cut(s, "e")
		sign := exp[0]
		digits := strings.TrimLeft(exp[1:], "0")
		if digits == "" {
			digits = "0"
		}
		return mant + "e" + string(sign) + digits
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func Len16(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func Slice16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if n >= len(u) {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

func IsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func Trim(s string) string { return strings.TrimFunc(s, IsSpace) }

func Round(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	f := math.Floor(x)
	if x-f >= 0.5 {
		f++
	}
	if f == 0 && math.Signbit(x) {
		return math.Copysign(0, -1)
	}
	return f
}

func ParseFloat(s string) float64 {
	s = strings.TrimLeftFunc(s, IsSpace)
	i := 0
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		i++
	}
	if strings.HasPrefix(s[i:], "Infinity") {
		if s[0] == '-' {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	start := i
	digits := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
		digits++
	}
	if i < len(s) && s[i] == '.' {
		i++
		for i < len(s) && s[i] >= '0' && s[i] <= '9' {
			i++
			digits++
		}
	}
	if digits == 0 {
		return math.NaN()
	}
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		j := i + 1
		if j < len(s) && (s[j] == '+' || s[j] == '-') {
			j++
		}
		k := j
		for k < len(s) && s[k] >= '0' && s[k] <= '9' {
			k++
		}
		if k > j {
			i = k
		}
	}
	_ = start
	f, _ := strconv.ParseFloat(strings.TrimSuffix(s[:i], "."), 64)
	return f
}

func ToNumber(s string) float64 {
	t := Trim(s)
	if t == "" {
		return 0
	}
	switch t {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if strings.ContainsAny(t, "xXoObB_iInN") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return math.NaN()
	}
	return f
}

func TypeName(v any, present bool) string {
	if !present {
		return "undefined"
	}
	switch t := v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64:
		if math.IsNaN(t) {
			return "NaN"
		}
		if math.IsInf(t, 0) {
			return "Infinity"
		}
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	}
	return "object"
}

func Equal(a, b any) bool {
	switch x := a.(type) {
	case *Object:
		y, ok := b.(*Object)
		if !ok {
			return false
		}
		if x == y {
			return true
		}
		if x.Len() != y.Len() {
			return false
		}
		for i, k := range x.keys {
			if y.keys[i] != k || !Equal(x.m[k], y.m[k]) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !Equal(x[i], y[i]) {
				return false
			}
		}
		return true
	case string:
		y, ok := b.(string)
		return ok && x == y
	case float64:
		y, ok := b.(float64)
		return ok && (x == y || (x != x && y != y))
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case nil:
		return b == nil
	default:
		return Stringify(a, "") == Stringify(b, "")
	}
}
