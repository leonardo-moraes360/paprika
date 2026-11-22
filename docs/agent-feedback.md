🇺🇸 English | [🇧🇷 Português](pt-BR/feedback-agentes.md)

# Agent feedback log

Friction found while AI agents used Paprika through MCP, recorded during real work.
Format: date · task · what the agent needed vs. what happened · proposal · priority.

## 2026-11-21: drawing 5 icon + theme proposals (`examples/brand/draw-brand.mjs`)

Task: an agent drew 5 flat paprika icons with increasing complexity (3 → ~20 shapes), each shown at 240/96/48/24 px next to a palette and a UI sample, using only MCP tools.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 1 | Organic shapes (a pepper silhouette) | Only `rect`/`ellipse` exist; the pepper had to be built from overlapping, rotated ellipses | Add a `path` node (SVG `d`, fill/stroke) and boolean union of children (`path` with bezier curves done on 2026-11-21, see below; boolean union still open) | P1 |
| 2 | Put a stem on the tip of a rotated pod | Rotation pivots on the box center, so the agent had to do trigonometry; the calyx was misplaced twice and only caught by screenshot | `get_bounds` tool returning the rotated geometry (corners, tips), and an `origin` (transform-origin) field | P1 |
| 3 | Same icon at 4 sizes | No components/instances or scale: the script regenerated every shape with a scale factor (4× the nodes, edits don't propagate) | Components + instances with `scale`; `duplicate_nodes` with scale | P1 |
| 4 | 5 themes side by side | Tokens are global, so they had to be namespaced by hand (`p1.brand` … `p5.brand`) and rewritten in every node | Done (2026-11-21, see #45): theme modes (`set_tokens` with `mode`) and `mode` on a frame or page; named collections are still open | — |
| 5 | Check the result visually on the user's machine | `render_screenshot` failed: Playwright 1.63 needs Chromium build 1243, only 1228 was installed | Detect a missing browser at startup, return the exact fix command in the error, and fall back to rendering through an open canvas tab | P1 |
| 6 | Catch visual mistakes without a screenshot | `lint_design` passed while the calyx floated off the pod | Geometry lint: children that don't touch any sibling, near-misses (< 4px gaps), shapes fully hidden behind others | P2 |
| 7 | Read structured results | Tools return JSON as text; the agent has to parse strings | Done (2026-11-21, see #48): `outputSchema` + `structuredContent` on every JSON tool | — |
| 8 | Layout wrappers that don't clip | Every wrapper frame needed `clip: false` and `fill: "transparent"` | A `group` node, or `clip: false` by default when a frame has auto layout | P3 |
| 9 | Quiet lint | 21 `raw-color` infos for intentional literals (white handles, black text on buttons) | Per-node `lintIgnore: ["raw-color"]` and a `minSeverity` parameter | P3 |
| 10 | See who did what | The actor name comes from the HTTP User-Agent (`node`, `brand-agent`), not from the MCP client | Done (2026-11-21, see #48): `agent:<clientInfo.name>`, also over HTTP | — |
| 11 | One undo step for "draw proposal 3" | 7 history entries for one script run (rename, tokens, 5 creates) | Done (2026-11-21, see #48): `batch` on every write tool | — |
| 12 | Agent-facing language | Guide and errors are in Brazilian Portuguese; English prompts mix languages | Done (2026-11-21, see #48): guide, descriptions and errors in English; `get_design_guide {language: "pt-BR"}` | — |
| 13 | Several boards | Everything shares one canvas; proposals had to be stacked by hand with fixed `y` offsets | Pages, plus `layout` on the canvas root (auto-stack top-level frames) | P3 |
| 14 | Watch the agent draw after the server switched files | The open canvas tab reconnected to the new document but kept the old zoom/pan, so the new boards could be off-screen (fixed: the canvas now refits when the document id changes) | Done in this change | — |

## 2026-11-21: bezier curves (`path` node, pen tool, `path_info`)

Task: add bezier curves so agents and humans can draw organic shapes, then redraw the pepper with paths only (`packages/server/scripts/bezier-demo.mjs`, removed with the TypeScript server).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 15 | A node box that matches the drawing | Without `width`/`height` the box runs from the node origin to the far edge of the curve, so a `d` that starts at (40,30) leaves empty space at the top left, and overflow lint measures that box | `normalize: true` on create (move the drawing to 0,0 and shift `x`/`y`), or report the gap in `path_info` | P2 |
| 16 | Layer several paths as one shape (body, shadow, highlight, calyx) | Each part repeats the same `x`/`y`; moving the pepper means moving 5 nodes | `group` node (see #8) or a `paths: []` list on one node | P2 |
| 17 | Edit one control point | Changing a curve means rewriting the whole `d` string | Canvas part done (2026-11-21, see #43); `update_path_points` (move anchor/handle by index) for agents is still open | P3 |
| 18 | Know the drawn size before placing a part | `path_info` with `canvasBounds` answered it in one call; it also caught a typo (`d inválido: número esperado na posição 12`) | Keep: return position-accurate parse errors for every string field | — |

## 2026-11-21: Go server with SQLite (`server-go/`)

Task: reimplement the server in Go with the same contract, storing data in SQLite.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 19 | Know what the server promises to agents | The tool list and instructions only existed as TypeScript code; a second implementation would drift | Done: `server-go/scripts/gen-contract.mjs` dumps `tools/list` and the instructions into `server-go/contract/mcp.json`, and the parity suite checks both servers return the same contract. Since the TypeScript server was removed, `mcp.json` is the contract itself, edited by hand and checked by `packages/e2e` | — |
| 20 | Undo after a restart | With the file server, the history lived in memory and was lost on restart | Done in the Go server: both stacks are committed to SQLite with each change | — |
| 21 | Query the design without loading it all | Agents had to call `get_document`/`query_nodes` | The Go server's `nodes` table can be read with plain SQL (`type`, `name`, `parent_id`); an MCP `sql_query` tool (read-only) could expose it | P3 |
| 22 | Same actor name everywhere | Still taken from the HTTP User-Agent (see #10); kept identical in Go for parity | Switch both servers to `clientInfo.name` together | P3 |

## 2026-11-21: canvas renderer in Rust/WASM (ADR 0002)

Task: prototype the canvas in Rust/WASM (vello on WebGPU, vello_cpu fallback) and benchmark it against the DOM canvas ([ADR 0002](adr/0002-canvas-renderer-rust-wasm.md)). No MCP calls; the friction is about what agents rely on.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 23 | Load an example document outside the server | `examples/bezier.paprika.json` omits defaults (`visible`, `opacity`…); a renderer that read it without `parseDocument` drew nothing in every mode, and only a screenshot showed it | Write examples normalized, or say in AGENTS.md that every reader must go through `parseDocument` | P3 |
| 24 | Check a GPU-rendered canvas from an agent's headless browser | Headless Chromium without a GPU loses the WebGPU device when a canvas is presented (plain JS too), so pixels come back empty | If the canvas ever moves to WebGPU, keep `render_screenshot` on the HTML path, or render offscreen and read pixels back (as `gpu-readback-check.cjs` does) | P2 |
| 25 | Pick the fast path automatically | Headless Chromium offers a *software* WebGPU adapter (SwiftShader) that is 45–220× slower than vello_cpu; a naive "WebGPU if available" picks it | Treat `DeviceType::Cpu` adapters as no GPU (done in the prototype) | — |
| 26 | One geometry source for agents and renderers | The prototype re-derives boxes (and measures a hidden DOM for auto layout) because core exposes no resolved geometry | A core `layout(doc)` returning absolute boxes would serve the renderer, `get_bounds` (#2) and geometry lint (#6) | P2 |

## 2026-11-21: WASM canvas integration (`crates/render`, ADR 0002)

Task: wire the Rust/WASM renderer into the canvas as an opt-in hybrid (WASM draws shapes, DOM keeps text and hit testing). No MCP calls.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 27 | Check the WASM canvas the way an agent checks the DOM | `render_screenshot` renders the HTML export, so it never shows what the WASM layer draws; only a browser screenshot of the live canvas does | Keep screenshots on HTML (deterministic), and rely on the E2E parity test; if agents need it, a `renderer: "wasm"` option on `render_screenshot` that loads the canvas page | P3 |
| 28 | Know which renderer a human is looking at | The choice lives in the browser (localStorage), so an agent cannot tell whether the human sees DOM or WASM output | Report the active renderer and backend over the WebSocket hello, and expose it in `get_document_outline` metadata | P3 |

## 2026-11-21: landing page drawn in Paprika (`apps/site`)

Task: design the project's landing page in Paprika over MCP (desktop and mobile, English and Portuguese, ≈300 nodes) and publish it as a web page built from the document.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 29 | Check a page whose height follows its content | `render_screenshot` of a root frame with `height: "hug"` returned a 1280×1 px image (`rootBounds` turns `hug` into 1 px), so the agent had to check the page in its own browser | Done (2026-11-22): `render_screenshot` measures a `hug`/`fill` root in the browser and sizes the image to it | — |
| 30 | Buttons and nav items that link somewhere | Nodes have no link field; the site build reads a naming convention (`name: "link:<href>"`) and turns those nodes into `<a>` | An `href` field on frames and text, exported as `<a>` by `export_code` and kept by the canvas | P2 |
| 31 | One page for every screen width | Root frames have a fixed width and `export_code` sets the body to that size, so the page was drawn twice (1280 and 390) and the build stretches roots to the viewport | Breakpoint variants of a frame, or `minWidth`/`maxWidth`, and a page export with responsive roots | P2 |
| 32 | Reuse the same image | The icon's data URI is repeated in 8 image nodes (≈200 KB document) | Document-level assets (`$asset` references) or image tokens | P3 |
| 33 | Mark an image as decorative | `lint_design` warns `missing-alt` on `alt: ""`, which is correct HTML for a decorative image | A `decorative: true` flag (or treat an explicit empty `alt` as decorative) | P3 |

## 2026-11-21: multi-select, groups and pages (backlog slice 1)

Task: add `group` and `page` nodes to the core (TS and Go), the MCP tools `group_nodes`, `ungroup_nodes` and `create_page`, and multi-select, marquee and pages in the canvas. Addresses #8, #13 and #16.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 34 | Group or ungroup from a client that may be behind | The canvas first expanded `group`/`ungroup` into primitive ops on its own copy of the document; when an agent wrote in between, ungroup used a stale group position and children jumped | Done: `group`, `ungroup` and `add_page` are real ops, expanded inside `applyOps` against the current document, so every client and agent sends intent, not coordinates | — |
| 35 | Know the size of a group | A group's box is derived from its children at the end of each transaction, so writing `width`/`height` on it is rejected with a message that says why | Keep the rule; `describe_node` already shows the fitted box | — |
| 36 | Put content on a page in one call | Once a document has pages, every top-level node must be a page; the check runs at the end of the transaction, so `create_page` + `create_nodes` with `parentId` works, but a loose top-level node fails with a message naming it | A `pageId` default on `create_nodes` (the page the human is looking at) would save agents a lookup | P3 |

## 2026-11-21: components and instances (backlog slice 1, item 2)

Task: components (`component: true`) and instances (`instanceOf`, `scale`, `overrides`) in the core (TS and Go), the MCP tools `create_component`, `create_instance` and `detach_instance`, and inspector panels for instances and copies. Addresses #3.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 37 | Override a copy without knowing its generated id | Copy ids are derived (instance + source id), so an agent can't guess them | Done: `create_instance` returns `copies` (source id → copy id), and `overrides` can be written on the instance by source id | — |
| 38 | Scale an icon set | The same icon at 4 sizes is now 1 component + 4 instances with `scale`; a token `fontSize` is not scaled | Typed tokens (backlog E) would let `scale` multiply size tokens too | P3 |
| 39 | Put a button instance inside a card component | Instances inside components are rejected for now, so nested design systems need detach or flat components | Nested instances, with overrides addressed by path (`instance/copy`) | P2 |

## 2026-11-21: paste SVG/HTML and export SVG (backlog slice 1, item 3)

Task: `importSVG`, `importHTML` and `exportSVG` in the core (TS and Go), the MCP tools `import_svg` and `import_html`, `export_code` format `svg`, `GET /api/svg`, and paste plus an export button in the canvas.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 40 | Bring an icon from an SVG set | Before, an agent had to translate each `<rect>`/`<circle>`/arc by hand into `d`; `import_svg` now does it in one call and says what it dropped in `warnings` | Support `<use>`/`<symbol>` sprites and `<text>` (as `text` nodes), which icon sets and logos often use | P2 |
| 41 | Export SVG of a node with auto layout without a browser | The core can't place `hug`/`fill`/row/column children by itself, so `exportSVG` without a measure fails with a message that points to `export_code` | A core `layout(doc)` (#26) would let the core export everything and give agents boxes too | P2 |
| 42 | Reuse a component from a live web page | `import_html` reads inline `style=""` only; HTML copied from most sites relies on classes, so the result is plain | An option that renders the HTML in the server's Chromium and imports computed styles | P2 |

## 2026-11-21: point-by-point path editing (backlog slice 1, item 4)

Task: core helpers that turn `d` into anchors with handles and back (`pathToSubpaths`, `moveAnchor`, `moveHandle`, `insertAnchor`, `removeAnchor`, `toggleSmooth`, `pathEditProps`), and a point-editing mode in the canvas.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 43 | Nudge one point of a path an agent drew | The human can now drag it on the canvas; an agent still rewrites `d`, and after a human edit the `d` it reads back has new numbers (quadratics and arcs become cubics, the box is renormalized) | An MCP tool over the same helpers (`edit_path` with anchor index and new position), plus anchors in `path_info`, so agent and human address points the same way | P2 |
| 44 | Edit a path inside an auto-layout frame | The node's position comes from the layout, so when an edit moves the top-left of the drawing the box grows in place and the shape shifts by that amount | Keep, or adopt "ignore layout" children (backlog A) and place edited paths absolutely | P3 |

## 2026-11-21: theme modes and tokens as CSS variables (backlog slice 1, item 5)

Task: `document.modes` and `mode` on frames and pages in the core (TS and Go), `set_tokens` with `mode`, `export_code` with `cssVariables`, a theme section in the inspector, the `unknown-mode` lint rule. Addresses #4.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 45 | Show the same screen light and dark | Before, an agent duplicated the frame and rewrote every color; now it writes the dark values once (`set_tokens` with `mode`) and sets `mode` on a copy | A `duplicate_nodes` tool that takes overrides (`mode` here) would make the side-by-side one call | P2 |
| 46 | Know which value a node really gets | `get_nodes` shows `$fg`; the value depends on the nearest `mode` above. The outline prints `mode=` on frames and the modes with their tokens | A `resolve` flag on `get_nodes` that adds the resolved paint per node | P3 |
| 47 | Use a token only one mode defines | It resolves inside that mode and is an `unknown-token` error elsewhere; in a CSS-variables export it becomes `var(--x)` with no base value | Keep the error; agents should set a base value too | — |

## 2026-11-21: agent layer (backlog slice 1, item 6)

Task: `outputSchema` + `structuredContent` on the JSON tools, `batch` on every write tool (one undo step), the actor from `clientInfo` (stdio and stateless HTTP), and the guide, tool descriptions, errors, warnings and lint messages in English, with the pt-BR guide on request. Addresses #7, #10, #11 and #12.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 48 | Read results without parsing text | `structuredContent` now matches each tool's `outputSchema`; `get_nodes` and `get_history` keep the plain array as text and wrap it (`{ nodes }`, `{ entries }`) in `structuredContent`, because MCP requires an object there | In the next breaking change, make the text the same object | P3 |
| 49 | One undo step for a long script | `batch` merges consecutive writes of the same agent; any human edit or undo in between closes it, and the next call starts a second entry | Show an open batch in the canvas activity list, so the human knows an edit will split it | P3 |
| 50 | Same actor name after a server restart | Over HTTP the name lives in an in-memory map keyed by `Mcp-Session-Id`; after a restart the client keeps its old session id and the actor falls back to the User-Agent until it initializes again | Accept unknown session ids with a 404, as the spec suggests, so clients re-initialize | P3 |
| 51 | One language in the activity list | Default history labels from the tools are now English (`create 1 node(s)`) while the canvas's own labels and UI stay in pt-BR | Translate the canvas UI or localize both by a setting | P3 |

## 2026-11-21: workspace overview

Task: an overview of the workspaces as the home page, with `list_workspaces`, `open_workspace` and `create_workspace` on both servers.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 52 | Work in a second workspace without moving the human | The active workspace is shared on purpose, so `open_workspace` also switches the human's canvas; the guide asks the agent to check with the human first | An optional `workspace` argument on the read tools (outline, nodes, screenshot), so an agent can look at another workspace without switching | P2 |
| 53 | Know that someone else switched the workspace | A later call just sees another document; nothing in the result says the active workspace changed since the agent's last call | Add the active workspace id to `get_document_outline`'s first line and to write results | P2 |
| 54 | Undo after a switch (TypeScript server) | History is in memory, so a workspace opened again starts with an empty undo stack; the Go server restores it from SQLite | Keep one `History` per workspace for the life of the process | P3 |

## 2026-11-21: diagrams (shapes, connectors, `draw_diagram`)

Task: `shape` and `connector` nodes, canvas tools, and `draw_diagram` for agents, with TS/Go parity. Notes from drawing flowcharts through MCP while building it.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 55 | Delete a shape and its arrow in one call | `delete_nodes` with the shape first and then its connector failed: the shape's delete had already taken the connector. Fixed: a connector removed that way earlier in the same transaction is skipped (deleting it twice is still an error) | — | — |
| 56 | Know the ids of the arrows `draw_diagram` made | They default to `<from>-to-<to>` (with `-2`, `-3` for repeats) and come back in `edges`, in input order | — | — |
| 57 | Say what an arrow means ("yes", "no") | Connectors have no label yet; agents put a small text node next to the arrow, which does not follow it | A `label` on connectors, placed at the middle of the route | P1 |
| 58 | Move one shape of a drawn diagram without crossing others | Elbow routes ignore obstacles, so a moved shape can make an arrow cross another shape | Obstacle-aware elbow routing, or a `relayout` mode on `draw_diagram` for existing ids | P2 |

## 2026-11-21: rename and delete workspaces

Task: rename and delete on the overview (double click on the name, delete with a confirmation) and as `rename_workspace` / `delete_workspace` on both servers.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 59 | Keep an agent from deleting work on its own | `delete_workspace` has `destructiveHint` and the guide asks for the human's confirmation, but nothing enforces it; the canvas asks, MCP does not | Two steps: the first call returns what would be lost and a token, the second call with the token deletes | P2 |
| 60 | Undo a rename | Renaming the active workspace is a `rename_document` write (undoable); renaming another one changes it in place, with no undo | A per-server activity log for workspace operations, or a trash that keeps deleted workspaces for a while | P3 |
| 61 | Tell the human why the canvas moved | Deleting the active workspace opens the most recently updated other one for everyone; the canvas follows, with no message | A short notice on the canvas ("workspace X deleted by agent:Y") | P3 |

## 2026-11-21: workspace covers

Task: a cover image on the overview cards (upload, drop, remove; no cover = first letter) and `set_workspace_cover` for agents.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 62 | Give a workspace a cover without leaving it | `set_workspace_cover` with `rootId` screenshots a frame of any workspace, active or not, so an agent can dress up the overview after drawing | — | — |
| 63 | Keep the cover in sync with the design | The cover is a snapshot: later edits to the frame do not update it | An optional `live` cover that re-renders the chosen frame when the workspace changes (debounced) | P3 |
| 64 | Take the cover along in an export | Covers live in SQLite next to the document, not in `.paprika.json`, so `paprika export` drops them | Export/import the cover as a data URL in an optional top-level field | P3 |

## 2026-11-21: P2P team screens (Iroh + CRDT)

Task: draw the team screens (team panel with people, remote agents and connection state; invite with link and QR; join with progress and an expired-invite error; team keys; the top-bar sync states) on a new page "Time P2P" of the "Paprika" workspace, from a script over MCP HTTP (about 900 nodes in 9 `create_nodes` calls).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 65 | Text that fits its content inside auto layout | A `text` created without `width`/`height` is 100×100, so every label in a row/column took a 100 px square and the first draft was unusable; the nodes drawn by hand in the same workspace are all `hug`×`hug`. Cost a full delete and redraw | Done (2026-11-22): a new `text` without `width`/`height` is `hug`×`hug` (with `width` only, `height: "hug"`) | — |
| 66 | Use the id `create_page` returned | `create_page` answers `{page, created}` while `create_nodes` answers `{created}`; the script read `created[0]` the wrong way and passed the whole object as `parentId` | Partly done (2026-11-22): `create_page` keeps `{page, created, version}` (extras first, like `group_nodes`), and its description now says `page` is the new page and `created` also lists "Página 1" the first time | — |
| 67 | Know what `delete_nodes` removed | It answers `{"created": []}` | Done (2026-11-22): `delete_nodes` answers `{deleted, version}` with every id removed (subtrees and attached connectors) | — |
| 68 | A frame without layout that hugs its text | A `frame` with `height: "hug"` and no `layout` (mode none) collapses to 0, so the text inside it vanishes; table cells were empty with no warning | Done (2026-11-22): `lint_design` warns `hug-without-layout` on a frame without layout that has children and a `hug` side | — |
| 69 | See the problems that matter in `lint_design` | 140 issues on the page, mostly one warning per 11 px label, with the few real overflows mixed in | Group by rule with counts and up to N node ids per rule; an option to raise `small-text`'s threshold or drop a rule | P2 |
| 70 | Catch a row wider than its frame before the screenshot | Three 400 px cards plus gaps overflowed a 1320 px board; only the screenshot showed it | `lint_design` overflow for row/column children whose sum exceeds the frame (it exists for text, not for layouts) | P2 |

Simpler for the next agent:

1. Text defaults to `hug`×`hug` (#65): the single change that would have saved a redraw.
2. One result shape for create/delete tools (#66, #67).
3. Lint that groups and points at layout overflow (#68–#70).

- Nested `create_nodes` built a whole proposal (≈60 nodes) in one call, atomically.
- `lint_design` contrast checks drove the token choices (`brand.dark` for white text on buttons).
- `get_document_outline` with `depth: 0` was enough to confirm the result cheaply.
- `lint_design` caught every literal color in the landing page (`raw-color`), which led to an `on.brand` token.
- One style engine: the screenshots the agent checked come from the same `nodeStyle` the canvas uses.

## 2026-11-22: accessibility round (contrast proposal)

Task: draw a before/after board of the contrast fixes (white text on the accent, agent tag colors) over MCP HTTP, from a cloud session, and screenshot it for the user's decision.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 71 | A screenshot of a board that hugs its content | `render_screenshot` of a root `frame` with `width`/`height: "hug"` returned a 2×2 PNG, with no error or warning; the canvas showed the board at full size (it measures in the browser), the screenshot uses the stored size. The workaround was to measure the board in the canvas and set a fixed width and height | Measure `hug` roots in headless Chromium before the screenshot (the SVG export already measures), or answer with an error that says the root has no size | P1 |
| 72 | Draw in the user's own Paprika from a cloud session | The design-first rule points at `127.0.0.1:4777` on the user's machine; a cloud session cannot reach it, so the board lives in a throwaway server in the container and only its PNG reaches the user | `paprika export --root <id>` of a single frame plus an `import_nodes` tool, or let the team sync carry a shared "proposals" workspace | P2 |

- Nested `create_nodes` built the whole board (≈100 nodes) in one call; with `width`/`height: "hug"` on every text there was no 100×100 text problem this time (#65 still holds for the default).
