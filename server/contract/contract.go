// Package contract embeds the MCP contract served verbatim: tool definitions, instructions and
// server info (mcp.json) and the pt-BR guide. Both are edited by hand (they were first dumped
// from the former TypeScript server); packages/e2e checks that the server serves them.
package contract

import _ "embed"

//go:embed mcp.json
var MCP []byte

// GuidePtBR is the Brazilian Portuguese design guide (get_design_guide {language: "pt-BR"}).
//
//go:embed guide.pt-BR.md
var GuidePtBR string

// Measure is MEASURE_SCRIPT from @paprika/core (svgExport.ts), copied by scripts/gen-measure.mjs:
// it measures node boxes and text lines of the RenderHTML page, for the SVG export.
//
//go:embed measure.js
var Measure string
