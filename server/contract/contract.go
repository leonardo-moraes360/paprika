package contract

import _ "embed"

//go:embed mcp.json
var MCP []byte

//go:embed guide.pt-BR.md
var GuidePtBR string

//go:embed measure.js
var Measure string
