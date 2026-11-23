package server

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

const (
	tokenNameRule      = "token name must be [A-Za-z0-9_.-]{1,100}"
	modeNameRule       = "mode name must be [A-Za-z0-9_-]{1,40}"
	protoNameRule      = "token name cannot be __proto__"
	notColorOrLength   = "not a color or a length"
	unitNotPx          = "unit is not px"
	unsupportedValue   = "unsupported value"
	pathRefused        = "pass the file contents, not a path; this tool does not read the filesystem"
	unrecognizedSource = "unrecognized token source; pass CSS variables, a Tailwind theme, or JSON tokens"
)

var (
	reTokenName = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
	reModeName  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	reDataMode  = regexp.MustCompile(`(?i)(?:data-paprika-mode|data-theme|data-mode)\s*=\s*["']?([A-Za-z0-9_-]+)`)
	reScheme    = regexp.MustCompile(`(?i)prefers-color-scheme\s*:\s*([A-Za-z0-9_-]+)`)
	reDotMode   = regexp.MustCompile(`(?i)\.(?:theme-|mode-)?(dark|light|compact)\b`)
	rePathExt   = regexp.MustCompile(`(?i)\.(css|scss|less|json|js|mjs|cjs|ts|tsx)$`)
)

var themeGroups = []struct{ key, prefix string }{
	{"colors", "color"},
	{"spacing", "spacing"},
	{"borderRadius", "radius"},
	{"fontSize", "fontSize"},
	{"lineHeight", "lineHeight"},
	{"letterSpacing", "letterSpacing"},
	{"borderWidth", "borderWidth"},
	{"opacity", "opacity"},
}

var tokenMetaKeys = map[string]bool{
	"description": true, "comment": true, "type": true, "name": true,
	"attributes": true, "original": true, "path": true, "filePath": true,
	"isSource": true, "deprecated": true, "private": true, "extensions": true,
}

type jsIdent string

type tokenSkip struct{ name, reason string }

type tokenDraft struct {
	modes   []string
	byMode  map[string]*jsonv.Object
	skipped []tokenSkip
}

func (d *tokenDraft) add(mode, name string, value any) {
	if d.byMode == nil {
		d.byMode = map[string]*jsonv.Object{}
	}
	if _, ok := d.byMode[mode]; !ok {
		d.byMode[mode] = jsonv.NewObject()
		d.modes = append(d.modes, mode)
	}
	d.byMode[mode].Set(name, value)
}

func (d *tokenDraft) skip(name, reason string) {
	if name == "" {
		name = "(value)"
	}
	d.skipped = append(d.skipped, tokenSkip{name, reason})
}

func (d *tokenDraft) result(format string) (*jsonv.Object, error) {
	var proposals []any
	var rest []string
	var base []string
	for _, m := range d.modes {
		if m == "" {
			base = append(base, m)
		} else {
			rest = append(rest, m)
		}
	}
	for _, m := range append(base, rest...) {
		tokens := d.byMode[m]
		if tokens == nil || tokens.Len() == 0 {
			continue
		}
		op := jsonv.NewObject("op", "set_tokens", "tokens", tokens)
		if m != "" {
			op.Set("mode", m)
		}
		proposals = append(proposals, op)
	}
	if len(proposals) == 0 {
		msg := "no design tokens found"
		if len(d.skipped) > 0 {
			msg += ": " + d.skipped[0].name + " (" + d.skipped[0].reason + ")"
		}
		return nil, fmt.Errorf("%s", msg)
	}
	skipped := []any{}
	for _, s := range d.skipped {
		skipped = append(skipped, jsonv.NewObject("name", s.name, "reason", s.reason))
	}
	return jsonv.NewObject("format", format, "proposals", proposals, "skipped", skipped), nil
}

func proposeFromContent(content, format string) (*jsonv.Object, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("content is empty")
	}
	if err := refuseTokenPath(content); err != nil {
		return nil, err
	}
	switch format {
	case "", "auto":
		return proposeAuto(content)
	case "css":
		return finishPropose("css", content, parseCSSVars)
	case "tailwind":
		return proposeTailwind(content)
	case "json":
		v, err := jsonv.Parse([]byte(content))
		if err != nil {
			return nil, fmt.Errorf("content is not JSON")
		}
		if _, ok := v.(*jsonv.Object); !ok {
			return nil, fmt.Errorf("content is not a JSON object")
		}
		return finishPropose("json", content, func(_ string, d *tokenDraft) { walkDTCG(v, "", "", d) })
	default:
		return nil, fmt.Errorf("format must be auto, css, tailwind or json")
	}
}

