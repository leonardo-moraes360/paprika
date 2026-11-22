# Agents and MCP

How an AI agent talks to Paprika: connecting it, the tools it gets and the file format behind a design. Back to the [README](../README.md).

Português: [pt-BR/mcp.md](pt-BR/mcp.md).

## Connecting an agent

**HTTP (recommended, with the canvas open):** start Paprika (`docker compose up -d --build`, or `paprika serve` from source) and point the agent at `http://127.0.0.1:4777/mcp`. With Docker, stdio works too: see [docker.md](docker.md).

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
| `get_document_outline` | Compact tree + tokens + version. The first line is `workspace <id> "<name>"` plus version and node count |
| `get_nodes` / `find_nodes` | Full node JSON / search by type, name, text |
| `path_info` | Validates SVG path data and returns the exact bounds (bezier and arc extremes included), the drawing `origin` (offset from the node origin), and the normalized `d`; with `id` also returns canvas bounds, transform origin and rotated corners |
| `get_bounds` | Absolute boxes after auto-layout (row/column, hug/fill): `x`/`y`/`width`/`height`, transform `origin` (box centre) and the four corners after rotation; optional `ids` / `rootId` |
| `create_nodes` | Creates nested trees in one call; on a connector `x`/`y`/`width`/`height`/`d` follow `from`/`to`, so a copied node that carries them gets a warning instead of a refusal; on a path, `normalize: true` moves the drawing to (0,0) and shifts `x`/`y` |
| `draw_diagram` | Draws a diagram (flowchart, architecture, mind map) from a list of shapes and edges: lays the shapes out in layers (`direction`: down or right, to the right of existing content) and connects them with arrows that follow the shapes; an edge can carry a `label` |
| `update_nodes` / `move_nodes` / `delete_nodes` | Atomic batch edits. `index` in `update` props or in `move` sets Z-order in the node's parent: a number from 0 (the back) or `front` / `back` / `forward` / `backward`, in the same undo step as the other fields |
| `group_nodes` / `ungroup_nodes` | Wraps sibling nodes in a `group` (the drawing stays put) / puts them back |
| `combine_paths` | Boolean combine of 2+ sibling `path` / `rect` / `ellipse` / `shape` nodes into one `path` (`operation`: `union`, `subtract`, `intersect`, `exclude`). Keeps the bottom-most node's style, deletes the sources, one undo step. Returns `path` (the new id). No canvas menu in this tool — agents use MCP / `apply_ops` |
| `duplicate_nodes` | Copies nodes with their whole subtree in one undo step: `offset` (default 40), `parentId`, `scale` (sizes, text, strokes, spacing and instance `scale`) and `props` written on each copy (`{ "mode": "dark" }` makes the light/dark pair). Instances stay instances of the same component; connectors between duplicated nodes follow the copies. Returns `copies` (one id per source) and `map` (every source node to its copy) |
| `create_page` | Adds a page; the first one moves the current canvas into "Página 1" |
| `create_component` / `create_instance` / `detach_instance` | Marks a frame as a component / places a copy of it (with `scale` and `overrides`; returns the id of every copy) / turns an instance into plain nodes |
| `apply_ops` | Mixed transaction (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach, combine_paths) |
| `set_tokens` | Design tokens (`$name`) for colors and sizes; with `mode`, the values of a theme mode (e.g. `dark`) that frames and pages pick with `mode` |
| `list_workspaces` / `open_workspace` / `create_workspace` / `import_document` | Lists the workspaces (documents) of the server / makes one active for every tool and the human's canvas / creates an empty one / stores a `.paprika.json` (e.g. from `paprika export --root ID`) as a new workspace without switching the active one |
| `rename_workspace` / `delete_workspace` | Renames a workspace (undoable when it is the active one) / deletes one for good, in two calls: without `confirmToken` nothing is deleted and the result is a summary of what would be lost (counts, last edit, cover, which workspace takes over) plus a token that lasts about two minutes and belongs to that workspace; the second call with the token deletes (the active one hands over to the most recently updated other; the only one cannot be deleted) |
| `list_workspace_ops` | The workspace operations log — create, rename, open and delete, each with who acted (`user` or the agent's name), when and which workspace; a delete entry keeps the summary, and entries outlive the workspace they name |
| `set_workspace_cover` | Puts an image on a workspace's overview card: a screenshot of one of its frames (`rootId`), an image (`image`, base64 or data URL) or none (`clear`, back to the first letter) |
| `undo` / `redo` / `get_history` | History of one workspace, shared with the human when that workspace is the active one. Optional `workspaceId` undoes, redoes or reads that workspace only, without switching the canvas. Every write tool takes `batch`, so several calls with the same batch become one undo step |
| `lint_design` | WCAG AA contrast, overflow, missing tokens, small text, alt text |
| `render_screenshot` | PNG of a node, a page or the whole canvas (headless Chromium) |
| `export_image` | PNG, JPEG, WebP, AVIF or vector PDF of a node/page/canvas **without Chromium**: rasterizes core `ExportSVG` (layout geometry) in pure Go; PDF draws the same path as vectors. Optional `workspaceId` exports that workspace without switching the canvas |
| `import_svg` / `import_html` | Turns pasted SVG (paths, shapes, groups, transforms) or HTML with inline styles into editable nodes; what can't be imported comes back in `warnings` |
| `import_image` | Places a raster image (PNG, JPEG, WebP, AVIF or GIF) as an `image` node sized from the file. `src` is a data URL or a local path under `PAPRIKA_IMPORT_DIRS` (default: the server's working directory). Files over 3500000 bytes are refused. Original bytes are kept, so animated GIF/WebP/AVIF stay animated on the canvas and in HTML exports (`render_screenshot` captures one frame) |
| `resize_image` | Resamples an `image` node (or creates one from `src`) to `qhd` 960×540, `hd` 1280×720, `2k` 2560×1440, `4k` 3840×2160, or `{width,height}`. Pure Go (`golang.org/x/image` CatmullRom); no Chromium. `fit`: `contain` (default), `cover`, `fill`. Animated GIF → first frame; animated WebP and AVIF refused. Same format when encodable in pure Go (PNG/JPEG/GIF), else PNG |
| `export_code` | Standalone HTML, a React (TSX) component, vector SVG (boxes from core `layout(doc)`, no headless Chromium), a React component with Tailwind utility classes (`tailwind`), standalone HTML with Tailwind classes (`tailwind-html`), a React component plus its `.module.css` (`css-modules`: two text blocks, the `.tsx` first and the stylesheet second), an Angular standalone component (`angular`: three text blocks — `.ts`, template, `.css`) or a Svelte single-file component (`svelte`); `cssVariables: true` writes tokens as `var(--name)` with one rule per theme mode |

Agent layer:
- The guide, tool descriptions, errors, warnings and lint messages are in English (the guide also in pt-BR, see above).
- Tools that answer JSON declare an `outputSchema` and return `structuredContent`; the text block keeps the same JSON (for `get_nodes` and `get_history`, the plain array).
- Document tools take an optional `workspaceId` (outline, nodes, bounds, create/update/delete/move/group, tokens, lint, screenshot, export, imports, undo/redo and the other document writes). Omit it to use the active workspace, which is the human's canvas. Passing it reads or writes that workspace without `open_workspace` and without moving the canvas. The outline's first line and every write result include `workspaceId` and `workspaceName`. Each workspace keeps its own history for the life of the process. An unknown id is an error that lists the workspaces.
- The history names the agent after its MCP `clientInfo.name` (`agent:claude-code`). Over HTTP the server is stateless, so `initialize` hands out an `Mcp-Session-Id` that only carries that name; without it, the User-Agent is used as before.

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
`stroke` is `{ color, width, style?, position? }` with `style` `solid`|`dashed`|`dotted` (dash pattern from width; omit = solid) and `position` `inside`|`center`|`outside` (omit = inside for boxes/shapes, center for paths).
Sizes: a number, `"hug"` (fit content) or `"fill"` (take the parent's space). Details in [docs/architecture.md](architecture.md). Planned work lives in [docs/backlog.md](backlog.md).
