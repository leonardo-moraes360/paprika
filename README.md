🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

<p align="center"><img src="docs/brand/icon.svg" alt="Paprika icon" width="128"></p>

<p align="center"><img src="docs/assets/paprika-window.png" alt="Paprika canvas open on the brand proposals: layers on the left, canvas in the middle, document tokens on the right" width="900"></p>

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

Requirements: Node 22+, pnpm 10+ and Go 1.26+.

```bash
pnpm install
pnpm build                                   # canvas + server binary (server-go/bin/paprika)
server-go/bin/paprika import examples/demo.paprika.json --db design.db
server-go/bin/paprika serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshots and SVG export over MCP need a Chromium. The server finds Playwright's browsers on its own; if none is installed, install one (or point `PAPRIKA_CHROMIUM` at any Chrome):

```bash
pnpm --filter @paprika/e2e exec playwright install chromium
```

### With Docker

One image with the server, the canvas and the WASM renderer; the SQLite database lives in a volume:

```bash
docker compose up -d --build                 # or: docker build -t paprika . && docker run -d -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
# canvas: http://localhost:4777   ·   MCP: http://localhost:4777/mcp
```

Keep the host port at 4777 (the server checks `Host`). Import/export, stdio, the `slim` target and how the image is built: [docs/docker.md](docs/docker.md).

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
      "command": "<PATH>/paprika/server-go/bin/paprika",
      "args": ["mcp", "--db", "<PATH>/design.db"]
    }
  }
}
```

## MCP tools

| Tool | What it does |
|---|---|
| `get_design_guide` | Node model, accepted fields and recommended workflow; `language: "pt-BR"` for the Brazilian Portuguese version |
| `get_document_outline` | Compact tree + tokens + version |
| `get_nodes` / `find_nodes` | Full node JSON / search by type, name, text |
| `path_info` | Validates SVG path data and returns the exact bounds (bezier and arc extremes included) and the normalized `d` |
| `create_nodes` | Creates nested trees in one call |
| `draw_diagram` | Draws a diagram (flowchart, architecture, mind map) from a list of shapes and edges: lays the shapes out in layers (`direction`: down or right, to the right of existing content) and connects them with arrows that follow the shapes |
| `update_nodes` / `move_nodes` / `delete_nodes` | Atomic batch edits |
| `group_nodes` / `ungroup_nodes` | Wraps sibling nodes in a `group` (the drawing stays put) / puts them back |
| `create_page` | Adds a page; the first one moves the current canvas into "Página 1" |
| `create_component` / `create_instance` / `detach_instance` | Marks a frame as a component / places a copy of it (with `scale` and `overrides`; returns the id of every copy) / turns an instance into plain nodes |
| `apply_ops` | Mixed transaction (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach) |
| `set_tokens` | Design tokens (`$name`) for colors and sizes; with `mode`, the values of a theme mode (e.g. `dark`) that frames and pages pick with `mode` |
| `list_workspaces` / `open_workspace` / `create_workspace` | Lists the workspaces (documents) of the server / makes one active for every tool and the human's canvas / creates an empty one |
| `rename_workspace` / `delete_workspace` | Renames a workspace (undoable when it is the active one) / deletes one for good (the active one hands over to the most recently updated other; the only one cannot be deleted) |
| `set_workspace_cover` | Puts an image on a workspace's overview card: a screenshot of one of its frames (`rootId`), an image (`image`, base64 or data URL) or none (`clear`, back to the first letter) |
| `undo` / `redo` / `get_history` | History shared with the human; every write tool takes `batch`, so several calls with the same batch become one undo step |
| `lint_design` | WCAG AA contrast, overflow, missing tokens, small text, alt text |
| `render_screenshot` | PNG of a node, a page or the whole canvas |
| `import_svg` / `import_html` | Turns pasted SVG (paths, shapes, groups, transforms) or HTML with inline styles into editable nodes; what can't be imported comes back in `warnings` |
| `export_code` | Standalone HTML, a React (TSX) component or vector SVG (layout measured in headless Chromium); `cssVariables: true` writes tokens as `var(--name)` with one rule per theme mode |