func proposeAuto(content string) (*jsonv.Object, error) {
	if v, err := jsonv.Parse([]byte(content)); err == nil {
		if o, ok := v.(*jsonv.Object); ok {
			if isTailwindJSON(o) {
				return finishPropose("tailwind", content, func(_ string, d *tokenDraft) { walkTailwindJSON(o, d) })
			}
			return finishPropose("json", content, func(_ string, d *tokenDraft) { walkDTCG(o, "", "", d) })
		}
	}
	if preferCSS(content) {
		return finishPropose("css", content, parseCSSVars)
	}
	if looksLikeJSTheme(content) {
		return finishPropose("tailwind", content, parseTailwind)
	}
	if looksLikeCSSVars(content) {
		return finishPropose("css", content, parseCSSVars)
	}
	return nil, fmt.Errorf("%s", unrecognizedSource)
}

func proposeTailwind(content string) (*jsonv.Object, error) {
	if v, err := jsonv.Parse([]byte(content)); err == nil {
		if o, ok := v.(*jsonv.Object); ok {
			return finishPropose("tailwind", content, func(_ string, d *tokenDraft) { walkTailwindJSON(o, d) })
		}
	}
	if preferCSS(content) {
		return finishPropose("css", content, parseCSSVars)
	}
	return finishPropose("tailwind", content, parseTailwind)
}

func finishPropose(format, content string, parse func(string, *tokenDraft)) (*jsonv.Object, error) {
	d := &tokenDraft{}
	parse(content, d)
	return d.result(format)
}

