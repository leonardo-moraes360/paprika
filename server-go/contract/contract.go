// Package contract embeds the MCP contract dumped from the TypeScript reference server
// (scripts/gen-contract.mjs): tool definitions, instructions, server info and the pt-BR guide.
package contract

import _ "embed"

//go:embed mcp.json
var MCP []byte

// GuidePtBR is the Brazilian Portuguese design guide (get_design_guide {language: "pt-BR"}).
//
//go:embed guide.pt-BR.md
var GuidePtBR string

// Measure is MEASURE_SCRIPT from @paprika/core (svgExport.ts): it measures node boxes and text
// lines of the RenderHTML page, for the SVG export.
//
//go:embed measure.js
var Measure string