Agent layer:
- The guide, tool descriptions, errors, warnings and lint messages are in English (the guide also in pt-BR, see above).
- Tools that answer JSON declare an `outputSchema` and return `structuredContent`; the text block keeps the same JSON (for `get_nodes` and `get_history`, the plain array).
- The history names the agent after its MCP `clientInfo.name` (`agent:claude-code`). Over HTTP the server is stateless, so `initialize` hands out an `Mcp-Session-Id` that only carries that name; without it, the User-Agent is used as before.

## Canvas

Workspaces: `http://127.0.0.1:4777` opens on the workspace overview: one click selects a card, a double click (or Enter) opens that workspace's canvas at `/w/<id>`, a double click on the name (or F2) renames it, the picture button (or dropping an image on the card) sets its cover image, and the trash button (or Delete) deletes it after a confirmation; without a cover the card shows the first letter of the name; the Paprika logo goes back. A workspace is one document of the database. The server has one active workspace, shared by the canvas and the MCP agents: opening a workspace (on the canvas or with `open_workspace`) switches it for everyone, and the canvas follows when an agent switches. HTTP: `GET /api/workspaces`, `POST /api/workspaces` (`{ "name" }`), `POST /api/workspaces/<id>/open`, `PATCH /api/workspaces/<id>` (`{ "name" }`), `DELETE /api/workspaces/<id>` (409 for the only workspace), `GET`/`PUT`/`DELETE /api/workspaces/<id>/cover` (PUT takes the raw PNG, JPEG, WebP or GIF, at most 2 MiB; never SVG).

Shortcuts: `V` select, `F` frame, `R` rectangle, `O` ellipse, `T` text, `P` pen (click = corner point, click and drag = bezier handles, click the first point to close, `Enter`/`Esc`/double-click to finish an open path, `Backspace` removes the last point), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D` duplicate, `Delete`, arrows (Shift = 10px), `Esc` selects the parent.
Selection: `Shift`-click (canvas or layers) adds or removes a node, dragging on empty canvas draws a selection box, `Ctrl+A` selects the siblings (or the whole page), `Ctrl+G` groups the selection, `Ctrl+Shift+G` ungroups. A click inside a group selects the group; double-click selects the node under the cursor. Dragging, arrows, `Delete` and `Ctrl+D` act on the whole selection.

Components: "Make component" in the inspector of a frame, then "New instance". A click inside an instance selects the instance; select a copy in the layers (or double-click it) to override its text, colors, opacity or visibility. Changes to the component reach every instance; "Detach" turns an instance into plain nodes.
Theme modes: the inspector's document panel lists the tokens of each mode and adds one with `dark: bg = #14161f`; "Theme mode" on a frame or page applies a mode to everything inside it.
Diagrams: `S` box, `D` diamond (decision), `N` sticky note, `A` arrow. A click creates a shape at its default size (or drag to size it) and starts editing its text; double-click a shape to edit the text again (`Enter` adds a line, `Esc`, `Ctrl+Enter` or clicking away confirms). With the arrow tool, drag from one shape to another: both ends stick to the shapes and the arrow follows them when they move (an end dropped on empty canvas stays at that point). Deleting a shape deletes its arrows; the inspector switches an arrow between elbow and straight, picks the side of each end, the arrowheads and dashes.
Point editing: double-click a path to edit its points. Drag a point (its handles come along) or a handle (the opposite handle mirrors it; hold `Alt` to move it alone). Double-click a point to switch between corner and smooth, double-click the outline to add a point, `Delete` removes the selected point, `Esc` or `Enter` finish. Each gesture is one undo step. Quadratic curves and arcs become cubic curves once you edit them.
Paste and export: `Ctrl+V` with SVG markup or HTML (e.g. copied from a web page) in the clipboard creates editable nodes inside the selected frame, or on the page at the center of the view. The `⇩` toolbar button downloads the selection (or the current page) as SVG.
Pages: the "Páginas" panel on the left switches pages, `+` adds one (the first `+` turns the current canvas into "Página 1"), double-click renames, `×` deletes (undoable).
Renaming: double-click a layer in the "Camadas" panel or a frame title on the canvas to rename it in place. `Enter` or clicking away confirms, `Esc` cancels; each rename is one undo step. Instance copies take their name from the component.
Navigation: scroll = pan, `Ctrl`+scroll = zoom, hold `Space` (or `Enter`) and drag = pan (the cursor turns into a hand).
Agent edits flash on the canvas and show up under "Atividade" (activity).
Agent presence: every agent connected over MCP gets its own cursor, name and color on the canvas, like a multiplayer session. Each tool call (reads too) moves the cursor to the nodes it acted on, outlines them and labels what the agent is doing; the list at the top right shows who is in the document. Two sessions of the same client get distinct names ("claude-code", "claude-code 2"). Presence is not saved: an idle agent fades after 15 s and disappears after 2 minutes.

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