func refuseTokenPath(content string) error {
	if strings.ContainsAny(content, "\n{}") || strings.Contains(content, "--") || strings.Contains(content, ": ") || strings.Contains(content, "\"") || strings.Contains(content, "'") {
		return nil
	}
	if strings.HasPrefix(content, "file:") || strings.HasPrefix(content, "/") || strings.HasPrefix(content, "./") || strings.HasPrefix(content, "../") || strings.HasPrefix(content, "~/") || strings.HasPrefix(content, "\\") || strings.Contains(content, `\`) {
		return fmt.Errorf("%s", pathRefused)
	}
	if !strings.Contains(content, " ") && rePathExt.MatchString(content) {
		return fmt.Errorf("%s", pathRefused)
	}
	return nil
}

func looksLikeCSSVars(content string) bool {
	return strings.Contains(content, "--") && strings.Contains(content, ":")
}

func looksLikeJSTheme(content string) bool {
	return strings.Contains(content, "module.exports") || strings.Contains(content, "theme:") || strings.Contains(content, "theme :") || strings.Contains(content, "colors:") || strings.Contains(content, "borderRadius:")
}

func preferCSS(content string) bool {
	if !looksLikeCSSVars(content) {
		return false
	}
	if strings.Contains(content, "module.exports") || strings.Contains(content, "theme:") || strings.Contains(content, "colors:") || strings.Contains(content, "borderRadius:") {
		return false
	}
	return true
}

func validTokenName(name string) bool {
	return name != "__proto__" && reTokenName.MatchString(name)
}

func validModeName(name string) bool {
	return name != "__proto__" && reModeName.MatchString(name)
}

func joinToken(prefix, seg string) string {
	if prefix == "" {
		return seg
	}
	if seg == "" {
		return prefix
	}
	return prefix + "." + seg
}

func addClassified(name, raw string, d *tokenDraft, mode string) {
	if name == "__proto__" {
		d.skip(name, protoNameRule)
		return
	}
	if !validTokenName(name) {
		d.skip(name, tokenNameRule)
		return
	}
	if mode != "" && !validModeName(mode) {
		d.skip(name, modeNameRule)
		return
	}
	v, reason := classifyTokenValue(raw)
	if reason != "" {
		d.skip(name, reason)
		return
	}
	d.add(mode, name, v)
}

func addNumber(name string, n float64, d *tokenDraft, mode string) {
	if name == "__proto__" {
		d.skip(name, protoNameRule)
		return
	}
	if !validTokenName(name) {
		d.skip(name, tokenNameRule)
		return
	}
	if mode != "" && !validModeName(mode) {
		d.skip(name, modeNameRule)
		return
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100000 {
		d.skip(name, notColorOrLength)
		return
	}
	d.add(mode, name, n)
}

func classifyTokenValue(raw string) (any, string) {
	v := strings.TrimSpace(raw)
	v = strings.TrimSpace(strings.TrimSuffix(v, "!important"))
	if len(v) >= 2 {
		q := v[0]
		if (q == '"' || q == '\'') && v[len(v)-1] == q {
			v = strings.TrimSpace(v[1 : len(v)-1])
		}
	}
	if v == "" {
		return nil, "empty value"
	}
	if ref, ok := cssVarRef(v); ok {
		if ref == "__proto__" || !validTokenName(ref) {
			return nil, tokenNameRule
		}
		return "$" + ref, ""
	}
	if strings.HasPrefix(v, "{") && strings.HasSuffix(v, "}") {
		ref := strings.TrimSpace(v[1 : len(v)-1])
		if validTokenName(ref) {
			return "$" + ref, ""
		}
	}
	if _, ok := core.ParseColor(v); ok {
		if len(v) > 500 {
			return nil, "value is longer than 500 characters"
		}
		return v, ""
	}
	if n, ok := pxLength(v); ok {
		return n, ""
	}
	if nonPxUnit(v) {
		return nil, unitNotPx
	}
	return nil, notColorOrLength
}

func cssVarRef(v string) (string, bool) {
	if !strings.HasPrefix(v, "var(") || !strings.HasSuffix(v, ")") {
		return "", false
	}
	inner := strings.TrimSpace(v[len("var(") : len(v)-1])
	if !strings.HasPrefix(inner, "--") {
		return "", false
	}
	name := strings.TrimSpace(inner[2:])
	if i := strings.IndexAny(name, ",)"); i >= 0 {
		name = strings.TrimSpace(name[:i])
	}
	if name == "" || strings.ContainsAny(name, " \t") {
		return "", false
	}
	return name, true
}

func nonPxUnit(v string) bool {
	lower := strings.ToLower(strings.TrimSpace(v))
	for _, unit := range []string{"rem", "em", "vh", "vw", "vmin", "vmax", "ch", "ex", "pt", "pc", "in", "cm", "mm", "%"} {
		if strings.HasSuffix(lower, unit) {
			return true
		}
	}
	return false
}

func pxLength(v string) (float64, bool) {
	s := strings.TrimSpace(v)
	if strings.HasSuffix(strings.ToLower(s), "px") {
		s = strings.TrimSpace(s[:len(s)-2])
	} else if strings.IndexFunc(s, unicode.IsLetter) >= 0 {
		return 0, false
	}
	if s == "" || strings.ContainsAny(s, " \t") {
		return 0, false
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100000 {
		return 0, false
	}
	return n, true
}

func parseCSSVars(src string, d *tokenDraft) {
	s := stripBlockComments(src)
	type frame struct{ mode string }
	stack := []frame{{mode: ""}}
	var pending strings.Builder
	depth := 0
	paren := 0
	var quote byte
	flush := func(mode string) {
		if pending.Len() == 0 {
			return
		}
		flushCSSDecl(pending.String(), mode, d)
		pending.Reset()
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			pending.WriteByte(c)
			if c == '\\' && i+1 < len(s) {
				i++
				pending.WriteByte(s[i])
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			quote = c
			pending.WriteByte(c)
			continue
		}
		switch c {
		case '(':
			paren++
			pending.WriteByte(c)
		case ')':
			if paren > 0 {
				paren--
			}
			pending.WriteByte(c)
		case '{':
			if paren == 0 {
				sel := pending.String()
				pending.Reset()
				parent := stack[len(stack)-1].mode
				stack = append(stack, frame{mode: modeFromSelector(sel, parent)})
				depth++
			} else {
				pending.WriteByte(c)
			}
		case '}':
			if paren == 0 && depth > 0 {
				flush(stack[len(stack)-1].mode)
				stack = stack[:len(stack)-1]
				depth--
			} else {
				pending.WriteByte(c)
			}
		case ';':
			if paren == 0 {
				flush(stack[len(stack)-1].mode)
			} else {
				pending.WriteByte(c)
			}
		default:
			pending.WriteByte(c)
		}
	}
	if pending.Len() > 0 {
		flush(stack[len(stack)-1].mode)
	}
}

func flushCSSDecl(raw, mode string, d *tokenDraft) {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "--") {
		return
	}
	colon := strings.IndexByte(raw, ':')
	if colon < 0 {
		return
	}
	name := strings.TrimSpace(raw[2:colon])
	value := strings.TrimSpace(raw[colon+1:])
	if mode != "" && !validModeName(mode) {
		d.skip(name, modeNameRule)
		return
	}
	addClassified(name, value, d, mode)
}

func modeFromSelector(sel, parent string) string {
	sel = strings.TrimSpace(sel)
	if m := reDataMode.FindStringSubmatch(sel); m != nil {
		return m[1]
	}
	if m := reScheme.FindStringSubmatch(sel); m != nil {
		return strings.ToLower(m[1])
	}
	if m := reDotMode.FindStringSubmatch(sel); m != nil {
		return strings.ToLower(m[1])
	}
	if parent != "" {
		return parent
	}
	return ""
}

func stripBlockComments(s string) string {
	var b strings.Builder
	var q byte
	for i := 0; i < len(s); i++ {
		if q != 0 {
			b.WriteByte(s[i])
			if s[i] == '\\' && i+1 < len(s) {
				i++
				b.WriteByte(s[i])
				continue
			}
			if s[i] == q {
				q = 0
			}
			continue
		}
		if s[i] == '"' || s[i] == '\'' {
			q = s[i]
			b.WriteByte(s[i])
			continue
		}
		if s[i] == '/' && i+1 < len(s) && s[i+1] == '*' {
			i += 2
			for i+1 < len(s) && !(s[i] == '*' && s[i+1] == '/') {
				i++
			}
			if i+1 < len(s) {
				i++
			}
			b.WriteByte(' ')
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func parseTailwind(src string, d *tokenDraft) {
	s := stripJSComments(src)
	if body, ok := objectAfterKey(s, "theme"); ok {
		s = body
	}
	collectThemeGroups(s, d)
}

func walkTailwindJSON(root *jsonv.Object, d *tokenDraft) {
	theme := root
	if t := root.Obj("theme"); t != nil {
		theme = t
	}
	applyThemeGroups(theme, d)
	if ext := theme.Obj("extend"); ext != nil {
		applyThemeGroups(ext, d)
	}
}

func applyThemeGroups(o *jsonv.Object, d *tokenDraft) {
	if o == nil {
		return
	}
	for _, g := range themeGroups {
		v, ok := o.Get(g.key)
		if !ok {
			continue
		}
		flattenThemeValue(g.prefix, v, d, "")
	}
}

func isTailwindJSON(o *jsonv.Object) bool {
	theme := o
	if t := o.Obj("theme"); t != nil {
		theme = t
	} else if !hasThemeGroup(o) {
		return false
	}
	if hasDTCGValue(theme) {
		return false
	}
	if ext := theme.Obj("extend"); ext != nil && hasThemeGroup(ext) && !hasDTCGValue(ext) {
		return true
	}
	return hasThemeGroup(theme)
}

func hasThemeGroup(o *jsonv.Object) bool {
	if o == nil {
		return false
	}
	for _, g := range themeGroups {
		if o.Has(g.key) {
			return true
		}
	}
	return false
}

func hasDTCGValue(o *jsonv.Object) bool {
	if o == nil {
		return false
	}
	if _, ok := o.Get("$value"); ok {
		return true
	}
	if _, ok := o.Get("value"); ok {
		if o.Has("type") || o.Has("$type") {
			return true
		}
	}
	for _, k := range o.Keys() {
		if hasDTCGValue(o.Obj(k)) {
			return true
		}
	}
	return false
}

func flattenThemeValue(prefix string, v any, d *tokenDraft, mode string) {
	switch t := v.(type) {
	case string:
		addClassified(prefix, t, d, mode)
	case float64:
		addNumber(prefix, t, d, mode)
	case bool, nil, jsIdent:
		if prefix != "" {
			d.skip(prefix, unsupportedValue)
		}
	case *jsonv.Object:
		if t == nil || t.Len() == 0 {
			if prefix != "" {
				d.skip(prefix, unsupportedValue)
			}
			return
		}
		for _, k := range t.Keys() {
			child, _ := t.Get(k)
			next := prefix
			if k != "DEFAULT" && k != "default" {
				next = joinToken(prefix, k)
			}
			flattenThemeValue(next, child, d, mode)
		}
	case []any:
		if len(t) == 0 {
			if prefix != "" {
				d.skip(prefix, unsupportedValue)
			}
			return
		}
		flattenThemeValue(prefix, t[0], d, mode)
		if len(t) >= 2 {
			if o, ok := t[1].(*jsonv.Object); ok {
				if lh, ok := o.Get("lineHeight"); ok {
					flattenThemeValue(lineHeightName(prefix), lh, d, mode)
				}
			}
		}
	default:
		if prefix != "" {
			d.skip(prefix, unsupportedValue)
		}
	}
}

func lineHeightName(fontSizeName string) string {
	if rest, ok := strings.CutPrefix(fontSizeName, "fontSize."); ok {
		return "lineHeight." + rest
	}
	if fontSizeName == "fontSize" {
		return "lineHeight"
	}
	return "lineHeight." + fontSizeName
}

func walkDTCG(v any, prefix, mode string, d *tokenDraft) {
	switch t := v.(type) {
	case *jsonv.Object:
		if leaf, ok := tokenLeaf(t); ok {
			switch n := leaf.(type) {
			case string:
				addClassified(prefix, n, d, mode)
			case float64:
				addNumber(prefix, n, d, mode)
			}
			if ext := t.Obj("$extensions"); ext != nil {
				modes := ext.Obj("mode")
				if modes == nil {
					modes = ext.Obj("modes")
				}
				if modes != nil {
					for _, mk := range modes.Keys() {
						mv, _ := modes.Get(mk)
						if !validModeName(mk) {
							d.skip(prefix, modeNameRule)
							continue
						}
						flattenLeaf(prefix, mv, d, mk)
					}
				}
			}
			return
		}
		for _, k := range t.Keys() {
			if strings.HasPrefix(k, "$") || tokenMetaKeys[k] {
				continue
			}
			if k == "modes" && prefix == "" && mode == "" && isModeMap(t.Obj("modes")) {
				for _, mk := range t.Obj("modes").Keys() {
					walkDTCG(t.Obj("modes").Obj(mk), "", mk, d)
				}
				continue
			}
			child, _ := t.Get(k)
			walkDTCG(child, joinToken(prefix, k), mode, d)
		}
	case string:
		addClassified(prefix, t, d, mode)
	case float64:
		addNumber(prefix, t, d, mode)
	default:
		if prefix != "" {
			d.skip(prefix, unsupportedValue)
		}
	}
}

func flattenLeaf(name string, v any, d *tokenDraft, mode string) {
	switch t := v.(type) {
	case string:
		addClassified(name, t, d, mode)
	case float64:
		addNumber(name, t, d, mode)
	case *jsonv.Object:
		if leaf, ok := tokenLeaf(t); ok {
			flattenLeaf(name, leaf, d, mode)
		}
	}
}

func tokenLeaf(o *jsonv.Object) (any, bool) {
	if o == nil {
		return nil, false
	}
	var leaf any
	found := false
	for _, k := range []string{"$value", "value"} {
		v, ok := o.Get(k)
		if !ok {
			continue
		}
		switch v.(type) {
		case string, float64:
			leaf = v
			found = true
		}
		if found {
			break
		}
	}
	if !found {
		return nil, false
	}
	for _, k := range o.Keys() {
		if k == "$value" || k == "value" || k == "$extensions" || strings.HasPrefix(k, "$") || tokenMetaKeys[k] {
			continue
		}
		if o.Obj(k) != nil {
			return nil, false
		}
	}
	return leaf, true
}

func isModeMap(o *jsonv.Object) bool {
	if o == nil || o.Len() == 0 {
		return false
	}
	for _, k := range o.Keys() {
		if !validModeName(k) {
			return false
		}
		child := o.Obj(k)
		if child == nil {
			return false
		}
		if _, ok := tokenLeaf(child); ok {
			return false
		}
	}
	return true
}

func collectThemeGroups(s string, d *tokenDraft) {
	for i := 0; i < len(s); {
		if s[i] == '"' || s[i] == '\'' || s[i] == '`' {
			_, n, ok := readJSString(s, i)
			if !ok || n <= i {
				i++
				continue
			}
			k := skipWS(s, n)
			if k < len(s) && s[k] == ':' {
				if key, _, ok2 := readJSString(s, i); ok2 {
					if prefix, known := themeGroupPrefix(key); known {
						if val, n2, ok3 := parseJSValue(s, k+1); ok3 {
							flattenThemeValue(prefix, val, d, "")
							i = n2
							continue
						}
					}
				}
			}
			i = n
			continue
		}
		if isIdentStart(s[i]) {
			key, n, ok := readKeyAt(s, i)
			if !ok || n <= i {
				i++
				continue
			}
			k := skipWS(s, n)
			if k < len(s) && s[k] == ':' {
				if prefix, known := themeGroupPrefix(key); known {
					if val, n2, ok3 := parseJSValue(s, k+1); ok3 {
						flattenThemeValue(prefix, val, d, "")
						i = n2
						continue
					}
				}
			}
			i = n
			continue
		}
		i++
	}
}

