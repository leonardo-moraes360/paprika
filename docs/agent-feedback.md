🇺🇸 English | [🇧🇷 Português](pt-BR/feedback-agentes.md)

# Agent feedback log

Friction found while AI agents used Paprika through MCP, recorded during real work.
Format: date · task · what the agent needed vs. what happened · proposal · priority.

## 2026-11-21: drawing 5 icon + theme proposals (`examples/brand/draw-brand.mjs`)

Task: an agent drew 5 flat paprika icons with increasing complexity (3 → ~20 shapes), each shown at 240/96/48/24 px next to a palette and a UI sample, using only MCP tools.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 1 | Organic shapes (a pepper silhouette) | Only `rect`/`ellipse` exist; the pepper had to be built from overlapping, rotated ellipses | Add a `path` node (SVG `d`, fill/stroke) and boolean union of children (`path` with bezier curves done on 2026-11-21; MCP `combine_paths` / core boolean ops done in PAP-A-003 — canvas command still open) | P1 |
| 2 | Put a stem on the tip of a rotated pod | Rotation pivots on the box center, so the agent had to do trigonometry; the calyx was misplaced twice and only caught by screenshot | Done (2026-11-22, PAP-A-001): `get_bounds` returns origin + rotated corners; `path_info` adds origin / transformOrigin | — |
| 3 | Same icon at 4 sizes | No components/instances or scale: the script regenerated every shape with a scale factor (4× the nodes, edits don't propagate) | Components + instances with `scale`; `duplicate_nodes` with scale | P1 |
| 4 | 5 themes side by side | Tokens are global, so they had to be namespaced by hand (`p1.brand` … `p5.brand`) and rewritten in every node | Done (2026-11-21, see #45): theme modes (`set_tokens` with `mode`) and `mode` on a frame or page; named collections are still open | — |
| 5 | Check the result visually on the user's machine | `render_screenshot` failed: Playwright 1.63 needs Chromium build 1243, only 1228 was installed | Done (2026-11-22, PAP-B-062): a missing or mismatched browser is reported at startup and when a screenshot fails, with `pnpm --filter @paprika/e2e exec playwright install chromium` | — |
| 6 | Catch visual mistakes without a screenshot | `lint_design` passed while the calyx floated off the pod | Done (2026-11-22, PAP-B-066): `detached-sibling`, `near-gap` (under 4px) and `fully-hidden` | — |
| 7 | Read structured results | Tools return JSON as text; the agent has to parse strings | Done (2026-11-21, see #48): `outputSchema` + `structuredContent` on every JSON tool | — |
| 8 | Layout wrappers that don't clip | Every wrapper frame needed `clip: false` and `fill: "transparent"` | A `group` node, or `clip: false` by default when a frame has auto layout | P3 |
| 9 | Quiet lint | 21 `raw-color` infos for intentional literals (white handles, black text on buttons) | Done (2026-11-22, PAP-B-066): per-node `lintIgnore` and `minSeverity` on `lint_design` | — |
| 10 | See who did what | The actor name comes from the HTTP User-Agent (`node`, `brand-agent`), not from the MCP client | Done (2026-11-21, see #48): `agent:<clientInfo.name>`, also over HTTP | — |
| 11 | One undo step for "draw proposal 3" | 7 history entries for one script run (rename, tokens, 5 creates) | Done (2026-11-21, see #48): `batch` on every write tool | — |
| 12 | Agent-facing language | Guide and errors are in Brazilian Portuguese; English prompts mix languages | Done (2026-11-21, see #48): guide, descriptions and errors in English; `get_design_guide {language: "pt-BR"}` | — |
| 13 | Several boards | Everything shares one canvas; proposals had to be stacked by hand with fixed `y` offsets | Done (2026-11-22, PAP-B-061): pages already shipped; a new top-level frame with no x/y lands in free space (`place: "free"`) | — |
| 14 | Watch the agent draw after the server switched files | The open canvas tab reconnected to the new document but kept the old zoom/pan, so the new boards could be off-screen (fixed: the canvas now refits when the document id changes) | Done in this change | — |

## 2026-11-21: bezier curves (`path` node, pen tool, `path_info`)

Task: add bezier curves so agents and humans can draw organic shapes, then redraw the pepper with paths only (`packages/server/scripts/bezier-demo.mjs`, removed with the TypeScript server).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 15 | A node box that matches the drawing | Without `width`/`height` the box runs from the node origin to the far edge of the curve, so a `d` that starts at (40,30) leaves empty space at the top left, and overflow lint measures that box | Done (2026-11-22, PAP-A-001): `normalize: true` on create_nodes / create; `path_info.origin` reports the gap | — |
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
| 26 | One geometry source for agents and renderers | The prototype re-derives boxes (and measures a hidden DOM for auto layout) because core exposes no resolved geometry | Done (2026-11-22, PAP-A-001): core `layout(doc)` (+ Go port / goldens); MCP `get_bounds` | — |

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
| 30 | Buttons and nav items that link somewhere | Nodes have no link field; the site build reads a naming convention (`name: "link:<href>"`) and turns those nodes into `<a>` | Done (2026-11-23, PAP-B-087): optional `href` on frames and text, exported as `<a>` | — |
| 31 | One page for every screen width | Root frames have a fixed width and `export_code` sets the body to that size, so the page was drawn twice (1280 and 390) and the build stretches roots to the viewport | Done (2026-11-23, PAP-B-087): `minWidth`/`maxWidth` on a root frame; export uses width 100% between those bounds | — |
| 32 | Reuse the same image | The icon's data URI is repeated in 8 image nodes (≈200 KB document) | Done (2026-11-23, PAP-B-087): document assets via `set_assets` and image `src` `$name` | — |
| 33 | Mark an image as decorative | `lint_design` warns `missing-alt` on `alt: ""`, which is correct HTML for a decorative image | Done (2026-11-23, PAP-B-087): `decorative: true` skips the missing-alt lint and exports `alt=""` | — |

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
| 39 | Put a button instance inside a card component | Instances inside components were rejected, so nested design systems needed detach or flat components | Done (2026-11-23, PAP-B-086): nested instances, overrides addressed by path (`instance/copy`), plus component props and slots | — |

## 2026-11-21: paste SVG/HTML and export SVG (backlog slice 1, item 3)

Task: `importSVG`, `importHTML` and `exportSVG` in the core (TS and Go), the MCP tools `import_svg` and `import_html`, `export_code` format `svg`, `GET /api/svg`, and paste plus an export button in the canvas.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 40 | Bring an icon from an SVG set | Before, an agent had to translate each `<rect>`/`<circle>`/arc by hand into `d`; `import_svg` now does it in one call and says what it dropped in `warnings` | Support `<use>`/`<symbol>` sprites and `<text>` (as `text` nodes), which icon sets and logos often use | P2 |
| 41 | Export SVG of a node with auto layout without a browser | The core can't place `hug`/`fill`/row/column children by itself, so `exportSVG` without a measure fails with a message that points to `export_code` | Done (2026-11-22, PAP-A-002): `exportSVG` / `export_code` svg / `GET /api/svg` use `layout(doc)` boxes; text splits on `\n`; gradients and background images stay out | — |
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
| 52 | Work in a second workspace without moving the human | The active workspace is shared on purpose, so `open_workspace` also switches the human's canvas; the guide asks the agent to check with the human first | Done (2026-11-22, PAP-B-063): optional `workspaceId` on document tools, read and write, without switching the canvas | — |
| 53 | Know that someone else switched the workspace | A later call just sees another document; nothing in the result says the active workspace changed since the agent's last call | Done (2026-11-22, PAP-B-063): the outline's first line and every write result carry the workspace id and name | — |
| 54 | Undo after a switch (TypeScript server) | History is in memory, so a workspace opened again starts with an empty undo stack; the Go server restores it from SQLite | Done (2026-11-22, PAP-B-063): one history per workspace for the life of the process, including undo of a workspace that is not the active one | — |

## 2026-11-21: diagrams (shapes, connectors, `draw_diagram`)

Task: `shape` and `connector` nodes, canvas tools, and `draw_diagram` for agents, with TS/Go parity. Notes from drawing flowcharts through MCP while building it.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 55 | Delete a shape and its arrow in one call | `delete_nodes` with the shape first and then its connector failed: the shape's delete had already taken the connector. Fixed: a connector removed that way earlier in the same transaction is skipped (deleting it twice is still an error) | — | — |
| 56 | Know the ids of the arrows `draw_diagram` made | They default to `<from>-to-<to>` (with `-2`, `-3` for repeats) and come back in `edges`, in input order | — | — |
| 57 | Say what an arrow means ("yes", "no") | Connectors have no label yet; agents put a small text node next to the arrow, which does not follow it | Done (2026-11-22): `label` on connectors and on `draw_diagram` edges, drawn halfway along the route in the stroke color with a halo of the background | — |
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
| 69 | See the problems that matter in `lint_design` | 140 issues on the page, mostly one warning per 11 px label, with the few real overflows mixed in | Done (2026-11-22, PAP-B-066): `groups` (count + first `maxIds` ids per rule, ordered by severity), `minFontSize`, `minSeverity` | — |
| 70 | Catch a row wider than its frame before the screenshot | Three 400 px cards plus gaps overflowed a 1320 px board; only the screenshot showed it | Done (2026-11-22, PAP-B-066): `layout-overflow` when row/column children leave the frame | — |

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
| 71 | A screenshot of a board that hugs its content | `render_screenshot` of a root `frame` with `width`/`height: "hug"` returned a 2×2 PNG, with no error or warning; the canvas showed the board at full size (it measures in the browser), the screenshot uses the stored size. The workaround was to measure the board in the canvas and set a fixed width and height | Done (2026-11-22): `hug`/`fill` roots are measured in headless Chromium before the screenshot (same change as #29) | — |
| 72 | Draw in the user's own Paprika from a cloud session | The design-first rule points at `127.0.0.1:4777` on the user's machine; a cloud session cannot reach it, so the board lives in a throwaway server in the container and only its PNG reaches the user | `paprika export --root <id>` of a single frame plus an `import_nodes` tool, or let the team sync carry a shared "proposals" workspace | P2 |

- Nested `create_nodes` built the whole board (≈100 nodes) in one call; with `width`/`height: "hug"` on every text there was no 100×100 text problem this time (#65 still holds for the default).

## 2026-11-22: second backlog batch (arrow labels, team removal and key rotation)

Task: draw the arrow-label and team screens over MCP before building them (design-first), first in a server in the cloud container, then in the user's own Paprika.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 73 | Put a label in the middle of an arrow (before `label` existed) | Had to read the connector's derived `d`, find the middle of the first subpath by hand and place a `text` there; it drifts when the arrow moves | Done (2026-11-22): `label` on `connector` and on `draw_diagram` edges, drawn at the middle with a halo | — |
| 74 | Tell a diagram's history label from an edge label | `draw_diagram` already takes a top-level `label` (the history entry); edges now take `label` too, so the same word means two things in one call | Rename the top-level one to `historyLabel` in a future contract version (keep `label` as an alias), or say it in both descriptions | P3 |
| 75 | Copy a board into the user's own Paprika | Same as #72: the cloud session drew in its own server; to put it in the user's Paprika it exported the workspace, turned it into nested `create_nodes` (dropping the derived `x/y/width/height/d` of connectors, which `create_nodes` refuses) and ran that script on the user's machine through Remote Control. `create_workspace` + `open_workspace` also switched the active workspace of the user's server, and putting the previous one back by id missed once (the active one changed under it) | An `import_document` MCP tool (a `.paprika.json` in, a new workspace out, without switching the active one), and `create_nodes` ignoring derived connector fields instead of refusing them | P1 |

- #69 and #70 came back on the team panel: `lint_design` flagged the app's own 11 px labels (22 warnings) and missed a "Remover" button that overflowed its row.
- #71 is fixed by the same change as #29 (hug roots are measured in the browser before the screenshot).

## 2026-11-22: flat bell pepper illustration (bezier paths)

Task: draw a flat red bell pepper (three lobes, thin white curved gaps, olive stem) on a new page "Pimentão" of the "Paprika" workspace, first from a text description and then from the user's picture, with `path` nodes sharing one 400×400 `viewBox`, and save the PNGs to `design/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 76 | Cut thin gaps out of a shape | No boolean ops or masks, so the gaps are white strokes painted over the red body; that only reads right on a light background and the export has no real holes | `combine_paths` (`subtract`/`union`/…) in MCP/`apply_ops` done (PAP-A-003); canvas command and optional `mask` on `group` / stroke `knockout` still open | P2 |
| 77 | Restyle a node and keep it on top | Turning two filled lobes into gap strokes left them under the body; needed a separate `move_nodes` (no `index` = end) to fix the z-order | Accept `index` (or `"front"`/`"back"`) in `update_nodes` props | P3 |
| 78 | Trace a reference image | The user's picture reached the agent only as an image; there was no easy way to place it under the drawing, so every bezier point was estimated by eye and mapped with a hand-computed scale, which took three screenshot rounds | A `reference` option on `create_nodes`/`import_svg` (or an `image` node from a local file path) placed locked at 50% opacity, plus `render_screenshot` with a `compare` image shown side by side | P2 |
| 79 | Save the screenshot as a file | `render_screenshot` only returns the image to the agent; writing the PNG to the repo meant copying the client's cached blob | Done (2026-11-22, PAP-B-062): optional `path` under the screenshot directory, and `url` `/api/screenshot/<id>` | — |

- One shared `viewBox` on every path made iteration trivial: each layer is in the same 400×400 coordinates, so redrawing the silhouette was a single `update_nodes`.
- `render_screenshot` with `scale: 2` was enough to judge curve quality.

## 2026-11-22: shadcn component sheet on the Interfaces page (PAP-B-030, design first)

Task: draw, over MCP, the sheet of every shadcn primitive with its states (hover, focus, disabled, open) in light and dark on the `Interfaces` page of the Paprika workspace, before installing any dependency; then implement the primitives in `apps/web`. Five root frames, ~570 nodes, five `create_nodes` calls.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 80 | A screenshot of a subtree that keeps its theme mode | `render_screenshot { rootId: <frame inside a frame with mode: "light"> }` painted the subtree with the base (dark) tokens: the mode of an ancestor does not travel to a subtree capture. Two close-ups I compared side by side were not comparable, and the workaround (capture the whole root frame, crop locally) costs bytes and time | Done (2026-11-22, PAP-B-062): a subtree keeps the theme mode it inherits, and `mode` on `render_screenshot` overrides it | — |
| 81 | Knowing that a nested layout frame took the default box | A frame with no `width`/`height` gets 100×100, and the children laid out inside it then disappear from the render: the first sheet came out showing one button, with no error and no warning, and `lint_design` stayed silent. The guide documents `hug`/`fill` but not that default | Done (2026-11-22, PAP-B-066): `hug-was-meant` on a 100×100 layout frame whose children leave the box | — |
| 82 | Small text on a component sheet | `lint_design` returned 31 `small-text` warnings for the 10 and 11 px captions of a sheet that mirrors the app, whose own type scale (ADR 0003) is `text-2xs` 10px and `text-xs` 11px — the same ground #69 and #70 were filed on | Done (2026-11-22, PAP-B-066): `minFontSize` on `lint_design` (and `scaledMock` on a frame) | — |
| 83 | Tokens in every style field | `radius: "$radius.md"` was refused ("expected number, received string") while `fill` and `color` take `$token`. Every radius in the sheet ended up a literal, so the sheet's radii cannot follow a token change the way its colors do | Done (2026-11-22, PAP-B-065): a length field accepts a numeric token (`$radius.*`, `$space.*`, `$text.*` or any other); a color token there is refused; changing the token re-lays out every frame that uses it | — |
| 84 | The same result shape from the read tools | `get_nodes` answers JSON (`{"nodes": […]}`) and `find_nodes` answers text lines (`frame#id "name" …`); a script that walks a tree by name has to handle two shapes, and the first pass failed exactly there | Keep the text rendering (it reads well in a chat) and accept `format: "json"`, or return `structuredContent` from every tool, as the guide already promises for the JSON ones | P3 |

- Theme modes did exactly what this sheet needed: `set_tokens {mode: "light"}` plus `mode: "light"` on the frame gave one drawing in two themes, and the light values are now the values `apps/web/src/styles.css` ships in `.ui-light` — the board and the code were decided once, not twice.
- `lint_design` after the fix reports 0 errors on all five frames; the one `contrast` error it did catch (a 4.24:1 link on a light surface) was a real mistake in the palette, and it is now a different token in the code.
- Redrawing was cheaper than patching: `delete_nodes` on the five roots plus a fresh `create_nodes`, all in one `batch`, undone by a single `undo`.

## 2026-11-22: team panel and agent roster, before and after (PAP-B-034, design first)

Task: draw the team panel and the agent roster as they are today and as they become on the primitives, in both
theme scopes, then migrate `apps/web/src/Team.tsx` and the roster in `apps/web/src/AgentCursors.tsx`. Five root
frames on the `Interfaces` page, ~560 nodes, then the real app in `--team` mode captured for the record.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 85 | The app's own screenshot inside the design document, as the "before" reference | Image nodes do not size the way the box says: the same 280×856 PNG painted correctly into a 190×581 `fit: "contain"` box in one frame and as a ~60×12 sliver in another where the box equalled the source; a 1440×900 source in a 560×350 box painted nothing at all. `lint_design` stayed clean and no error came back, so I only found it by looking at `render_screenshot`. The captures ended up committed next to the board instead of inside it | Document what `width`/`height` do for an `image` node (scale, crop, or neither), and make a source larger than its box either scale down or report it | P2 |
| 86 | A board whose token names are the code's token names | The sheet's tokens are `ui.card` and `ui.mutedFg` (dots, abbreviations), while `apps/web/src/styles.css` ships `--color-ui-card` and `--color-ui-muted-foreground`. Nothing links the two, so "compare the board with the code" is a human step and I typed the same values in both places | Let a token carry an alias or `source` (e.g. `ui.card` → `--color-ui-card`), or let `set_tokens` read the names from a CSS file | P3 |
| 87 | A document token for the red the app actually paints | `--color-accent-strong: #c8401f` is in the CSS, but the brand tokens in the document are `$accent` (#e04a2b) and `$accent.dark`. Every primary button on the sheet is a literal, and `lint_design` returns `raw-color` infos on them | Add `$accent.strong` (and its ink) to the document's brand tokens so board and CSS call the same color by the same name | P3 |

- One builder, two modes: the same panel function drew `antes` and `depois` and then the light frame, so the three sheets are the same geometry and only the token pairs and the control sizes differ. That made the comparison readable.
- `lint_design` on the five frames: 0 errors, the same `small-text` warnings as the PAP-B-030 sheet (the panel's own 11 and 12 px type), plus the `raw-color` infos of item 87.
- The frame heights had to be fixed by hand again (item 81 still stands): a `hug` column inside a `hug` row clipped the second panel until the outer frame got an explicit height.

## 2026-11-22: four-corner resize handles (PAP-B-029, design first)

Task: draw before/after selection handles and an NW-drag demo on the `Interfaces` page, then add NW/NE/SW/SE handles in `apps/web/src/Canvas.tsx`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 88 | Token lengths in create_nodes without a second pass | `radius: "$radius.md"` and `fontSize: "$text.2xs"` were refused (`expected number`); the measure label started at 10px/`$select` on `$canvas` and failed contrast until a follow-up `update_nodes` | Done (2026-11-22, PAP-B-065): same as #83; `radius` and `fontSize` take `$token` on create | — |

- Three root frames, one `create_nodes` call; `lint_design` 0 after fixing measure/note sizes; screenshots in `docs/assets/boards/PAP-B-029`.

## 2026-11-22: numeric inspector fields (PAP-B-027, design first)

Task: draw the Opacidade field states (normal, focused, invalid with message) in light and dark on the `Interfaces` page of the Paprika workspace before fixing `Field`/`setNum`; six fixed-height root frames, one `create_nodes` call, then screenshots under `docs/assets/boards/PAP-B-027/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 89 | `layout.padding` as `[0, 8]` (two values) | `create_nodes` answered `layout.padding: Invalid input`; only a scalar or a 4-tuple is accepted. Had to switch every padding to a single number | Done (2026-11-22, PAP-B-065): the guide states padding is one number or `[top, right, bottom, left]`, not two values. Each value may be a length token | — |
| 90 | `radius: "$radius.md"` on a sheet that already uses `$ui.*` fills | Same refusal as #83 (`expected number, received string`); the board used literal `6` / `8` again | Done (2026-11-22, PAP-B-065): same as #83 | — |
| 91 | Know which ids in `created` are the roots | `create_nodes` returns a flat DFS list of every nested id; the six board roots were not the first six entries, so the first screenshot pass hit titles and labels | Done (2026-11-22, PAP-B-064): `create_nodes`, `duplicate_nodes` and imports return `{ids, roots, created}` (`roots` names each top-level node and its box; `created` is `{id, name, type, parentId}`; `ids` keeps the old list) and one readable line per root | — |

- Fixed heights on the six roots avoided the hug screenshot pitfall called out in the ticket; `render_screenshot` with `scale: 2` was enough to judge focus ring and invalid message.
- `find_nodes {name: "PAP-B-027 field", type: "frame"}` was the reliable way to map board name → id after the flat `created` list.

## 2026-11-22: danger button and confirmation dialog (PAP-B-026, design first)

Task: draw the danger button (states, light and dark) and the confirmation dialogs (workspace delete with the typed name, empty and filled; remove member) on the `Interfaces` page, then add the dialog and the danger tokens in `apps/web`. Eight fixed-height root frames, ~190 nodes, one `create_nodes` call. The active workspace on the maintainer's server was not `Paprika`, so the board was drawn on a throwaway `paprika serve` (renamed `Paprika`) and the PNGs went to the PR.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 92 | Drawing in a workspace that is not the active one | The ticket says to draw in `Paprika` without calling `open_workspace`, but every tool works on the active workspace, so the only options were to ask the human to switch or to run a second server | Done (2026-11-22, PAP-B-063): optional `workspaceId` on the document tools (read and write), so an agent can draw in a named workspace without moving the human's canvas | — |
| 93 | A `fontFamily` that the renderer does not have | `fontFamily: "Inter"` rendered in a serif in `render_screenshot` (the app falls back to the system sans in its CSS stack), so the first sheet did not look like the app until the family became `sans-serif` | Fall back to the generic sans-serif when the family is missing, or accept a stack (`"Inter, sans-serif"`) in `fontFamily` | P3 |
| 94 | A `mode: "dark"` frame on a document whose base tokens are the dark ones | `lint_design` answered `unknown-mode` for `dark` until the same tokens were also written with `set_tokens {mode: "dark"}`, which is a duplicate of the base values | Treat a mode with no tokens as the base without a warning when the document defines only one other mode, or let `set_tokens` alias a mode to the base | P3 |

- `lint_design` on the eight frames: 0 errors; the `small-text` warnings are the app's own 11 px type (item 82).
- A focus ring drawn as a wrapper frame with `layout` and no `mode` collapsed to a dot (`hug-without-layout`); the lint named it, and `layout: {mode: "row", padding: 2}` fixed it.
- Contrast was computed before drawing, so the red landed once: white on `#cc2f50` is 5.13:1 and the ink `#ff9fb2` is 7.01:1 on `#272d45`.
## 2026-11-22: two-step delete and the operations log (PAP-B-015, server)

Task: `delete_workspace` in two calls (summary + short-lived token) and a readable log of workspace
operations. No design sheet: the change is server-side; the UI half (the canvas notice) is PAP-B-026.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 95 | One place for the agent guide | The guide lives twice — `instructions` in `server-go/contract/mcp.json` (en) and `server-go/contract/guide.pt-BR.md` — and a sentence about a tool has to be edited in both by hand. Nothing checks that the two agree, so a tool can be described in one language and not the other | A test that every tool name in the contract appears in both guide texts (the same way `TestToolsMatchContract` pins tool names to the handlers) would catch it; the sentence for `delete_workspace` was edited twice here on purpose | P2 |
| 96 | Contract and handler stay in step | Adding `list_workspace_ops` failed only `TestToolsMatchContract` at first, which is the right forcing function; but the tool-name list in `packages/e2e/test/api.test.ts` is a third copy that fails separately, with a diff that does not say which side moved | Keep both checks, and print in the api failure whether the server, the contract or the test list is the one that changed | P3 |

- The store's `mu` is not reentrant, and `DeleteWorkspace` already calls `OpenWorkspace`: the successor's `open` entry is logged before the `delete` entry, so reading the log newest-first gives the delete first and the takeover below it. Worth knowing for whoever writes the notice that is still missing.
- The design document at `127.0.0.1:4777` disappeared once that endpoint moved to the compose stack with a fresh volume: the `Interfaces` page with the PAP-B-030 and PAP-B-034 sheets is gone, and only the PNGs committed under `docs/assets/boards/` survived. PAP-B-026's sheet was redrawn on a local server. Whatever lands of the "keep the boards in the repository" proposal, a server reset should not cost a redraw.
## 2026-11-22: destructive language and the confirmation pattern (PAP-B-026, design first)

Task: draw the danger button (before and after, both theme scopes) and the confirmation pattern before
changing any code, then apply them in `apps/web`. Five root frames, ~330 nodes, plus the real overview
captured before and after.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 97 | The design boards to survive a server change | `127.0.0.1:4777` went from the host-run server to the compose stack with a fresh volume: the `Paprika` document that holds the `Interfaces` page — the PAP-B-030 sheet, the PAP-B-034 sheet, and the PAP-B-026 frames I had drawn minutes earlier — was no longer listed by `list_workspaces`. Only the PNGs committed under `docs/assets/boards/` survived, and the sheet had to be drawn a second time from the script on a `paprika serve` I started myself | Export the board document into the repository (`design/boards.paprika.json`, the way `design/landing.paprika.json` carries the landing page) and refresh it as sheets land; a server reset would then cost a reload, not a redraw | P1 |
| 98 | A contrast check that does not lie | The first hover measurement returned the resting color because `transition-colors` had not landed, so the assertion passed without ever testing the hover state; a manual probe with a 300 ms wait showed the hover wash was darker and the light text had fallen to 4,39:1 | Nothing for the tool to change. Recorded because it is easy to repeat: wait for the transition, then read, and assert both states — which the suite now does | P3 |

- `lint_design` reported the light destructive text at 4,05:1 on the first sheet, before a line of code was written — the same class of mistake it caught on the PAP-B-030 sheet, and the token alphas are what they are now because of it.

## 2026-11-22: double-click an arrow to edit its label (PAP-B-028, design first)

Task: draw the arrow label in three states (no label, editing with caret and halo, with label), light and
dark, before the inline editor on the canvas. Six root frames, ~40 nodes.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 99 | A text field state with a dashed focus outline | The editor draws a dashed `select` outline, but `stroke` on rect and frame has only `color` and `width`, so the sheet shows it solid; the caret is a 1.5 px rect on top of a text node | A `dash` field on `stroke` for rect, ellipse and frame (connectors already have `dashed`) would let a sheet match what `nodeStyle` paints | P3 |
| 100 | Exporting the board document from a containerised server | `paprika export --db <db>` needs the database file, which lives in the compose volume; the doc is reachable only through `GET /api/export` | Mention `curl http://127.0.0.1:4777/api/export` in `docs/design-boards.md` next to the CLI form | P3 |
## 2026-11-22: renaming the only page (PAP-B-020, design first)

Task: draw the pages panel before, while and after renaming the placeholder "Página 1" of a workspace with no
pages, then wire the rename in `apps/web`. Six root frames (three states, light and dark), ~60 nodes.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 99 | A page to draw on in an empty document | The active workspace had no nodes, so the `Interfaces` page did not exist and `create_page` had to be the first call; the board document in the repository (`docs/design/boards.paprika.json`) holds a different page, so nothing to import without `--replace` wiping the sheets other tickets draw in parallel | Done (2026-11-22, PAP-B-064): `create_page` with `ensure: true` returns the existing page of that name instead of creating a second one | — |
| 100 | A screenshot as a file | `render_screenshot` returns the PNG only as base64 inside the JSON-RPC result, so saving it under `docs/assets/boards/` takes a decoding script on every ticket | Done (2026-11-22, PAP-B-062): optional `path` inside the screenshot directory writes the file and returns its location | — |

- `lint_design` flagged the 11 px caption (`small-text`) on all six frames; 12 px fixed it, so captions stay at the app's smallest legible size.
- Mode `light` on the frame plus the same `pg.*` tokens overridden under `set_tokens {mode: "light"}` rendered both themes from one set of nodes with no per-frame color edits.

## 2026-11-22: canvas notice when an agent deletes or switches a workspace (PAP-B-037, design first)

Task: draw the non-blocking notice (delete with counts, open, rename; light and dark) before wiring
`WorkspaceNotice` and the `workspaceOp` WebSocket broadcast. Six root frames.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 101 | Hearing workspace ops on the canvas without polling HTTP | `list_workspace_ops` exists, but the live canvas only saw document patches; a delete of the active workspace left the human on a dead editor until a refresh | Broadcast each new op log entry as `{type:workspaceOp, op}` over the existing WebSocket hub (poll the log; skip entries that predate the subscriber) | P2 |

- Fixed-height roots; PNGs under `docs/assets/boards/PAP-B-037/`.
- Notice uses `role=status` and never steals focus; overview mount shows delete notices after the canvas route is gone.

## 2026-11-22: side panels collapse into a floating button (PAP-B-024, design first)

Task: draw the collapsed panels (left only, both) next to the expanded layout, light and dark, and check that
the floating buttons clear the toolbar and the agent roster, before writing the UI. Six root frames on
`Interfaces`, drawn from one script in a single `create_nodes` call.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 101 | Screenshots as files | `render_screenshot` only returns base64 inside the JSON result, so each PNG had to be decoded by hand in a script before it could land in `docs/assets/boards/` | Done (2026-11-22, PAP-B-062): optional `path` writes the PNG under the screenshot directory and returns its location | — |
| 102 | A mock at a smaller scale lints as tiny text | The boards are the real layout at two thirds of its size, so every label is 8–9px and `lint_design` returns a `small-text` warning per label, which buries the findings that matter | Done (2026-11-22, PAP-B-066): `scaledMock` on a frame, or `minFontSize` on `lint_design` | — |
| 103 | Free space for a new frame | Nothing says where the next top-level frame can go without overlapping a parallel ticket's: the outline had to be scanned for coordinates and the boards went to `x=2000` by hand | Done (2026-11-22, PAP-B-061): `get_document_outline` and `get_bounds` (no ids) return the page content box and the next free spot; `create_nodes` defaults to `place: "free"` when x and y are omitted | — |
| 104 | Icons by name | The floating buttons use `PanelLeftOpen` and `PanelRightOpen` from lucide, and the board had to carry their path data typed in by hand, which is how an icon on the sheet can drift from the one in the app | `import_svg` already exists; a way to import a lucide icon by name would close the loop | P3 |

- The collapsed right panel puts its button where the agent roster sits (top right of the canvas); the sheet showed it before any code did, and the roster moves down under the button only while that panel is collapsed.

## 2026-11-22: overview and dialogs on shadcn (PAP-B-031, design first)

Task: draw the workspace overview (grid, new-workspace form, delete confirmation) in both theme scopes on
`127.0.0.1:4777`, then migrate `Overview.tsx` onto `Card`, `Button` and `Input`, and add `card.tsx`. Six frames
are in `docs/assets/boards/PAP-B-031/`; the board export in `docs/design/boards.paprika.json` already carries
the PAP-B-031 sheets from an earlier draw (`/tmp/b031/draw.mjs`).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 105 | Reuse an earlier draw without redrawing | The PNGs and `boards.paprika.json` nodes were already committed from a prior session; this ticket only copied shots and applied the markup | Nothing new — the board-in-repo pattern from item 97 paid off here | — |

- `ConfirmDialog` was already on `AlertDialog` with `variant: "destructive"` on the confirm action (PAP-B-026); overview only consumes it.
- Workspace cards keep `outline` instead of `border` so the cover cannot clip the active edge; `Card` ships with `border-ui-border` but the overview overrides with `border-0` plus the existing outline classes.

## 2026-11-22: shell, toolbar, layers and pages on shadcn (PAP-B-033, design first)

Task: draw the editor shell (expanded, left collapsed, both collapsed) in both theme scopes on
`127.0.0.1:4777`, then migrate `App` / toolbar / `Layers` / `Pages` / `InlineName` / `PanelResizer` onto the
primitives. Six frames are in `docs/assets/boards/PAP-B-033/`; the board export in
`docs/design/boards.paprika.json` carries them.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 108 | ToggleGroup that keeps `role=button` + `aria-pressed` | Radix `type="single"` turns items into a radiogroup (`role=radio`, `aria-checked`, `aria-pressed` cleared). The toolbar E2E (`getByRole("button")` + `aria-pressed` + class `is-active`) would fail | Use `type="multiple"` with a controlled single value and `rovingFocus={false}` so Tab still walks every tool; keep the outer `<nav aria-label="Ferramentas">` | P2 |
| 109 | Inactive tab label on a night strip in light mode | The right-panel tab strip stays `bg-night` in both scopes; `$pg.muted` under `mode=light` is `#5d6478` and linted at 2.99:1 on night | Board (and app) keep night muted (`$muted` / `text-muted`) for labels that sit on the night strip | P3 |

- E2E hotspots (`is-active`, `layer-name`, `page`, `data-panel-toggle`, `treeitem`, `add-page`) stayed as plain class/hooks.
- `ui.iconBtn` left `ui.ts`; Inspector/Team/Overview still own the remaining entries.

## 2026-11-22: compact inspector (PAP-B-022, design partial)

Task: redesign the scene inspector into collapsible sections before implementing `apps/web/src/inspector/**`. Two design frames (`PAP-B-022 texto escuro` / `claro`) already live in `docs/design/boards.paprika.json`; a full MCP redraw on `:4777` was skipped when the shared server was slow, and the app before/after PNGs under `docs/assets/boards/PAP-B-022/` carry the measurement case instead.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 106 | Inspector height that proves the compact layout | `aside.right.scrollHeight` stayed 856 px before and after because the grid area forces a tall scroll container; `#right-tabpanel` height dropped 759 → 303 px (~60%) for the demo text node at 1440×900 (`packages/e2e/b022-measure.mjs`) | Use `panel` / `panelScroll` in the measure script (and in acceptance notes), not only `aside.scrollHeight` | P3 |
| 107 | Boards on the shared MCP server | `:4777` answered slowly during the ticket, so only the existing design frames plus runtime screenshots were committed; no new fixed-height frames were drawn over MCP in this pass | Same as #97: a boards document in git that agents can `load` without depending on whichever volume is mounted on the maintainer's port | P2 |

## 2026-11-22: ghost preview while drawing (PAP-B-043, design first)

Task: draw the ghost of the real node (fill/outline/defaults) inside the draft area while dragging a
creation tool, light and dark, then paint it from `nodeStyle` in `Canvas.tsx` with no document write
until release. Eight fixed-height frames on `Interfaces` (`docs/assets/boards/PAP-B-043/`).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 108 | Screenshots as files | Same as #100/#101: `render_screenshot` returns PNG only as base64 in the JSON-RPC content, so a small client script had to decode each shot into `docs/assets/boards/PAP-B-043/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` writes the file | — |
| 109 | Free space for new boards | Top-level frames already fill y≈0…8320 and x≈0…3000; the outline depth-1 listing was enough to pick `y=9000`, but parallel tickets still race for the same band | Done (2026-11-22, PAP-B-061): same as #103 — content box, next free spot, and `place: "free"` | — |

- Active workspace was already `Paprika - UI` / page `Interfaces`; no `open_workspace`.
- Ghost is `aria-hidden` and `pointer-events: none` (`data-testid="draft-ghost"`); connector arrow ghost left out of this ticket's draft-only scope.

## 2026-11-22: inspector on shadcn (PAP-B-032, design first)

Task: draw the inspector (compact fields, collapsible sections, selects, secondary actions) in both theme
scopes on `127.0.0.1:4777`, then migrate `Inspector.tsx` + `inspector/*` onto `Input`, `Textarea`, `Label`,
`Select`, `Button` and `Collapsible`. Four frames in `docs/assets/boards/PAP-B-032/`; boards export refreshed.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Screenshots as files | Same as #108: `render_screenshot` returns PNG only as base64; a client script decoded into `docs/assets/boards/PAP-B-032/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` | — |
| 111 | Free band without racing parallel tickets | Outline depth 1 listed frames through y≈11820 (B-023/B-033/B-043); this ticket picked y=12400 / 13160 | Done (2026-11-22, PAP-B-061): `place: "free"` on `create_nodes` (same as #103/#109) | — |

- `lint_design` with `rootIds` still walks the whole document for counts; our four frames had 0 errors of their own.
- Compact field shell kept (B-022 density): primitives sit inside `bg-ui-muted` with bare borders; Radix `Select` replaced native `<select>` (E2E theme-mode test updated to click the option).
- Layers/Pages left alone (PAP-B-033 owns that chrome).
## 2026-11-22: triangle shape (PAP-A-004, design first)

Task: draw toolbar / inspector / canvas states for `ShapeKind` `triangle` on `Interfaces` (light+dark, fixed height), then ship schema, outline, connectors, toolbar `G`, inspector picker and `draw_diagram`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Toolbar tool lives in `App.tsx` | Ticket paths listed only `Canvas.tsx` for the toolbar+shortcut, but `TOOLS[]` and the keydown handler are in `App.tsx`; edited that file for the `G` / Triangle entry and queried `agent:leonardo` | Keep toolbar registry next to the buttons, or move `TOOLS` into `Canvas.tsx` so lane paths match | P3 |
| 111 | `shapeDefaults` gate in `ops` | `ops.ts` / `ops.go` only apply defaults for a hard-coded kind list; `triangle` needed the same one-line branch (not in the ticket `paths`) | Drive the gate from `ShapeKind` / `shapeDefaults` so new kinds do not touch `ops` | P3 |

- Six frames at `docs/assets/boards/PAP-A-004/`; boards re-exported via `GET /api/export` into `docs/design/boards.paprika.json` (no `open_workspace`).
- `wasmPaintable` stays false for `shape` nodes (DOM paints the triangle outline).
## 2026-11-22: custom color picker (PAP-B-023, design first)

Task: draw the closed, open and alpha states of the inspector color field (light and dark) on `Interfaces`
before replacing the native `input type=color` with a popover. Six fixed-height root frames; PNGs under
`docs/assets/boards/PAP-B-023/`; board export refreshed via `GET /api/export`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Free Y for parallel board frames | Several tickets share `Interfaces`; the outline is prose, so placing PAP-B-023 required exporting the document and scanning top-level `y` values by hand (landed at `y=11000`) | Done (2026-11-22, PAP-B-061): page content box and `place: "free"`, same as #103 | — || 111 | Screenshots as files | `render_screenshot` still returns base64 in the JSON result; a small Node script had to decode each PNG into `docs/assets/boards/PAP-B-023/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` (same as #100 / #101) | — || 112 | Escape that closes a popover without clearing the selection | `App.tsx` listens for Escape on `window` and reparents the selection; the first color-picker Esc also unmounted the inspector field before focus could return to the swatch | Ignore Escape when the event target sits inside `[data-slot="popover-content"]` / dialog (done in this ticket); popovers should `stopPropagation` too | P2 |
- Active workspace was already `Paprika - UI`; no `open_workspace`.
- `lint_design` on the page still reports one unrelated contrast error from an older sheet; the new frames added no errors.
## 2026-11-22: aspect-ratio lock shortcuts while resizing (PAP-B-042, design first)

Task: draw free / keep-ratio / square selection states (light and dark) on the `Interfaces` page of `Paprika - UI`, then wire `Shift` and `Shift+Alt` locks plus a canvas hint in `apps/web/src/Canvas.tsx`. Six fixed-height root frames; screenshots in `docs/assets/boards/PAP-B-042/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | `lint_design` scoped to the ticket's roots | Calling `lint_design` with `rootIds` for the six PAP-B-042 frames still returned hundreds of warnings and one contrast error from older sheets on the same page (`nodeId` outside the requested roots) | Done (2026-11-22, PAP-B-066): `rootIds` is a hard subtree filter (a missing id is an error) | — || 111 | Screenshots as files | Same as #100 / #101: `render_screenshot` returns base64 only; a short local script had to decode into `docs/assets/boards/PAP-B-042/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` | — |
- Active workspace was already `Paprika - UI`; `Interfaces` existed (`interfaces-pap020`); no `open_workspace`.
- Fixed 360 px frame heights avoided the hug screenshot pitfall; `render_screenshot` with `scale: 2` was enough to judge the hint badges.
## 2026-11-22: better activity history (PAP-B-025, design first)

Task: draw the activity feed (actor color+name, action, relative time, batch grouping, undo/redo marker) light and dark before extracting `Activity.tsx` from the Inspector. Four root frames on `Interfaces` (`PAP-B-025 feed|undo` × light/dark), fixed height 320; PNGs under `docs/assets/boards/PAP-B-025/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Agent name color that passes contrast on the panel | Putting the agent blue (`#3b82f6`) on both the dot and the name failed WCAG AA on `$pg.panel2` (3.69:1); the sheet kept the color on the dot only and used `$pg.fg` for the name | Document that presence colors are for fills/dots, not for body text on panel surfaces, or ship text-safe variants next to `AGENT_COLORS` | P3 || 111 | `$pg.select` as marker label ink in light mode | The "agora" marker label at `$pg.select` on the light panel was 3.91:1; switching the label to `$pg.fg` and leaving the line in select fixed lint without inventing a new token | A `select-ink` (or darker light-mode `$pg.select`) for text on light surfaces | P3 |
- `layout.padding: [6, 8]` (two values) is rejected; four values or a single number work. Same class of friction as other tickets.
- Undo/redo position is derived client-side from leading `desfazer:` / `refazer:` labels in the existing WS activity feed — no server change.

## 2026-11-22: title attributes → accessible tooltips (PAP-B-051, design first)

Task: replace every HTML `title` in `apps/web` with the shadcn Tooltip (`Hint` helper: hover + focus, Esc dismisses) while icon buttons keep `aria-label`. Three frames on `Interfaces` (`Paprika - UI`): before/after dark, before/after light, focus/Esc states. PNGs in `docs/assets/boards/PAP-B-051/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 112 | Text paint vs `fill` on boards | Setting `fill` on a text node left `color` at the default `#111111`; lint compared `color` to the node's own `fill` and reported ~1:1 contrast on the light sheet | Document that text ink is `color` (not `fill`) in the design-guide / create_nodes examples agents copy | P2 |
| 113 | Export of the live boards DB | The maintainer's `:4777` store is a Docker volume; this agent had no approved path to `paprika export` from the container, so only the PNGs were committed | Keep refreshing `docs/design/boards.paprika.json` from a host-mounted DB, or add an MCP `export_document` | P2 |
| 114 | Disabled controls and Tooltip | Radix does not open a tooltip on a `disabled` button (no pointer/focus events); the overview delete-when-alone and idle agent pills need a focusable wrapper `span` | Note the span-wrapper pattern next to `Hint` in ADR 0005 or the gallery | P3 |

- `TooltipProvider` moved to `main.tsx` so Overview, Editor and `/ui` share one delay; the floating toolbar dropped its local provider.
- App-level Esc no longer clears the selection while a tooltip is open (`[data-slot=tooltip-content]`).
- a11y E2E: zoom + Retângulo open on focus, Esc closes, no native `title`; agent roster asserts tooltip instead of `title`.

## 2026-11-22: Internationalization en + pt-BR (PAP-B-052, design first)

Task: web UI + default names follow the chosen language; detect from the browser, switch in the app, remember; HTTP API errors → English like MCP. Six frames (overview and language switch × en/pt-BR × dark/light) drawn over MCP; PNGs in `docs/assets/boards/PAP-B-052/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 115 | Boards export from Docker volume | Same as #113: `:4777` holds the drawn sheets; this agent committed PNGs from `render_screenshot` and left `docs/design/boards.paprika.json` for a host-mounted export | MCP `export_document` or a host-mounted DB path for agents | P2 |
| 116 | Wire every remaining Inspector/Team string | Shell, overview, pages, layers, zoom, arrange and multi-select are on the dict; many Inspector field labels and Team copy are still Portuguese literals while keys already exist in `apps/web/src/i18n/messages.ts` | Finish the field-by-field pass (or generate labels from the catalog) in a follow-up | P2 |
| 117 | MCP create_page default name in the pt-BR guide | Core/MCP empty-name fallback is now English (`Page 1`); `guide.pt-BR.md` still describes `"Página 1"` | Align the Portuguese guide with the English default (or say the UI localizes when it passes `name`) | P3 |

- Lightweight dict modules (no i18next): `LocaleProvider` outside the single `TooltipProvider` so language switches do not remount tips.
- E2E: `pinLocale(page, "pt-BR")` in a11y/canvas/drag; `i18n.e2e.test.ts` smokes both languages and the switcher.
- Hotspots (`is-active`, `add-page`, `data-testid`, roles) stay language-stable.

## 2026-11-22: layer order shortcuts and Ordem section (PAP-B-021, design first)

Task: draw the inspector **Ordem** section and the Z-order shortcut map (light and dark, fixed height) on the `Interfaces` page of `Paprika - UI` before wiring `Page Up`/`Page Down` (+ Ctrl/Cmd for front/back) in `Canvas.tsx` and the four arrange actions in `Inspector.tsx`. Four root frames, one `create_nodes` call; PNGs under `docs/assets/boards/PAP-B-021/`; boards export refreshed in `docs/design/boards.paprika.json`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Draw on `Paprika - UI` without `open_workspace` | The workspace was already active (`list_workspaces`), so the sheet landed without switching; if another ticket had left a different active doc, the only options would still be asking the human or a second server (same as #92) | Done (2026-11-22, PAP-B-063): optional `workspaceId` on document tools | — |
- `lint_design` on the four frames: 0 errors; `small-text` warnings are the 11 px section/chip labels matching the app.
- Shortcut map chosen and documented in `docs/canvas.md`: `Page Up`/`Page Down` = forward/backward, `Ctrl+Page Up`/`Ctrl+Page Down` (Cmd on macOS) = front/back.

## 2026-11-22: three arrow line styles (PAP-B-045, design first)

Task: draw elbow / rounded / curve connector states and the inspector Traço picker on `Interfaces` before coding `route: "rounded"|"curve"`. Four frames on a new Interfaces page; PNGs under `docs/assets/boards/PAP-B-045/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 112 | Preview `rounded` / `curve` on the live `:4777` server | The maintainer binary still only accepts `straight`\|`elbow`, so `draw_diagram` refused the new routes; the sheet used `path` mocks for the three styles | Ship the schema before asking agents to redesign against production, or run a ticket-local `paprika serve` for design | P3 |
- Active workspace was `Paprika - UI`; a second `Interfaces` page (`interfaces-pap045`) was created because the outline was large — prefer reusing `interfaces-pap020` when present.
## 2026-11-22: several border types (PAP-B-044, design first)

Task: extend `stroke` with `style` (`solid`|`dashed`|`dotted`) and `position` (`inside`|`center`|`outside`) for frame/rect/ellipse/path/shape, then inspector Estilo/Posição. Four fixed-height frames on `Interfaces` (`docs/assets/boards/PAP-B-044/`); boards export refreshed.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 113 | Stable `Interfaces` page id across parallel tickets | Active workspace flipped to `Paprika - UI` mid-ticket; the old `interfaces` page was gone and a new empty `Interfaces` page had to be created (`id: interfaces`) while other tickets used `interfaces-pap020` / `interfaces-pap045` | `create_page` that reuses an existing page by name (same as #99) | P2 |
| 114 | Screenshots as files | Same as #100/#101: `render_screenshot` returns base64 only | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` | — |
- Default `style`/`position` stay omitted in the document (helpers treat missing as solid / type-aware position) so round-trips and goldens do not grow a `style: "solid"` on every stroke.
- WASM cannot dash or reposition strokes: `wasmPaintable` returns false and the DOM paints them (crates/render untouched).
- Closes the friction in #99 (dashed stroke on boxes) via `stroke.style`.## 2026-11-22: numeric inspector steppers (PAP-B-046, design first)

Task: draw pure-numeric fields with `±` (opacity / weight / stroke), hug/fill and `$token` without steppers, focus ring and clamp-at-min states in light and dark before wiring `Field` steppers; six fixed-height root frames; screenshots under `docs/assets/boards/PAP-B-046/`; local `paprika serve` on `:4799` because the shared `:4777` workspace was crowded by parallel tickets.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 113 | `render_screenshot` param name | Passing `id` silently screenshots the whole canvas (identical PNGs for every frame); the contract expects `rootId` | Reject unknown `id` or alias `id` → `rootId` in the tool schema / handler | P2 |
| 114 | Quiet local server for parallel boards | Shared `:4777` had other agents' sheets and returned confusing stacked frames at `(0,0)`; a throwaway `paprika serve --port 4799` was the reliable path (same class as #92) | Done (2026-11-22, PAP-B-063): optional `workspaceId` on document tools so tickets do not fight for the active doc | — |

- `lint_design` small-text warnings for 12 px labels match the inspector density; no new contrast errors on the six roots.
- Step sizes chosen to match the ticket: opacity `0.05`, weight `100`, else `1`, Shift×10; validation/clamp reused from PAP-B-027.

## 2026-11-22: dockable toolbar (PAP-B-048, design first)

Task: draw toolbar docked top/left/right/bottom (light and dark) on `Interfaces` of the active `Paprica · UI` workspace, then implement grip-drag docking, localStorage, keyboard menu, and clearance for PAP-B-024 collapsed-panel buttons. Eight fixed-height (720×420) root frames; PNGs under `docs/assets/boards/PAP-B-048/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 112 | `render_screenshot` argument name | Passing `id` is silently ignored (schema only has `rootId`); the tool screenshots something else (here a 280×220 unrelated frame) and every PNG comes back identical | Reject unknown args, or accept `id` as an alias of `rootId`, and say so in the tool description | P2 |
| 113 | Light `mode` with `$pg.*` tokens | Frames with `mode: "light"` still rendered the dark `$pg.*` palette because `modes.light` on this server only carried `$ui.*`; had to redraw the light boards with literal colors | Document which token prefixes participate in theme modes, or seed `$pg.*` into `light` when the boards workspace is created | P2 |
| 114 | Screenshots as files | Same as #101: base64 only; a local script wrote `docs/assets/boards/PAP-B-048/` | Optional `path` on `render_screenshot` | P3 |

- Active workspace was already `Paprica · UI` (empty of prior boards until recovered); used existing `page#interfaces` without `open_workspace`.
- Collapsed-panel buttons shift with `[&_[data-panel-toggle=left]]:left-14` from `App.tsx` when the toolbar shares that edge — no change to `PanelResizer.tsx` (outside the ticket paths).
## 2026-11-22: system fonts combobox (PAP-B-047, design first)

Task: draw the closed and open FontPicker states (light and dark) on `Interfaces`, then replace the free-text `fontFamily` field on text nodes with a shadcn combobox. Four fixed-height frames; PNGs under `docs/assets/boards/PAP-B-047/`; boards export refreshed.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 115 | Screenshots as files | Same as #108: `render_screenshot` returns base64 only; `scripts/draw-pap-b-047.mjs` decoded into `docs/assets/boards/PAP-B-047/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` | — |
| 116 | Free band on a crowded Interfaces page | Outline depth 1 bottoms out near y≈13580 (A-004 / B-032); this ticket used y=13800 | `place: "free"` on `create_nodes` (same as #103/#109/#111) | P3 |
- Local Font Access is gated behind an explicit button — opening the popover never calls `queryLocalFonts`.
- `cmdk` 1.1.1 pinned for the Command primitive (ADR 0005 dependency list).
## 2026-11-22: drag and drop reparent + file drop (PAP-B-049, design first)

Task: draw reparent / auto-layout insertion / Layers reorder / file-drop states (light and dark) on `Interfaces`, then wire canvas DnD + Layers row DnD + OS file import in `apps/web`. Eight fixed-height root frames; PNGs under `docs/assets/boards/PAP-B-049/`; boards export refreshed via `GET /api/export`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 110 | Active workspace name match | Ticket said `Paprika - UI`; the live server had `Paprica · UI` (typo/rename) with parallel tickets already drawing on page `interfaces` | Treat close names as the UI board workspace, or pin the id in the assign payload | P3 |
| 111 | `create_page` race on Interfaces | Calling `create_page` while another agent also ensured `Interfaces` produced empty duplicate pages (`38ktwolyd1`, `qhf8mcdwke`) alongside `page#interfaces` | Idempotent `create_page` by name (same as #99) | P2 |
| 112 | Free Y among parallel boards | PAP-B-051 frames already sat at y≈40; PAP-B-049 had to be moved after create to y=1100+ | Outline bbox / `place: "free"` (same as #103 / #110) | P3 |
| 113 | Screenshots as files | `render_screenshot` still returns base64 in MCP content; local decode into `docs/assets/boards/PAP-B-049/` | Done (2026-11-22, PAP-B-062): optional `path` on `render_screenshot` | — |
| 114 | Broken main typecheck | `ui.ts` lost `activity*`/`actions` in merge `3f0bda1`; Inspector still referenced `ActivityEntry`/`Bot`; ColorField had undefined `hex` | Guard merge of `ui.ts` / restore Activity wiring; this PR restored the missing pieces so `pnpm check` can run | P1 |

- Drew on active `Paprica · UI` / page `interfaces` without `open_workspace` after querying the maintainer about the name mismatch.
- Canvas DnD only touches `Canvas.tsx`; Layers HTML5 DnD in `Layers.tsx`; E2E in `drag.e2e.test.ts`.

## 2026-11-23: absolute child in auto-layout (PAP-B-069, design first)

Task: draw the inspector "Ignorar layout" switch (off, on, dark) and a row with a badge sitting on its own x/y, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`), before adding `layoutPositioning`. Four fixed-size frames; PNGs in `docs/assets/boards/PAP-B-069/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 117 | Brand red as text on the night background | `$ui.primary` (`#c8401f`) on `$ui.bg` is 3.54:1, so the dark kickers failed `lint_design` until the ink became `#ffd2c9` | A light ink token for the brand red on night surfaces (the light mode already passes) | P2 |
| 118 | Screenshot files land in the repo | `render_screenshot` `path` writes under the server volume (`/data/screenshots/...`) and returns that path plus `/api/screenshot/<id>`; the PR still copies the PNG with curl | Document that `path` is relative to the server screenshot directory, or accept a path inside an allowlisted host directory | P3 |

- Addressed the workspace by id from `list_workspaces`. Did not call `open_workspace`. Used the existing page `interfaces` (a second page is also named Interfaces).
- The behavior frame is a mock: the live server does not accept `layoutPositioning` yet, so the badge is a sibling placed by x/y, not a real absolute child of the row.
- `lint_design` on the four roots: 0 errors and 0 warnings after shortening the on-state hint and letting the field mocks hug.

## 2026-11-23: corner radius per corner (PAP-B-070, design first)

Task: draw the linked and unlinked corner controls, plus a sample card, on page `Interfaces` of workspace `Paprica · UI` (`workspaceId`, no `open_workspace`) before implementing `radius` as one length or `[tl, tr, br, bl]`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 117 | Screenshot one frame | `render_screenshot` takes `rootId`. Passing `id` is ignored and the tool returns the first page (here, the PAP-B-046 "clamp dark" frame) with no error | Reject unknown argument names, or document `rootId` in the error when the caller sends `id` | P3 |
| 118 | Preview four different corners on the live server | `create_nodes` with `radius: [1, 2, 3, 4]` failed: `expected number, received array`. The sample had to be a path until this change shipped | The running server only learns the new radius after this build | — |

## 2026-11-23: agent pins design (design first, cloud thread)

Task: draw the proposal for "point at an element or area and tell the agent what to do" (5 boards: canvas, composer, panel, MCP contract, flow), first on a cloud `paprika serve`, then on the maintainer's local Paprika in `Paprica · UI` (new page, `workspaceId` on every write, active workspace untouched). PNGs in `docs/assets/boards/agent-pins/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 118 | Know that `lineHeight` is a ratio | Sent `lineHeight: 18` (px); `create_nodes` refused with "Too big: expected number to be <=10". The guide only says `lineHeight (n \| "$token")` | Say "multiplier of fontSize (1.4)" in the guide and in the error | P3 |
| 119 | Screenshot of one frame | `render_screenshot {nodeId}` returned the whole page: the right name is `rootId` and the unknown argument was silently ignored, so five "frame" shots were the same image | Reject unknown arguments (or warn), as the write tools do | P2 |
| 120 | Use the Chromium the environment has | `PAPRIKA_CHROMIUM=/opt/pw-browsers/chromium-1243/.../chrome` was still refused ("build 1243 is installed, but Playwright expects build 1255"); a symlink without the revision in its path worked | An explicit `PAPRIKA_CHROMIUM` skips the revision check (warn instead) | P2 |
| 121 | Draw in a workspace without touching its tokens | Writing boards into `Paprica · UI` meant inlining every color, because `set_tokens` there could overwrite the maintainer's tokens with the same names | `set_tokens {onlyMissing: true}` or a warning listing overwritten tokens | P3 |

- `workspaceId` on `create_page`/`create_nodes` worked well: the boards went into `Paprica · UI` while the canvas stayed on the maintainer's active workspace.
- `create_page {ensure: true}` + `place: "free"` placed five boards with no overlap and no manual coordinates.

## 2026-11-23: archive workspaces (PAP-B-071, design first)

Task: draw the overview archive action and the Archived filter (dark English, dark archived, light Portuguese) on `Interfaces` of `Paprica · UI` (`cmio9n368k`, page `interfaces`) before implementing archive/unarchive. Four fixed-height frames at x=6400; PNGs under `docs/assets/boards/PAP-B-071/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 122 | The UI board named in the ticket | The assign payload said `Paprika - UI`. The live workspace is `Paprica · UI`. A supervisor correction arrived after the claim | Pin the workspace id in the assign payload (same as #110) | P3 |
| 123 | A free spot on `Interfaces` | `get_document_outline` of `page#interfaces` reported `content` 0×0 and `next` 0,0 even though the page already holds many frames, so `place: "free"` was not usable | The page content box should include its child frames | P2 |
| 124 | MCP during a server restart | The first calls returned an empty body while `:4777` was restarting; a short retry then listed the workspaces | Keep the restart note on the ticket; clients should retry an empty response | P3 |

- Addressed the board by `workspaceId` and did not call `open_workspace`.
- `lint_design` flagged a Portuguese action row overflowing a 300px card (`layout-overflow`); widening that card to 360 cleared it.

## 2026-11-23: agent pins implementation

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 125 | Add tools to the contract with a script | `server-go/contract/mcp.json` is hand-formatted (stray `,` lines, mixed layouts), so re-serializing it rewrites thousands of lines; four tools and an `openPins` field on 22 output schemas had to be inserted as text | Normalize the file once (one JSON formatter, checked in CI) so later edits are small diffs | P3 |
| 126 | Know the human left a request | Before pins, a human's "do this here" only reached an agent through the chat | Done here: `list_pins` and `openPins` on write results | — |

## 2026-11-23: blank canvas under parallel writes (PAP-B-067, design first)

Task: draw the error-boundary shell (dark and light) on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`, frames `che1eu41kh` and `ushnfauvoy`) before keeping the editor shell when a render throws.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 127 | `layout.padding` as a 2-number tuple | `create_nodes` refused it with `op[0]: invalid node: layout.padding: Invalid input`. The error did not say that only one number or four values are valid. Every padding became a single number | Name the accepted shapes in that error (one number, or `[top, right, bottom, left]`). The guide already says this (#89); the refusal still does not | P2 |

## 2026-11-23: inspector section collapse (PAP-B-088, design first)

Task: draw the open, mid-slide, closed and reduced-motion states of an inspector section on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before fixing the flicker. Four fixed-height frames at y=3600 (`b088-open`, `b088-mid`, `b088-closed`, `b088-reduce`). PNGs in `docs/assets/boards/PAP-B-088/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 128 | The page named `Interfaces` | `find_nodes` returned two pages with that name: `page#interfaces` (the boards) and an empty `page#h6jut017rv` | Disambiguate duplicate page names in `find_nodes`, or return the page id in the outline header only for the one that has children | P3 |
| 129 | The screenshot file on the host | `render_screenshot` `path` wrote `/data/screenshots/PAP-B-088/*.png` inside the server container. The host repo never saw the file; the PNG had to be downloaded from `url` (`/api/screenshot/<id>`) | Return a host path when the server runs in Docker, or document that `path` is inside the server filesystem and `url` is the way out | P2 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: `get_document_outline` of `page#interfaces` reported `content` 0×0 and `next` 0,0, so the frames were placed by scanning depth-1 `y` (landed at y=3600).
- `lint_design` on the four frames was clean after the chevrons moved to 12px. A clipped mid-slide body needed `lintIgnore: ["layout-overflow"]` because the clip is the frame.

## 2026-11-23: hierarchy and the layer menu (PAP-B-090, design first)

Task: draw the right-click layer stack (light Portuguese, dark English) on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before Enter / Tab / Ctrl+click and the menu. Frames `b090light` and `b090dark` at y=4800. PNGs in `docs/assets/boards/PAP-B-090/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 130 | Ink on a text node | `fill` painted the text box. The glyph color stayed the default `#111111`, so contrast reported `1.07:1` and did not say the glyph field is `color` | Name both colors in the contrast message, and say that text glyphs read `color` | P2 |
| 131 | The screenshot URL from the text block | `render_screenshot` text was only `1520×884px`. The URL lived in `structuredContent.url` (and the image block, when the path is omitted) | Repeat `url` in the text block | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #128, still open: `find_nodes` still returns two pages named `Interfaces`.
- The full-document outline's trailing `content` box belonged to another page. The free spot was the y under the PAP-B-089 frames (4200 + 460), so these landed at y=4800.
- `lint_design` on both frames was clean at warning and above after the glyphs moved to `color` and the dark card title used `#141827` on the white card.

## 2026-11-23: rotation-aware handles (PAP-B-091, design first)

Task: draw the selection before and after it follows a rotated box, light and dark, on page `Interfaces` of workspace `Paprica · UI` (`cmio9n368k`). Frames `b091-before-light`, `b091-after-light`, `b091-before-dark`, `b091-after-dark`. PNGs in `docs/assets/boards/PAP-B-091/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 132 | The page named `Interfaces` | The outline lists `page#iutnyc26zo` ("Página 1") before `page#interfaces`. Taking the first `page#` put the four frames on the wrong page; `move_nodes` to `interfaces` fixed it | Put the page name on the same line as the id in a way a depth-1 scan cannot confuse, or reject a parent that is not the named page | P2 |
| 133 | Corners that match the painted rotation | `get_bounds` rotated a box with the opposite sign of CSS `rotate()` and of the vello renderer, so a handle placed on those corners sat off the pixels | Done in this change: `layout` corners use the CSS matrix in TypeScript and Go | — |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (11880).
- Same as #129, still open: `render_screenshot` `path` is inside the server. The PNGs were decoded from the image bytes in the tool result.
- `lint_design` was clean after `lintIgnore` on the size badge (`contrast`, the badge is a sibling the text does not see) and on the floating handles (`detached-sibling`).

## 2026-11-23: multiple shadows, outline and filters (PAP-B-080, design first)

Task: draw the effects inspector and a preview (dark and light) on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before adding shadow lists, inner shadow, outline, filter and backdropFilter. Frames `b080-fx-dark`, `b080-pv-dark`, `b080-fx-light`, `b080-pv-light` at y=7760. PNGs in `docs/assets/boards/PAP-B-080/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 134 | A design script in a fresh worktree | `@modelcontextprotocol/sdk` is not installed at the repo root, so the script cannot import the client. Raw JSON-RPC over HTTP worked | Document a zero-dependency MCP snippet, or depend on the SDK at the repo root | P3 |
| 135 | The MCP handshake | `notifications/initialized` returned method not found. `initialize` alone was enough for `tools/call` | Clients should tolerate a missing `initialized` notification | P3 |
| 136 | Section titles at 11px | `lint_design` on `b080-fx-dark` reported small-text on the section titles (Sombras, Contorno, Filtro, Filtro de fundo) | Inspector mocks should use at least 12px | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #128: two pages named Interfaces. The script prefers `page#interfaces`.
- Same as #123, still open: placement scanned depth-1 `y` (first pass max bottom 6680, redraw at 7760 after shortening labels). With `rootId`, the outline did include coordinates.
- `render_screenshot` without `path` returned the PNG as a base64 image block, so the host files were written directly (#129).
- Labels at 12px and width 52 fit (Exp, Tipo, Sat). The 11px section titles still warn.

## 2026-11-23: align, wrap and reveal (PAP-B-089, design first)

Task: draw the multi-selection inspector (align, distribute, wrap in a frame) and the layers reveal actions (show all, unlock all, per-row lock) on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before implementing them. Two frames at y=4200 (`pap089lroot`, `pap089droot`). PNGs in `docs/assets/boards/PAP-B-089/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 137 | Primary-colored text on a dark card | The locked-state label used `$ui.primary` (`#c8401f`) on `$ui.card` and `lint_design` reported contrast 3.12:1 | Keep `$ui.primary` for fills; use `$ui.destructiveText` or `$ui.fg` for text on `$ui.card` in the dark theme | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123 and #128, still open: `get_bounds` on `page#interfaces` returned an empty content box, and a second empty page is also named `Interfaces` (`h6jut017rv`). Frames were placed by reading depth-1 `x`/`y` (landed at y=4200).
- `lint_design` on both frames was clean after the locked label switched to `$ui.destructiveText`.

## 2026-11-23: structured gradients and OKLCH (PAP-B-081, design first)

Task: draw the fill inspector, the on-canvas handles and the OKLCH picker, light and dark, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before implementing `gradient` and the color parser. Frames at y=5400 and y=5960. PNGs in `docs/assets/boards/PAP-B-081/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 137 | A free spot under the existing boards | `get_bounds` on page `interfaces` returned a 0×0 content box and next spot `0,0`, while the children extend past x 8000 and y 5200 | Return the union of the page's children when the page itself has no box | P2 |
| 138 | An ellipse knob inside an auto-layout frame | `create_nodes` rejected the whole batch: `unknown fields for ellipse: layoutPositioning` | The error is right; the guide should say the field is only on nodes that flow | P3 |
| 139 | A dark mode on the mock | `mode: "dark"` linted as unknown-mode. The base tokens are already the dark theme; only `light` exists | Document that the base set is the dark theme in `Paprica · UI` | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #128: two pages named Interfaces. Used `interfaces` (the one with children), not the empty page.
- Same as #129: `render_screenshot` wrote under the server's `/data/screenshots`. The PNGs were copied from the returned URL.
- Eight 11px labels warned as small-text. The boards were not redrawn at 12px.

## 2026-11-23: typed tokens and detach (PAP-B-082, design first)

Task: draw token collections (light and dark) and detach (light and dark) on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before typed tokens, named collections and `detach_tokens`. Frames `b082tokl`, `b082tokd`, `b082detl`, `b082detd` at y=6680. PNGs in `docs/assets/boards/PAP-B-082/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 140 | The screenshot file on the host | `render_screenshot` `path` wrote inside the server filesystem (`/data/screenshots/PAP-B-082/*.png`). The host copies were downloaded from `url` (`/api/screenshot/<id>`) | Same as #129: document that `path` is inside the server, and that `url` is the way out | P2 |
| 141 | A kickoff color on a dark frame | `$ui.primary` on the dark background was 3.54:1. `lint_design` reported contrast on the kickers | Keep the known swatch (`#ffd2c9`) in the guide for text on the dark canvas | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #128, still open: `find_nodes` returns two pages named `Interfaces`. The frames went on `page#interfaces`.
- Same as #123, still open: `get_document_outline` of that page reported `content` 0×0 and `next` 0,0, so y=6680 came from a depth-1 scan under the frames already on the page.
- `lint_design` on the four frames was clean after the kickers moved to `#ffd2c9`.

## 2026-11-23: constraints when the parent resizes (PAP-B-084, design first)

Task: draw the inspector constraint axes (dark: right/top, light: scale/center) and a before/after of a parent growing, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before adding `constraints`. Three frames at y=9120 (`papb084-inspector-dark`, `papb084-inspector-light`, `papb084-behavior`). PNGs in `docs/assets/boards/PAP-B-084/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 142 | A free spot on `Interfaces` | Still open: `get_document_outline` of `page#interfaces` reported `content` 0×0 and `next` 0,0. Depth-1 boxes bottomed near y=8960, so the frames went to y=9120 | Same as the open row: the page content box should include its child frames | P2 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- The behavior frame is a mock: the live server does not accept `constraints` yet, so the before/after rectangles are placed by x/y.
- `lint_design` on the three roots: 0 errors and 0 warnings.
## 2026-11-23: web semantics and convert to path (PAP-B-087, design first)

Task: draw the root inspector (link, min width, max width), a decorative image with a `$asset`, and the context menu item "Converter em caminho" on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before implementing. Frames at y=11360. PNGs in `docs/assets/boards/PAP-B-087/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 147 | Section labels at 11px | `lint_design` on the three boards reported small-text on labels and notes at 11px | Inspector mocks should use at least 12px (same as #136) | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #128: two pages named Interfaces. The script used `page#interfaces`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (11360).
- Same as #129: `render_screenshot` `path` is inside the server. The PNGs were decoded from the image bytes in the tool result.

## 2026-11-23: rich text runs (PAP-B-085, design first)

Task: draw painted text, the canvas editor and the inspector hint on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before `runs` on text nodes. Frames `b085-painted`, `b085-editor`, `b085-inspector` at y=10840. PNGs in `docs/assets/boards/PAP-B-085/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 143 | `create_nodes` text as JSON | The tool text is JSON plus one readable line per root, so `JSON.parse` of the whole text throws after the nodes already exist | Return one JSON value, or document that callers must parse the first value | P2 |
| 144 | Draw `runs` and italic on the live board | The server on `:4777` still rejects `runs` and `italic`, so the board fakes them with separate text nodes, a Georgia face and a 1px underline | Expected until this build is the one serving MCP | — |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (10840).
- Same as #129: `render_screenshot` bytes were written to the PNGs from the tool result.
- The price line wrapped until the frame was 720 wide and the price node was 160×40. The workspace name is `Paprica · UI`.

## 2026-11-23: component props, slots and nested instances (PAP-B-086, design first)

Task: draw props, a slot, an instance with values and a nested button inside a card, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before the model change. Four frames (`papb086-props-dark`, `papb086-props-light`, `papb086-instance`, `papb086-nested`). PNGs in `docs/assets/boards/PAP-B-086/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 145 | Labels that stay inside the frame | The first screenshots clipped `size` because the row texts sat at x=0 inside a radius-12 frame | Inset the row texts (x=16) before shooting | — |
| 146 | One page named Interfaces | `find_nodes` still returns two pages named `Interfaces`. The frames went on `page#interfaces`; `h6jut017rv` is empty | Same open row: one page per name, or the outline should say which is empty | P2 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: `get_document_outline` of `page#interfaces` reported `content` 0×0 and `next` 0,0. The frames went to y=9800, below the content that a depth-1 scan already showed.

## 2026-11-23: condensed agent roster (PAP-B-073, design first)

Task: draw the collapsed pill and the expanded active/idle list, light and dark, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before changing `AgentCursors.tsx`. Frames `b073dark` and `b073light` at y=12760. PNGs in `docs/assets/boards/PAP-B-073/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 148 | White label ink on a blue badge | The word sat in a text node next to a blue rect. `lint_design` measured it against the light canvas (1.21:1) and ignored the rect underneath | Contrast for text should use the topmost painted fill under the glyphs, not only the parent | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123 and #128, still open: the content box of `page#interfaces` is empty, and a second page is also named Interfaces. Depth-1 bottoms put the frames at y=12760.
- Nesting the label inside the badge frame cleared the contrast error. `lint_design` on both frames then reported no errors or warnings.

## 2026-11-24: gap and padding handles (PAP-B-092, design first)

Task: draw the spacing bars on a selected auto-layout frame before coding them, on page `Interfaces` of workspace `Paprica · UI` (`cmio9n368k`). Four frames (`b092-before-light`, `b092-after-light`, `b092-before-dark`, `b092-after-dark`) at y=13600. PNGs in `docs/assets/boards/PAP-B-092/`. `lint_design` on those roots: 0.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 147 | `paprika export --db` of the board the script just drew | The database is the compose volume, not a file on the host. The active workspace was already `Paprica · UI`, so `GET /api/export` is that document and was written to `docs/design/boards.paprika.json` | Same as #100 / #113: an `export_document` tool with `workspaceId`, or a host path for the volume | P2 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: `get_document_outline` of `page#interfaces` reported a 0×0 content box, so `y` came from a depth-1 scan (max bottom 13440, frames at 13600).
- Same as #129: `render_screenshot` bytes were written to the PNGs from the tool result.

## 2026-11-24: live build on the canvas (PAP-B-074, design first)

Task: draw the working label, the outline-then-content step and the code toggle (off and on), light and dark, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before `BuildCode` and the replay. Frames `b074dark` and `b074light` at y=14440. PNGs in `docs/assets/boards/PAP-B-074/`.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 149 | White ink on the agent blue `#3b82f6` | The label sat inside the blue badge and `lint_design` reported 3.68:1. Nesting did not change it: white on that blue really is below 4.5:1 | Keep using `agentInk` (the night `#141827` wins on `#3b82f6`) for text on an agent color | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (14440).
- Same as #129: the PNGs were written from the image bytes in the tool result.
- `raw-color` stayed info. The mocks were not redrawn onto tokens.
- After the badge, the cursor tag and the open toggle moved to `#141827`, `lint_design` on both frames reported no errors or warnings.

## 2026-11-24: eyedropper, connector ends, new shapes (PAP-B-093, design first)

Task: draw the pipette, the connector-end handles and the three new outlines before coding them, on page `Interfaces` of workspace `Paprica · UI` (`cmio9n368k`). Four frames (`b093-shapes-light`, `b093-shapes-dark`, `b093-interact-light`, `b093-interact-dark`) at y=15240. PNGs in `docs/assets/boards/PAP-B-093/`. `lint_design` on those roots: 0. The cylinder, parallelogram and cloud were drawn with rect/ellipse/path because those `ShapeKind`s did not exist yet.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 150 | `paprika export --db` of the board the script just drew | Same as #147: the database is the compose volume. The active workspace was already `Paprica · UI`, so `GET /api/export` was written to `docs/design/boards.paprika.json` | Same as #100: an `export_document` tool with `workspaceId` | P2 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (max bottom 15060, frames at 15240).
- `render_screenshot` bytes were written to the PNGs from the tool result.

## 2026-11-24: pin thread and leaving a team (PAP-B-075, design first)

Task: draw the pin thread (human and agent replies, composer) and the leave-team row, light and dark, on page `interfaces` of workspace `Paprica · UI` (`cmio9n368k`) before the canvas change. Frames `b075-light` and `b075-dark`. PNGs in `docs/assets/boards/PAP-B-075/`. After nesting the labels, `lint_design` on both frames: 0 errors, 0 warnings, `raw-color` info only.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 151 | `scaledMock` to drop contrast on a mock | `scaledMock: true` on the root did not drop contrast. Nine errors at 1.00:1: white and accent text sat as siblings of the colored badge, so the checker measured them against the card | Contrast should use the topmost painted fill under the glyphs (same as #148). `scaledMock` should say so when it does not apply | P3 |

- Addressed the board by `workspaceId` `cmio9n368k` and did not call `open_workspace`.
- Same as #123, still open: the content box of `page#interfaces` is 0×0, so `y` came from a depth-1 scan (first pass max bottom 15760, frames at 15920; the contrast redraw landed at 16240 because the old frames were still in that scan).
- Same as #129: the PNGs were written from the image bytes in the tool result.
- Nesting the number, initials and "Responder" inside a frame filled `#141827` cleared the contrast errors. The board was not exported.