Types: `frame` (container with paint and free, row or column layout), `group` (wraps nodes without painting; its box follows the children), `frame` with `component: true` (a component) or `instanceOf` (an instance: its children are generated copies of the component, scaled by `scale`, with `overrides`), `page` (a separate canvas in the file; once a document has pages, every top-level node is a page and the frames live inside them), `rect`, `ellipse`, `text`, `image`, `path` (vector shape from SVG path data: lines, cubic and quadratic bezier curves, arcs; `fill`, `stroke`, `fillRule`, `strokeCap`, `strokeJoin`, optional `viewBox` to scale an icon grid).
Sizes: a number, `"hug"` (fit content) or `"fill"` (take the parent's space). Details in [docs/architecture.md](docs/architecture.md). Planned work lives in [docs/backlog.md](docs/backlog.md).

## Layout

```
packages/core     model (zod), atomic applyOps, History, nodeStyle, render/export, lint, outline
server-go/        the server (Go + SQLite): MCP (stdio and HTTP), WebSocket, HTTP API, screenshot, CLI
packages/e2e      black-box suites against the server binary: MCP/HTTP/WS API and canvas E2E (Playwright)
apps/web          React + Vite canvas
apps/site         landing page (drawn in Paprika) + docs site, published to paprika.js.org
examples/         demo generated by an agent over MCP (packages/e2e/scripts/seed-demo.mjs)
```

## Server (Go + SQLite)

The server lives in `server-go/` and stores documents, tokens and the undo/redo history in SQLite; `.paprika.json` files go in and out with `paprika import` / `paprika export` (to commit a design, for example). Commands, storage layout and tests: [server-go/README.md](server-go/README.md); decision record: [ADR 0001](docs/adr/0001-go-server-sqlite.md).

## Development

```bash
pnpm check        # build + typecheck + fixtures up to date + unit and Go tests + API and E2E suites
pnpm dev          # server with the demo (dev.db, reset on start); in another terminal: pnpm --filter @paprika/web dev
pnpm test:api     # black-box MCP/HTTP/WS suite against server-go/bin/paprika
pnpm test:e2e     # canvas E2E (Playwright) against server-go/bin/paprika
pnpm test:render  # Rust renderer (crates/render): native tests with vello_cpu
```

CI runs on pull requests only and picks the jobs from the files the PR changes: see [docs/ci.md](docs/ci.md).

This repository uses [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as its agent harness: invariants live in `.toolbelt/invariants.yaml` (`tb mem list`), and `tb verify run` / `tb stack verify guard` run before work is called done. Claude Code cloud sessions install the pinned `tb` on start ([docs/agent-sessions.md](docs/agent-sessions.md)).

## Security

- Binds to `127.0.0.1` by default; Host and Origin are validated (blocks DNS rebinding and CSRF from pages open in the browser).
- There is no authentication: `--host 0.0.0.0` exposes the document to the network. Only use it on a trusted network.
- The Docker image binds `0.0.0.0` inside the container; publish it on the host's loopback (`-p 127.0.0.1:4777:4777`, as `compose.yaml` does) ([docs/docker.md](docs/docker.md)).
- `https://` images are fetched by Chromium when taking screenshots.

To report a vulnerability, use GitHub's private vulnerability reporting; see [SECURITY.md](SECURITY.md). Please don't open a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
