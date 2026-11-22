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
| `get_document_outline` | Compact tree + tokens + version |
| `get_nodes` / `find_nodes` | Full node JSON / search by type, name, text |
| `path_info` | Validates SVG path data and returns the exact bounds (bezier and arc extremes included) and the normalized `d` |
| `create_nodes` | Creates nested trees in one call; on a connector `x`/`y`/`width`/`height`/`d` follow `from`/`to`, so a copied node that carries them gets a warning instead of a refusal |
| `draw_diagram` | Draws a diagram (flowchart, architecture, mind map) from a list of shapes and edges: lays the shapes out in layers (`direction`: down or right, to the right of existing content) and connects them with arrows that follow the shapes; an edge can carry a `label` |
| `update_nodes` / `move_nodes` / `delete_nodes` | Atomic batch edits. `index` in `update` props or in `move` sets Z-order in the node's parent: a number from 0 (the back) or `front` / `back` / `forward` / `backward`, in the same undo step as the other fields |
| `group_nodes` / `ungroup_nodes` | Wraps sibling nodes in a `group` (the drawing stays put) / puts them back |
| `duplicate_nodes` | Copies nodes with their whole subtree in one undo step: `offset` (default 40), `parentId`, `scale` (sizes, text, strokes, spacing and instance `scale`) and `props` written on each copy (`{ "mode": "dark" }` makes the light/dark pair). Instances stay instances of the same component; connectors between duplicated nodes follow the copies. Returns `copies` (one id per source) and `map` (every source node to its copy) |
| `create_page` | Adds a page; the first one moves the current canvas into "Página 1" |
| `create_component` / `create_instance` / `detach_instance` | Marks a frame as a component / places a copy of it (with `scale` and `overrides`; returns the id of every copy) / turns an instance into plain nodes |
| `apply_ops` | Mixed transaction (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach) |
| `set_tokens` | Design tokens (`$name`) for colors and sizes; with `mode`, the values of a theme mode (e.g. `dark`) that frames and pages pick with `mode` |
| `list_workspaces` / `open_workspace` / `create_workspace` / `import_document` | Lists the workspaces (documents) of the server / makes one active for every tool and the human's canvas / creates an empty one / stores a `.paprika.json` (e.g. from `paprika export --root ID`) as a new workspace without switching the active one |
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
Sizes: a number, `"hug"` (fit content) or `"fill"` (take the parent's space). Details in [docs/architecture.md](architecture.md). Planned work lives in [docs/backlog.md](backlog.md).