func themeGroupPrefix(key string) (string, bool) {
	for _, g := range themeGroups {
		if g.key == key {
			return g.prefix, true
		}
	}
	return "", false
}

func objectAfterKey(s, want string) (string, bool) {
	for i := 0; i < len(s); {
		if s[i] == '"' || s[i] == '\'' || s[i] == '`' {
			_, n, ok := readJSString(s, i)
			if !ok || n <= i {
				i++
				continue
			}
			if key, _, ok2 := readJSString(s, i); ok2 && key == want {
				if body, ok3 := objectAfterColon(s, n); ok3 {
					return body, true
				}
			}
			i = n
			continue
		}
		if isIdentStart(s[i]) {
			key, n, ok := readKeyAt(s, i)
			if !ok || n <= i {
				i++
				continue
			}
			if key == want {
				if body, ok3 := objectAfterColon(s, n); ok3 {
					return body, true
				}
			}
			i = n
			continue
		}
		i++
	}
	return "", false
}

func objectAfterColon(s string, i int) (string, bool) {
	i = skipWS(s, i)
	if i >= len(s) || s[i] != ':' {
		return "", false
	}
	i = skipWS(s, i+1)
	if i >= len(s) || s[i] != '{' {
		return "", false
	}
	end := matchingDelim(s, i, '{', '}')
	if end < 0 {
		return "", false
	}
	return s[i+1 : end], true
}

