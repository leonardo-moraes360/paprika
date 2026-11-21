package core

import (
	"math"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/lint.ts.

// RGBA is a color with 0..255 channels and 0..1 alpha.
type RGBA struct{ R, G, B, A float64 }

var named = map[string]RGBA{
	"white":       {255, 255, 255, 1},
	"black":       {0, 0, 0, 1},
	"transparent": {0, 0, 0, 0},
}

// jsWS is JavaScript's \s as an RE2 class body.
const jsWS = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

var (
	reHex = regexp.MustCompile(`^#([0-9a-f]{3,8})$`)
	reRGB = regexp.MustCompile(`^rgba?\([` + jsWS + `]*([\d.]+)[` + jsWS + `,]+([\d.]+)[` + jsWS + `,]+([\d.]+)(?:[` + jsWS + `,/]+([\d.]+%?))?[` + jsWS + `]*\)$`)
)

// ParseColor converts hex/rgb()/rgba()/basic names; ok=false for unsupported formats.
func ParseColor(input string) (RGBA, bool) {
	s := strings.ToLower(jsonv.Trim(input))
	if c, ok := named[s]; ok {
		return c, true
	}
	if m := reHex.FindStringSubmatch(s); m != nil {
		h := m[1]
		if len(h) == 3 || len(h) == 4 {
			var b strings.Builder
			for _, c := range h {
				b.WriteRune(c)
				b.WriteRune(c)
			}
			h = b.String()
		}
		if len(h) != 6 && len(h) != 8 {
			return RGBA{}, false
		}
		n := func(i int) float64 {
			v, _ := strconv.ParseUint(h[i:i+2], 16, 8)
			return float64(v)
		}
		a := 1.0
		if len(h) == 8 {
			a = n(6) / 255
		}
		return RGBA{n(0), n(2), n(4), a}, true
	}
	if m := reRGB.FindStringSubmatch(s); m != nil {
		a := 1.0
		if m[4] != "" {
			if strings.HasSuffix(m[4], "%") {
				a = jsonv.ParseFloat(m[4]) / 100
			} else {
				a = jsonv.ParseFloat(m[4])
			}
		}
		return RGBA{jsonv.ToNumber(m[1]), jsonv.ToNumber(m[2]), jsonv.ToNumber(m[3]), a}, true
	}
	return RGBA{}, false
}

func blend(top, bottom RGBA) RGBA {
	a := top.A
	return RGBA{top.R*a + bottom.R*(1-a), top.G*a + bottom.G*(1-a), top.B*a + bottom.B*(1-a), 1}
}

func luminance(c RGBA) float64 {
	ch := func(v float64) float64 {
		s := v / 255
		if s <= 0.03928 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*ch(c.R) + 0.7152*ch(c.G) + 0.0722*ch(c.B)
}

// ContrastRatio is the WCAG 2.x ratio between two opaque colors.
func ContrastRatio(a, b RGBA) float64 {
	l := []float64{luminance(a), luminance(b)}
	sort.Slice(l, func(i, j int) bool { return l[i] > l[j] })
	return (l[0] + 0.05) / (l[1] + 0.05)
}

// EffectiveBackground composes the ancestors' fills over white.
func EffectiveBackground(doc *Document, node *Node) (RGBA, bool) {
	var layers []RGBA
	var cur *Node
	if t := node.Str("type"); t == "text" || t == "shape" {
		cur = node
	} else {
		cur = parentOf(doc, node)
	}
	for cur != nil {
		if fill, ok := cur.Get("fill"); ok {
			c, ok := ParseColor(jsString(ResolveValue(doc, fill, ModeOf(doc, cur))))
			if !ok {
				return RGBA{}, false
			}
			layers = append(layers, c)
			if c.A >= 1 {
				break
			}
		}
		cur = parentOf(doc, cur)
	}
	bg := named["white"]
	for i := len(layers) - 1; i >= 0; i-- {
		bg = blend(layers[i], bg)
	}
	return bg, true
}

// LintIssue is one lint finding.
type LintIssue struct {
	Rule     string `json:"rule"`
	Severity string `json:"severity"`
	NodeID   string `json:"nodeId"`
	Message  string `json:"message"`
}

func tokenRefs(n *Node) []string {
	var refs []string
	check := func(v any) {
		if s, ok := v.(string); ok && strings.HasPrefix(s, "$") {
			refs = append(refs, s[1:])
		}
	}
	if v, ok := n.Get("fill"); ok {
		check(v)
	}
	if st := n.Obj("stroke"); st != nil {
		check(st.Str("color"))
	}
	if sh := n.Obj("shadow"); sh != nil {
		check(sh.Str("color"))
	}
	if t := n.Str("type"); t == "text" || t == "shape" {
		c, _ := n.Get("color")
		check(c)
		fs, _ := n.Get("fontSize")
		check(fs)
	}
	return refs
}

// toFixed is Number#toFixed for non-negative finite values (ties round up, on the exact binary value).
func toFixed(x float64, digits int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.IsInf(x, 0) || math.Abs(x) >= 1e21 {
		return jsonv.FormatNumber(x)
	}
	neg := x < 0
	exact := new(big.Float).SetPrec(2000).SetFloat64(math.Abs(x)).Text('f', 1100)
	intPart, frac, _ := strings.Cut(exact, ".")
	frac += strings.Repeat("0", digits+1)
	keep := intPart + frac[:digits]
	rest := frac[digits:]
	n := new(big.Int)
	n.SetString(keep, 10)
	if rest[0] >= '5' {
		n.Add(n, big.NewInt(1))
	}
	s := n.String()
	for len(s) <= digits {
		s = "0" + s
	}
	out := s
	if digits > 0 {
		out = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	if neg && strings.Trim(out, "0.") != "" {
		out = "-" + out
	}
	return out
}

// LintDocument runs the agent-oriented quality rules.
func LintDocument(doc *Document, rootID string) []LintIssue {
	issues := []LintIssue{}
	ids := Nodes(doc).Keys()
	if rootID != "" {
		ids = SubtreeIDs(doc, rootID)
	}
	tokens := Tokens(doc)
	hasColorTokens := false
	for _, k := range tokens.Keys() {
		v, _ := tokens.Get(k)
		if s, ok := v.(string); ok {
			if _, isColor := ParseColor(s); isColor {
				hasColorTokens = true
				break
			}
		}
	}
	add := func(rule, sev, id, msg string) {
		issues = append(issues, LintIssue{rule, sev, id, msg})
	}

	for _, id := range ids {
		node := GetNode(doc, id)
		if node == nil {
			continue
		}
		typ := node.Str("type")
		themeMode := ModeOf(doc, node)
		if m := node.Str("mode"); (typ == "frame" || typ == "page") && m != "" && (Modes(doc) == nil || !Modes(doc).Has(m)) {
			add("unknown-mode", "warning", id, `mode "`+m+`" has no tokens (set_tokens with mode); the base tokens apply`)
		}
		for _, ref := range tokenRefs(node) {
			if _, ok := TokenValue(doc, ref, themeMode); !ok {
				add("unknown-token", "error", id, `token "$`+ref+`" does not exist`)
			}
		}

		if typ == "text" || typ == "shape" {
			if typ == "text" && jsonv.Trim(node.Str("text")) == "" {
				add("empty-text", "warning", id, "empty text")
			}
			fsv, _ := node.Get("fontSize")
			fs := ResolveValue(doc, fsv, themeMode)
			size, isNum := fs.(float64)
			if !isNum {
				size = jsonv.ParseFloat(jsString(fs))
			}
			if size < 12 {
				add("small-text", "warning", id, "font size "+jsString(size)+"px (< 12px)")
			}
			colorV, _ := node.Get("color")
			fg, fgOK := ParseColor(jsString(ResolveValue(doc, colorV, themeMode)))
			bg, bgOK := EffectiveBackground(doc, node)
			if fgOK && bgOK {
				ratio := ContrastRatio(blend(fg, bg), bg)
				large := size >= 24 || (size >= 18.66 && node.Num("fontWeight") >= 700)
				min := 4.5
				if large {
					min = 3
				}
				if ratio < min {
					extra := ""
					if large {
						extra = ", large text"
					}
					add("contrast", "error", id, "contrast "+toFixed(ratio, 2)+":1 below "+jsString(min)+":1 (WCAG AA"+extra+")")
				}
			}
			if hasColorTokens && !strings.HasPrefix(node.Str("color"), "$") {
				add("raw-color", "info", id, `literal color "`+node.Str("color")+`"; prefer a token`)
			}
		}

		if typ == "path" {
			_, hasFill := node.Get("fill")
			st := node.Obj("stroke")
			if !hasFill && !(st != nil && st.Num("width") > 0) {
				add("invisible-path", "warning", id, "a path without fill or stroke is invisible; set fill or stroke {color,width}")
			}
		}

		if typ == "image" && jsonv.Trim(node.Str("alt")) == "" {
			add("missing-alt", "warning", id, "image without alternative text (alt)")
		}

		if fill, ok := node.Get("fill"); ok && hasColorTokens {
			fs := fill.(string)
			if !strings.HasPrefix(fs, "$") && fs != "transparent" {
				add("raw-color", "info", id, `literal fill "`+fs+`"; prefer a token`)
			}
		}

		if typ == "page" {
			continue
		}
		if typ == "group" && len(node.Arr("children")) == 0 {
			add("empty-group", "info", id, "empty group; delete it or move nodes into it")
		}

		parent := parentOf(doc, node)
		absolute := parent != nil && parent.Str("type") == "frame" && (parent.Obj("layout") == nil || parent.Obj("layout").Str("mode") == "none")
		if absolute && node.Bool("visible") {
			pw, pwOK := mustNum(parent, "width")
			ph, phOK := mustNum(parent, "height")
			nw, nwOK := mustNum(node, "width")
			nh, nhOK := mustNum(node, "height")
			if pwOK && phOK && nwOK && nhOK {
				x, y := node.Num("x"), node.Num("y")
				if x < 0 || y < 0 || x+nw > pw || y+nh > ph {
					label := parent.Str("name")
					if label == "" {
						label = parent.Str("id")
					}
					cut := ""
					if parent.Bool("clip") {
						cut = " and will be clipped"
					}
					add("overflow", "warning", id, `goes outside "`+label+`" (`+jsString(pw)+"×"+jsString(ph)+")"+cut)
				}
			}
		}

		if typ == "frame" && node.Str("name") == "" && (parent == nil || parent.Str("type") == "page") {
			add("unnamed-frame", "info", id, "top-level frame without a name")
		}
	}
	return issues
}

func mustNum(n *Node, k string) (float64, bool) {
	v, _ := n.Get(k)
	f, ok := v.(float64)
	return f, ok
}
