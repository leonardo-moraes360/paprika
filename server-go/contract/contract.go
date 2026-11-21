// Package contract embeds the MCP contract dumped from the TypeScript reference server
// (scripts/gen-contract.mjs): tool definitions, instructions and server info.
package contract

import _ "embed"

//go:embed mcp.json
var MCP []byte