func matchingDelim(s string, i int, open, close byte) int {
	depth := 0
	var q byte
	for j := i; j < len(s); j++ {
		if q != 0 {
			if s[j] == '\\' && j+1 < len(s) {
				j++
				continue
			}
			if s[j] == q {
				q = 0
			}
			continue
		}
		if s[j] == '"' || s[j] == '\'' || s[j] == '`' {
			q = s[j]
			continue
		}
		if s[j] == open {
			depth++
		} else if s[j] == close {
			depth--
			if depth == 0 {
				return j
			}
		}
	}
	return -1
}

func parseJSValue(s string, i int) (any, int, bool) {
	i = skipWS(s, i)
	if i >= len(s) {
		return nil, i, false
	}
	switch s[i] {
	case '"', '\'', '`':
		str, j, ok := readJSString(s, i)
		if !ok {
			return nil, i, false
		}
		return str, j, true
	case '{':
		return readJSObject(s, i)
	case '[':
		return readJSArray(s, i)
	}
	if s[i] == '-' || s[i] == '.' || (s[i] >= '0' && s[i] <= '9') {
		return readJSNumber(s, i)
	}
	if isIdentStart(s[i]) {
		j := i + 1
		for j < len(s) && isIdentCont(s[j]) {
			j++
		}
		ident := s[i:j]
		k := skipWS(s, j)
		if k < len(s) && s[k] == '(' {
			end := matchingDelim(s, k, '(', ')')
			if end < 0 {
				return nil, i, false
			}
			return s[i : end+1], end + 1, true
		}
		switch ident {
		case "true":
			return true, j, true
		case "false":
			return false, j, true
		case "null", "undefined":
			return nil, j, true
		default:
			return jsIdent(ident), j, true
		}
	}
	return nil, i, false
}

