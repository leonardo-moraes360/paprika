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
| `get_document_outline` | Compact tree + tokens + version. The first line is `workspace <id> "<name>"` plus version and node count. A `renderer:` line lists `wasm` or `dom` for each connected tab, in connection order, or `none` when no tab is connected. The last lines are the page content box and the next free spot |
| `get_nodes` / `find_nodes` | Full node JSON / search by type, name, text |
| `path_info` | Validates SVG path data and returns the exact bounds (bezier and arc extremes included), the drawing `origin` (offset from the node origin), and the normalized `d`; with `id` also returns canvas bounds, transform origin and rotated corners |
| `get_bounds` | Absolute boxes after auto-layout (row/column, hug/fill): `x`/`y`/`width`/`height`, transform `origin` (box centre) and the four corners after rotation, clockwise from the unrotated top-left in the same direction as CSS `rotate()`; optional `ids` / `rootId`. With no `ids`, also returns the page content box and the next free spot |
| `create_nodes` | Creates nested trees in one call. Returns `{ids, roots, created, version}`: `ids` is every new id (the old list); `roots` is each new node whose parent was not created in that call (`id`, `name`, `type`, `x`, `y`, `width`, `height`); `created` is every new node (`id`, `name`, `type`, `parentId`). The text is that JSON plus one line per root. On a connector `x`/`y`/`width`/`height`/`d` follow `from`/`to`, so a copied node that carries them gets a warning instead of a refusal; on a path, `normalize: true` moves the drawing to (0,0) and shifts `x`/`y`. `place`: `"free"` (default for a top-level node with no x/y: right of the page content, same top, gap 80, wrap past 2400), `"below"`, `"right"`, `{near, side}` or `"none"` (exact x/y). A new top-level node that overlaps another comes back in `warnings` with the nearest free spot |
| `draw_diagram` | Draws a diagram (flowchart, architecture, mind map) from a list of shapes and edges: lays the shapes out in layers (`direction`: down or right, to the right of existing content) and connects them with arrows that follow the shapes; an edge can carry a `label` and a `route` (`straight`, `elbow`, `rounded`, `curve`) with optional `radius` / `control` |
| `update_nodes` / `move_nodes` / `delete_nodes` | Atomic batch edits. `index` in `update` props or in `move` sets Z-order in the node's parent: a number from 0 (the back) or `front` / `back` / `forward` / `backward`, in the same undo step as the other fields |
| `group_nodes` / `ungroup_nodes` | Wraps sibling nodes in a `group` (the drawing stays put) / puts them back |
| `align_nodes` / `distribute_nodes` | Aligns 2+ siblings to the selection box (`edge`: `left` `center` `right` `top` `middle` `bottom`) / spaces 3+ siblings with equal gaps (`axis`: `horizontal` `vertical`). One undo step each. Rotated nodes use the axis-aligned box. Refuses a row/column parent, connectors and copies inside an instance |
| `wrap_nodes` | Puts siblings in a new frame (transparent, `clip: false`). The drawing stays put. One undo step. Returns `frame` |
| `show_all` / `unlock_all` | Sets `visible: true` on every hidden node / clears `locked`. `pageId` limits the walk to that page; omit it for the whole document. Returns the ids that changed. No history entry when nothing changes |
| `combine_paths` | Boolean combine of 2+ sibling `path` / `rect` / `ellipse` / `shape` nodes into one `path` (`operation`: `union`, `subtract`, `intersect`, `exclude`). Keeps the bottom-most node's style, deletes the sources, one undo step. Returns `path` (the new id). No canvas menu in this tool — agents use MCP / `apply_ops` |
| `convert_to_path` | Turns `rect` or `ellipse` nodes into `path` nodes with the same id. Corner radius is baked into `d`. One undo step restores the originals. The canvas context menu does the same for the topmost rect or ellipse under the pointer |
| `duplicate_nodes` | Copies nodes with their whole subtree in one undo step. With no `offset`, `place` defaults to the right of the source (gap 80) so the copy does not land on it; pass `offset` to nudge x and y, or `place` `"free"` / `"below"` / `"right"` / `{near, side}` / `"none"`. Also `parentId`, `scale` (sizes, text, strokes, spacing and instance `scale`) and `props` written on each copy (`{ "mode": "dark" }` makes the light/dark pair). Instances stay instances of the same component; connectors between duplicated nodes follow the copies. Returns `copies` (one id per source), `map` (every source node to its copy), and `ids` / `roots` / `created` in the same shape as `create_nodes`, plus one text line per root |
| `create_page` | Adds a page; the first one moves the current canvas into "Page 1". `ensure: true` with a name returns the existing page of that name instead of creating a second one |
| `create_component` / `create_instance` / `detach_instance` | Marks a frame as a component (optional `props`: text, boolean, variant) / places a copy (`scale`, `overrides`, `propValues`, `slots`; returns each copy id, including `slot/id` and nested paths) / turns an instance into plain nodes |
| `detach_tokens` | Replaces `$name` on the given nodes with the literal resolved in each node's theme mode. `fields` limits which fields; omit it to detach every token on the node. Instance copies are refused |
| `apply_ops` | Mixed transaction (create, update, delete, move, set_tokens, set_assets, rename_document, group, ungroup, add_page, detach, detach_tokens, combine_paths, align, distribute, wrap, reveal, convert_to_path) |
| `propose_tokens` | Reads CSS variables, a Tailwind theme (JS `theme` or v4 `@theme`) or JSON tokens (flat or DTCG `$value` / `value`) from `content` and returns `set_tokens` operations for the agent to apply. The source is the file text; a filesystem path is refused. CSS names drop the leading `--` (`--color-bg` → `color-bg`; `var(--color-bg)` → `$color-bg`). Tailwind groups are dotted (`colors.brand` → `color.brand`, `borderRadius.md` → `radius.md`). Lengths in px become numbers. A selector or `prefers-color-scheme` that names a mode becomes `mode` on that proposal |
| `set_tokens` | Design tokens (`$name`). Optional `type` (`color`, `length`, `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`) is checked on set and on use; omit it and the token stays an untyped string or number (a number still fits any length field). Optional `collection` names the group. A typed `fontWeight` or `lineHeight` is unitless in CSS variables; other numeric tokens stay px. With `mode`, the values of a theme mode (the override must match the token's type). `export_code` `cssVariables: true` writes `var(--token)` |
| `set_assets` | Document image assets (`$name` → http(s) or `data:image/`). An image `src` of `$name` must match one. `null` removes an asset. Export inlines the URL |
| `list_workspaces` / `open_workspace` / `create_workspace` / `import_document` | Lists the workspaces (documents) of the server / makes one active for every tool and the human's canvas / creates an empty one / stores a `.paprika.json` (e.g. from `paprika export --root ID`) as a new workspace without switching the active one. Archived workspaces are omitted unless `includeArchived` is true; each row has `archived`. `import_document` keeps the file's coordinates (`place` `"none"`); use `import_svg`, `import_html` or `import_image` to place artwork on the current page |
| `rename_workspace` / `archive_workspace` / `unarchive_workspace` / `delete_workspace` | Renames a workspace (undoable when it is the active one) / hides one without deleting it (the active one hands over to the most recently updated other that is not archived; the only one cannot be archived; opening an archived one unarchives it) / puts an archived one back on the list without making it active / deletes one for good, in two calls: without `confirmToken` nothing is deleted and the result is a summary of what would be lost (counts, last edit, cover, which workspace takes over) plus a token that lasts about two minutes and belongs to that workspace; the second call with the token deletes (the active one hands over to the most recently updated other; the only one cannot be deleted) |
| `list_workspace_ops` | The workspace operations log — create, rename, open, archive, unarchive and delete, each with who acted (`user` or the agent's name), when and which workspace; a delete entry keeps the summary, and entries outlive the workspace they name |
| `list_pins` / `claim_pin` / `reply_pin` / `resolve_pin` / `wait_for_pins` | Pins: requests the human leaves on the canvas with the **Point for the AI** tool (`I`), anchored to a node (`nodeId`, plus its box in `region`) or an area (`region` only), with `pageId` and the text. `list_pins` (`status`: `open` (default: open and claimed), `claimed`, `resolved`, `all`; optional `pageId`, `workspaceId`) returns them with `rev`; `claim_pin {id}` shows the agent's name and color on the pin (refused when another agent holds it); `reply_pin {id, text}` appends a message without closing the pin; `resolve_pin {id, reply}` closes it and stores that reply as an agent message on `replies` (the thread; `reply` stays the latest text); `wait_for_pins {timeoutMs ≤ 60000, since}` blocks until an open pin changes after `since`. Every write result that reports a `version` carries `openPins: n` (and one text line) while the workspace has open pins. Pins live in their own SQLite table: not nodes, not exported, not in the undo history. In team mode they sync through the Loro sidecar (pin and reply maps), not as canvas nodes |
| `set_workspace_cover` | Puts an image on a workspace's overview card: a screenshot of one of its frames (`rootId`), an image (`image`, base64 or data URL) or none (`clear`, back to the first letter) |
| `undo` / `redo` / `get_history` | History of one workspace, shared with the human when that workspace is the active one. Optional `workspaceId` undoes, redoes or reads that workspace only, without switching the canvas. Every write tool takes `batch`, so several calls with the same batch become one undo step |
| `lint_design` | WCAG AA contrast, overflow, missing tokens, small text, alt text, `layout-overflow` (row/column children that leave the frame), `hug-was-meant` (a default 100×100 layout frame), geometry (`detached-sibling`, `near-gap` under 4px, `fully-hidden`), `overlapping-boards` and `covered-by-overlay`. `rootIds` scopes the check to those subtrees. `groups` folds each rule to a count and the first `maxIds` ids (default 8), ordered by severity. `minSeverity` and `minFontSize` quiet the list; `lintIgnore` on a node and `scaledMock` on a frame drop intentional findings |
| `render_screenshot` | PNG of a node, a page or the whole canvas. `path` writes it under `<data>/screenshots` (or `PAPRIKA_SCREENSHOTS`; a path outside that directory is refused) and returns `{path, width, height, url}` with `url` `/api/screenshot/<id>`, instead of the image. Without `path` the image is returned as before, plus `url`. `mode` paints a subtree in that theme mode; omitted, the subtree keeps the mode it inherits. A missing or mismatched browser returns `pnpm --filter @paprika/e2e exec playwright install chromium`. Optional `workspaceId` screenshots that workspace without switching the canvas |
| `export_image` | PNG, JPEG, WebP, AVIF or vector PDF of a node/page/canvas **without Chromium**: rasterizes core `ExportSVG` (layout geometry) in pure Go; PDF draws the same path as vectors. Optional `workspaceId` exports that workspace without switching the canvas |
| `import_svg` / `import_html` | Turns pasted SVG (paths, shapes, groups, transforms) or HTML with inline styles into editable nodes; what can't be imported comes back in `warnings`. The result includes `ids`, `roots` and `created` in the same shape as `create_nodes`, plus one text line per root. Roots honor `place` (`"free"` when x and y are omitted). Optional `workspaceId` imports into that workspace without switching the canvas |
| `import_image` | Places a raster image (PNG, JPEG, WebP, AVIF or GIF) as an `image` node sized from the file. `src` is a data URL or a local path under `PAPRIKA_IMPORT_DIRS` (default: the server's working directory). Files over 3500000 bytes are refused. Original bytes are kept, so animated GIF/WebP/AVIF stay animated on the canvas and in HTML exports (`render_screenshot` captures one frame). Returns `ids`, `roots` and `created` in the same shape as `create_nodes`, plus one text line per root. Honors `place` (`"free"` when x and y are omitted). Optional `workspaceId` imports into that workspace without switching the canvas |
| `resize_image` | Resamples an `image` node (or creates one from `src`) to `qhd` 960×540, `hd` 1280×720, `2k` 2560×1440, `4k` 3840×2160, or `{width,height}`. Pure Go (`golang.org/x/image` CatmullRom); no Chromium. `fit`: `contain` (default), `cover`, `fill`. Animated GIF → first frame; animated WebP and AVIF refused. Same format when encodable in pure Go (PNG/JPEG/GIF), else PNG |
| `export_code` | Standalone HTML, a React (TSX) component, vector SVG (boxes from core `layout(doc)`, no headless Chromium), a React component with Tailwind utility classes (`tailwind`), standalone HTML with Tailwind classes (`tailwind-html`), a React component plus its `.module.css` (`css-modules`: two text blocks, the `.tsx` first and the stylesheet second), an Angular standalone component (`angular`: three text blocks — `.ts`, template, `.css`) or a Svelte single-file component (`svelte`); `cssVariables: true` writes tokens as `var(--name)` with one rule per theme mode |

Agent layer:
- The guide, tool descriptions, errors, warnings and lint messages are in English (the guide also in pt-BR, see above).
- Tools that answer JSON declare an `outputSchema` and return `structuredContent`; the text block keeps the same JSON (for `get_nodes` and `get_history`, the plain array). `create_nodes`, `duplicate_nodes` and the import tools also add one readable line per root.
- Document tools take an optional `workspaceId` (outline, nodes, bounds, create/update/delete/move/group, tokens, lint, screenshot, export, imports, undo/redo and the other document writes). Omit it to use the active workspace, which is the human's canvas. Passing it reads or writes that workspace without `open_workspace` and without moving the canvas. The outline's first line and every write result include `workspaceId` and `workspaceName`. Each workspace keeps its own history for the life of the process. An unknown id is an error that lists the workspaces.
- The history names the agent after its MCP `clientInfo.name` (`agent:claude-code`). Over HTTP the server is stateless, so `initialize` hands out an `Mcp-Session-Id` that only carries that name; without it, the User-Agent is used as before.
- The open canvas reports how it paints on the WebSocket: `{type:"hello", renderer:"wasm"|"dom"}`, again when the human toggles the renderer. The server answers with the same hello. `get_document_outline` lists one value per connected tab, or `none` when no tab is connected. Screenshots stay on the HTML path.

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
A text node may set `runs`: up to 200 ranges `{ start, end }` in UTF-16 indexes, sorted and not overlapping (touching is fine). Each run needs at least one of `fontWeight` (100–900 or `$token`), `color`, `fontSize` (number or `$token`), `italic: true`, or `href` (`http(s)`, `mailto`, or a path starting with `/` or `#`). `create_nodes` and `update_nodes` carry `runs`; `null` on update clears them. HTML, React, SVG, PNG and PDF export keep the ranges. A copy inside an instance may override `runs` along with fill, color, text, src, alt, visible and opacity.
`stroke` is `{ color, width, style?, position? }` with `style` `solid`|`dashed`|`dotted` (dash pattern from width; omit = solid) and `position` `inside`|`center`|`outside` (omit = inside for boxes/shapes, center for paths).
`gradient` is optional on `frame`, `rect`, `ellipse`, `text`, `image`, `path`, `shape` and `page`: `{ type: "linear"|"radial"|"conic", angle?, cx?, cy?, radius?, stops }`. `stops` is 2 to 12 `{ color, offset }` with `offset` in 0..1. Omitted `angle` is 180 (CSS: 0 is up, 90 is right), `cx`/`cy` are 0.5 and `radius` is 0.5 (0..2). When `gradient` is set it wins over `fill`. `null` on update removes it. A CSS gradient string in `fill` still passes through and is not a structured gradient.
On `frame`, `rect` and `image`, `radius` is one length or `[tl, tr, br, bl]` (top-left, top-right, bottom-right, bottom-left). Each corner is a number or a `$token`, same as gap and padding. One value keeps the corners linked; the inspector toggles that link. Other nodes keep a single radius.
Sizes: a number, `"hug"` (fit content) or `"fill"` (take the parent's space). A child of a row/column frame can set `layoutPositioning` to `"absolute"` (omit or `"auto"` stays in the flow): it keeps `x`/`y` relative to the parent and is skipped by the flow, the gap and hug sizing. `create_nodes` and `update_nodes` accept the field; `null` on update removes it. A child outside the flow can set `constraints` to `{ horizontal: left|right|center|scale, vertical: top|bottom|center|scale }` (omit = left and top). When the parent frame's numeric width or height changes, those children keep the left/top edge, the right/bottom margin, the center, or scale with the parent. In-flow children ignore the field. `null` on update removes it. Details in [docs/architecture.md](architecture.md). Planned work lives in [docs/backlog.md](backlog.md).
