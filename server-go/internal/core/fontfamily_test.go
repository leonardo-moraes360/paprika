package core

import "testing"

// Same table as packages/core/test/renderParity.test.ts: the port must agree with the reference.
func TestWithGenericFamily(t *testing.T) {
	cases := map[string]string{
		"Inter":                        "Inter, sans-serif",
		"Inter, system-ui, sans-serif": "Inter, system-ui, sans-serif",
		"'Fira Code'":                  "'Fira Code', monospace",
		"Georgia":                      "Georgia, serif",
		"IBM Plex Sans":                "IBM Plex Sans, sans-serif",
		`"Source Serif 4", Georgia`:    `"Source Serif 4", Georgia, serif`,
		"var(--font-body)":             "var(--font-body), sans-serif",
		`"a, b"`:                       `"a, b", sans-serif`,
	}
	for in, want := range cases {
		if got := WithGenericFamily(in); got != want {
			t.Errorf("WithGenericFamily(%q) = %q, want %q", in, got, want)
		}
	}
}