func readJSObject(s string, i int) (any, int, bool) {
	o := jsonv.NewObject()
	j := i + 1
	for {
		j = skipWS(s, j)
		if j >= len(s) {
			return nil, i, false
		}
		if s[j] == '}' {
			return o, j + 1, true
		}
		key, n, ok := readKeyAt(s, j)
		if !ok {
			return nil, i, false
		}
		j = skipWS(s, n)
		if j >= len(s) || s[j] != ':' {
			return nil, i, false
		}
		val, n, ok := parseJSValue(s, j+1)
		if !ok {
			return nil, i, false
		}
		o.Set(key, val)
		j = skipWS(s, n)
		if j < len(s) && s[j] == ',' {
			j++
			continue
		}
		if j < len(s) && s[j] == '}' {
			return o, j + 1, true
		}
		return nil, i, false
	}
}

func readJSArray(s string, i int) (any, int, bool) {
	var arr []any
	j := i + 1
	for {
		j = skipWS(s, j)
		if j >= len(s) {
			return nil, i, false
		}
		if s[j] == ']' {
			return arr, j + 1, true
		}
		val, n, ok := parseJSValue(s, j)
		if !ok {
			return nil, i, false
		}
		arr = append(arr, val)
		j = skipWS(s, n)
		if j < len(s) && s[j] == ',' {
			j++
			continue
		}
		if j < len(s) && s[j] == ']' {
			return arr, j + 1, true
		}
		return nil, i, false
	}
}

