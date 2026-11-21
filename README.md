🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

<p align="center"><img src="docs/brand/icon.svg" alt="Paprika icon" width="128"></p>

# Paprika

A **local** design tool for AI agents, with a **built-in MCP server**.
You and your agent edit the same document at the same time: the agent through MCP, you on a canvas in the browser.
Every edit from either side goes through the same path (validated, atomic operations), lands in the same undo history and is saved to a `.paprika.json` file you can version with git.

> Original project. Paper (paper.design) was only a conceptual reference ("an HTML/CSS canvas connected to agents"); no code, assets or behavior were copied or reverse-engineered.

## Why

| Problem with agents in design tools | How Paprika handles it |
|---|---|
| Agents burn tokens reading huge trees | `get_document_outline`: one line per node, with configurable depth |
| A partial edit leaves the file broken | Every write is a transaction: all or nothing |
| Misspelled fields silently disappear | Unknown fields are rejected with an actionable error |
| The agent can't tell whether it looks right | `lint_design` (WCAG contrast, overflow, tokens) + `render_screenshot` |
| What the agent sees ≠ what the human sees ≠ the code | A single style engine (`nodeStyle`) for canvas, screenshot and export |
| Call limits / SaaS lock-in | 100% local, no account, no limits |

## Quick start

Requirements: Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm build
node packages/server/dist/cli.js serve --file examples/demo.paprika.json
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshots over MCP use Playwright (optional dependency). If Chromium isn't installed:

```bash
pnpm --filter @paprika/server exec playwright install chromium
```

## Connecting an agent

**HTTP (recommended, with the canvas open):** run `paprika serve` and point the agent at `http://127.0.0.1:4777/mcp`.

Claude Code:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

**stdio** (for agents that only speak stdio). The process also serves the canvas on port 4777 if it's free:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "node",
      "args": ["<PATH>/paprika/packages/server/dist/cli.js", "mcp", "--file", "<PATH>/design.paprika.json"]
    }
  }
}
```

## MCP tools

| Tool | What it does |
|---|---|
| `get_design_guide` | Node model, accepted fields and recommended workflow |
| `get_document_outline` | Compact tree + tokens + version |
| `get_nodes` / `find_nodes` | Full node JSON / search by type, name, text |
| `path_info` | Validates SVG path data and returns the exact bounds (bezier and arc extremes included) and the normalized `d` |
| `create_nodes` | Creates nested trees in one call |
| `update_nodes` / `move_nodes` / `delete_nodes` | Atomic batch edits |
| `apply_ops` | Mixed transaction (create, update, delete, move, set_tokens, rename_document) |
| `set_tokens` | Design tokens (`$name`) for colors and sizes |
| `undo` / `redo` / `get_history` | History shared with the human |
| `lint_design` | WCAG AA contrast, overflow, missing tokens, small text, alt text |
| `render_screenshot` | PNG of a node or of the whole canvas |
| `export_code` | Standalone HTML or a React (TSX) component |

> The agent-facing guide and error messages are currently in Brazilian Portuguese.

## Canvas

Shortcuts: `V` select, `F` frame, `R` rectangle, `O` ellipse, `T` text, `P` pen (click = corner point, click and drag = bezier handles, click the first point to close, `Enter`/`Esc`/double-click to finish an open path, `Backspace` removes the last point), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D` duplicate, `Delete`, arrows (Shift = 10px), `Esc` selects the parent.
Navigation: scroll = pan, `Ctrl`+scroll = zoom, hold `Space` (or `Enter`) and drag = pan (the cursor turns into a hand).
Agent edits flash on the canvas and show up under "Atividade" (activity).

### Renderer: DOM or WASM

The button at the right of the zoom pill switches how shapes are drawn ([ADR 0002](docs/adr/0002-canvas-renderer-rust-wasm.md)):

