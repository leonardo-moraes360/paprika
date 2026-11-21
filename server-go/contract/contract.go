// Package contract embeds the MCP contract dumped from the TypeScript reference server
// (scripts/gen-contract.mjs): tool definitions, instructions and server info.
package contract

import _ "embed"

//go:embed mcp.json
var MCP []byte

// Measure is MEASURE_SCRIPT from @paprika/core (svgExport.ts): it measures node boxes and text
// lines of the RenderHTML page, for the SVG export.
//
//go:embed measure.js
var Measure string
