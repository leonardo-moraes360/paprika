package server

import (
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func proposalTokens(t *testing.T, content, format, mode string) *jsonv.Object {
	t.Helper()
	out, err := proposeFromContent(content, format)
	if err != nil {
		t.Fatalf("propose: %v", err)
	}
	for _, p := range out.Arr("proposals") {
		o := p.(*jsonv.Object)
		if o.Str("op") != "set_tokens" {
			t.Fatalf("op %s", jsonv.Stringify(o, ""))
		}
		if o.Str("mode") != mode {
			continue
		}
		return o.Obj("tokens")
	}
	t.Fatalf("missing mode %q in %s", mode, jsonv.Stringify(out, " "))
	return nil
}

func eqTokens(t *testing.T, got, want *jsonv.Object) {
	t.Helper()
	if jsonv.Stringify(got, "") != jsonv.Stringify(want, "") {
		t.Fatalf("tokens\n got %s\nwant %s", jsonv.Stringify(got, "  "), jsonv.Stringify(want, "  "))
	}
}

func TestProposeCSSVariables(t *testing.T) {
	css := `
/* brand */
:root {
  --color-bg: #ffffff;
  --space-md: 16px;
  --font-sans: Inter, sans-serif;
  --color-ink: var(--color-bg);
  --accent: rgb(224 74 43 / 0.18);
}
.ui-light { --panel: #f7f7f7; }
.dark { --color-bg: #111111; }
@media (prefers-color-scheme: light) {
  :root { --color-bg: #fafafa; }
}
[data-paprika-mode="escuro"] { --tela: #14161f; }
`
	out, err := proposeFromContent(css, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if out.Str("format") != "css" {
		t.Fatalf("format %s", out.Str("format"))
	}
	eqTokens(t, proposalTokens(t, css, "auto", ""), jsonv.NewObject(
		"color-bg", "#ffffff",
		"space-md", 16.0,
		"color-ink", "$color-bg",
		"accent", "rgb(224 74 43 / 0.18)",
		"panel", "#f7f7f7",
	))
	eqTokens(t, proposalTokens(t, css, "css", "dark"), jsonv.NewObject("color-bg", "#111111"))
	eqTokens(t, proposalTokens(t, css, "css", "light"), jsonv.NewObject("color-bg", "#fafafa"))
	eqTokens(t, proposalTokens(t, css, "css", "escuro"), jsonv.NewObject("tela", "#14161f"))
	var skipped bool
	for _, s := range out.Arr("skipped") {
		o := s.(*jsonv.Object)
		if o.Str("name") == "font-sans" && o.Str("reason") == notColorOrLength {
			skipped = true
		}
	}
	if !skipped {
		t.Fatalf("skipped %s", jsonv.Stringify(out, " "))
	}
	bare, err := proposeFromContent("--color-night: #141827;\n--spacing: 4px;", "css")
	if err != nil {
		t.Fatal(err)
	}
	if bare.Str("format") != "css" {
		t.Fatal(bare.Str("format"))
	}
	eqTokens(t, proposalTokens(t, "--color-night: #141827;\n--spacing: 4px;", "css", ""), jsonv.NewObject(
		"color-night", "#141827",
		"spacing", 4.0,
	))
}

func TestProposeTailwindTheme(t *testing.T) {
	js := `
// palette
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: '#c43d27',
        ink: { DEFAULT: '#111111', muted: '#666666' },
      },
      spacing: { md: '16px', rem: '1rem' },
      borderRadius: { md: '12px' },
      fontSize: { body: ['16px', { lineHeight: '24px' }] },
    },
  },
}
`
	out, err := proposeFromContent(js, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if out.Str("format") != "tailwind" {
		t.Fatalf("format %s\n%s", out.Str("format"), jsonv.Stringify(out, "  "))
	}
	eqTokens(t, proposalTokens(t, js, "tailwind", ""), jsonv.NewObject(
		"color.brand", "#c43d27",
		"color.ink", "#111111",
		"color.ink.muted", "#666666",
		"spacing.md", 16.0,
		"radius.md", 12.0,
		"fontSize.body", 16.0,
		"lineHeight.body", 24.0,
	))
	theme := `@theme static {
  --color-accent: #e04a2b;
  --spacing-md: 8px;
}`
	got, err := proposeFromContent(theme, "tailwind")
	if err != nil {
		t.Fatal(err)
	}
	if got.Str("format") != "css" {
		t.Fatalf("v4 theme format %s", got.Str("format"))
	}
	eqTokens(t, proposalTokens(t, theme, "tailwind", ""), jsonv.NewObject(
		"color-accent", "#e04a2b",
		"spacing-md", 8.0,
	))
}

func TestProposeJSONTokens(t *testing.T) {
	raw := `{
  "color": { "bg": { "$value": "#ffffff", "$type": "color" } },
  "space": { "md": { "value": "8px", "type": "dimension" } },
  "alias": { "ink": { "$value": "{color.bg}" } },
  "modes": { "dark": { "color": { "bg": { "$value": "#000000" } } } },
  "__proto__": "#fff"
}`
	out, err := proposeFromContent(raw, "json")
	if err != nil {
		t.Fatal(err)
	}
	if out.Str("format") != "json" {
		t.Fatal(out.Str("format"))
	}
	eqTokens(t, proposalTokens(t, raw, "json", ""), jsonv.NewObject(
		"color.bg", "#ffffff",
		"space.md", 8.0,
		"alias.ink", "$color.bg",
	))
	eqTokens(t, proposalTokens(t, raw, "auto", "dark"), jsonv.NewObject("color.bg", "#000000"))
	skippedProto := false
	for _, s := range out.Arr("skipped") {
		if s.(*jsonv.Object).Str("name") == "__proto__" {
			skippedProto = true
		}
	}
	if !skippedProto {
		t.Fatalf("proto not skipped: %s", jsonv.Stringify(out, " "))
	}
	flat := `{"brand":"#c43d27","size":16}`
	eqTokens(t, proposalTokens(t, flat, "auto", ""), jsonv.NewObject("brand", "#c43d27", "size", 16.0))
	tw := `{"theme":{"extend":{"colors":{"brand":"#c43d27"},"spacing":{"md":"16px"}}}}`
	got, err := proposeFromContent(tw, "auto")
	if err != nil {
		t.Fatal(err)
	}
	if got.Str("format") != "tailwind" {
		t.Fatalf("format %s", got.Str("format"))
	}
	eqTokens(t, proposalTokens(t, tw, "auto", ""), jsonv.NewObject("color.brand", "#c43d27", "spacing.md", 16.0))
}

func TestProposeTokensRefusesPaths(t *testing.T) {
	for _, p := range []string{"/etc/passwd", "../secrets.css", "./styles.css", "tokens.json", `C:\tokens.css`, "file:///tmp/theme.css"} {
		_, err := proposeFromContent(p, "auto")
		if err == nil || !strings.Contains(err.Error(), "not a path") {
			t.Fatalf("%q: %v", p, err)
		}
	}
	_, err := proposeFromContent("just words", "auto")
	if err == nil || !strings.Contains(err.Error(), "unrecognized") {
		t.Fatal(err)
	}
}

func TestProposeTokensDoesNotWrite(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	css := ":root { --color-bg: #ffffff; --space-md: 16px; }\n.dark { --color-bg: #111111; }"
	before := s.Version()
	out, isErr := callText(t, m, "propose_tokens", obj("content", css))
	if isErr {
		t.Fatal(out)
	}
	if s.Version() != before {
		t.Fatalf("propose wrote, version %d", s.Version())
	}
	parsed, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	body := parsed.(*jsonv.Object)
	if body.Str("format") != "css" || len(body.Arr("proposals")) != 2 {
		t.Fatalf("result %s", out)
	}
	applied, isErr := callText(t, m, "apply_ops", obj("ops", body.Arr("proposals"), "label", "from css"))
	if isErr {
		t.Fatal(applied)
	}
	outline, _ := callText(t, m, "get_document_outline", nil)
	if !strings.Contains(outline, "$color-bg=#ffffff") || !strings.Contains(outline, "$space-md=16") || !strings.Contains(outline, "modes: dark($color-bg=#111111)") {
		t.Fatalf("outline %s", outline)
	}
	again, isErr := callText(t, m, "propose_tokens", obj("content", "/etc/passwd"))
	if !isErr || !strings.Contains(again, "not a path") {
		t.Fatalf("path: %v %s", isErr, again)
	}
	if _, isErr = callText(t, m, "propose_tokens", obj("content", css, "format", "nope")); !isErr {
		t.Fatal("bad format accepted")
	}
}