- **DOM** (default): every node is an HTML element styled by `nodeStyle`, the same engine as the screenshot and the export.
- **WASM**: frames, rectangles, ellipses and paths are drawn by `crates/render` (Rust, [vello](https://github.com/linebender/vello)) on a `<canvas>` under the DOM. It uses **WebGPU** when the browser has a hardware adapter (the button reads `GPU`) and falls back to **vello_cpu** otherwise (`CPU`), including when only a software WebGPU adapter exists. Text, images, selection and hit testing stay in the DOM.

The choice is saved in the browser; `?renderer=wasm` or `?renderer=dom` in the URL overrides it. Nodes the WASM layer cannot draw exactly (gradients and other non-solid colors, a shadow on a path) keep their DOM paint. Known difference: text and images always sit above WASM-drawn shapes, even when a shape comes later in the layer order. Screenshots and exports are unchanged (HTML).

The WASM renderer is built by `pnpm build` when Rust is installed (`rustup target add wasm32-unknown-unknown` and `cargo install wasm-bindgen-cli --version 0.2.130`); without it the build prints a warning and the button stays disabled. `PAPRIKA_REQUIRE_WASM=1` turns that warning into an error.

## Document format

```jsonc
{
  "format": "paprika/1",
  "name": "Demo",
  "tokens": { "brand": "#c43d27", "text.md": 16 },
  "rootIds": ["login"],
  "nodes": {
    "login": { "type": "frame", "id": "login", "parentId": null, "width": 390, "height": 760,
               "layout": { "mode": "column", "gap": 20, "padding": 24 }, "children": ["t1"] },
    "t1": { "type": "text", "id": "t1", "parentId": "login", "text": "Hello", "color": "$brand",
            "width": "fill", "height": "hug" }
  }
}
```

Types: `frame` (the only one with children; free, row or column layout), `rect`, `ellipse`, `text`, `image`, `path` (vector shape from SVG path data: lines, cubic and quadratic bezier curves, arcs; `fill`, `stroke`, `fillRule`, `strokeCap`, `strokeJoin`, optional `viewBox` to scale an icon grid).
Sizes: a number, `"hug"` (fit content) or `"fill"` (take the parent's space). Details in [docs/architecture.md](docs/architecture.md). Planned work lives in [docs/backlog.md](docs/backlog.md).

## Layout

```
packages/core     model (zod), atomic applyOps, History, nodeStyle, render/export, lint, outline
packages/server   DocumentStore (file + watch), MCP (stdio and HTTP), WebSocket, screenshot, CLI
apps/web          React + Vite canvas
apps/site         landing page (drawn in Paprika) + docs site, published to paprika.js.org
server-go/        the same server in Go, with SQLite storage (see below)
examples/         demo generated by an agent over MCP (packages/server/scripts/seed-demo.mjs)
```

## Go server (SQLite)

`server-go/` is a Go implementation of the server with the same MCP tools, WebSocket protocol and HTTP API, storing documents, tokens and the undo/redo history in SQLite (`.paprika.json` files go in and out with `paprika import` / `paprika export`). It serves the same canvas, and the same black-box and E2E suites run against both servers. Usage, storage layout and parity checks: [server-go/README.md](server-go/README.md); decision record: [ADR 0001](docs/adr/0001-go-server-sqlite.md).

```bash
pnpm build && pnpm go:build
server-go/bin/paprika import examples/demo.paprika.json --db design.db
server-go/bin/paprika serve --db design.db
```

## Development

```bash
pnpm check        # build + typecheck + unit/integration tests + E2E (Playwright)
pnpm dev          # server with the demo; in another terminal: pnpm --filter @paprika/web dev
pnpm check:go     # Go server: fixtures up to date, go test, parity and E2E against the Go binary
pnpm test:render  # Rust renderer (crates/render): native tests with vello_cpu
```

CI runs on pull requests only and picks the jobs from the files the PR changes: see [docs/ci.md](docs/ci.md).

This repository uses [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as its agent harness: invariants live in `.toolbelt/invariants.yaml` (`tb mem list`), and `tb verify run` / `tb stack verify guard` run before work is called done. Claude Code cloud sessions install the pinned `tb` on start ([docs/agent-sessions.md](docs/agent-sessions.md)).

## Security

- Binds to `127.0.0.1` by default; Host and Origin are validated (blocks DNS rebinding and CSRF from pages open in the browser).
- There is no authentication: `--host 0.0.0.0` exposes the document to the network. Only use it on a trusted network.
- `https://` images are fetched by Chromium when taking screenshots.

To report a vulnerability, use GitHub's private vulnerability reporting; see [SECURITY.md](SECURITY.md). Please don't open a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