func readJSNumber(s string, i int) (any, int, bool) {
	j := i
	if j < len(s) && (s[j] == '-' || s[j] == '+') {
		j++
	}
	start := j
	for j < len(s) && (s[j] == '.' || (s[j] >= '0' && s[j] <= '9') || s[j] == 'e' || s[j] == 'E' || s[j] == '+' || s[j] == '-') {
		j++
	}
	for j > start {
		if n, err := strconv.ParseFloat(s[i:j], 64); err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n, j, true
		}
		j--
	}
	return nil, i, false
}

func readJSString(s string, i int) (string, int, bool) {
	if i >= len(s) {
		return "", i, false
	}
	q := s[i]
	if q != '"' && q != '\'' && q != '`' {
		return "", i, false
	}
	var b strings.Builder
	for j := i + 1; j < len(s); j++ {
		if s[j] == '\\' && j+1 < len(s) {
			b.WriteByte(s[j+1])
			j++
			continue
		}
		if q == '`' && s[j] == '$' && j+1 < len(s) && s[j+1] == '{' {
			return "", i, false
		}
		if s[j] == q {
			return b.String(), j + 1, true
		}
		if q != '`' && (s[j] == '\n' || s[j] == '\r') {
			return "", i, false
		}
		b.WriteByte(s[j])
	}
	return "", i, false
}

func readKeyAt(s string, i int) (string, int, bool) {
	i = skipWS(s, i)
	if i >= len(s) {
		return "", i, false
	}
	if s[i] == '"' || s[i] == '\'' || s[i] == '`' {
		return readJSString(s, i)
	}
	if !isIdentStart(s[i]) {
		return "", i, false
	}
	j := i + 1
	for j < len(s) && isIdentCont(s[j]) {
		j++
	}
	return s[i:j], j, true
}

func skipWS(s string, i int) int {
	for i < len(s) {
		switch s[i] {
		case ' ', '\t', '\n', '\r', '\v', '\f':
			i++
		default:
			return i
		}
	}
	return i
}

func isIdentStart(c byte) bool {
	return c == '_' || c == '$' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

func isIdentCont(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

func stripJSComments(s string) string {
	var b strings.Builder
	var q byte
	for i := 0; i < len(s); i++ {
		if q != 0 {
			b.WriteByte(s[i])
			if s[i] == '\\' && i+1 < len(s) {
				i++
				b.WriteByte(s[i])
				continue
			}
			if s[i] == q {
				q = 0
			}
			continue
		}
		if s[i] == '"' || s[i] == '\'' || s[i] == '`' {
			q = s[i]
			b.WriteByte(s[i])
			continue
		}
		if s[i] == '/' && i+1 < len(s) && s[i+1] == '/' {
			i += 2
			for i < len(s) && s[i] != '\n' {
				i++
			}
			if i < len(s) {
				b.WriteByte('\n')
			}
			continue
		}
		if s[i] == '/' && i+1 < len(s) && s[i+1] == '*' {
			i += 2
			for i+1 < len(s) && !(s[i] == '*' && s[i+1] == '/') {
				i++
			}
			if i+1 < len(s) {
				i++
			}
			b.WriteByte(' ')
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
