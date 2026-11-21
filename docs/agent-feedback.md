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
| 4 | 5 themes side by side | Tokens are global, so they had to be namespaced by hand (`p1.brand` … `p5.brand`) and rewritten in every node | Token collections/modes and frame-scoped token overrides (`tokens` on a frame) | P2 |
| 5 | Check the result visually on the user's machine | `render_screenshot` failed: Playwright 1.63 needs Chromium build 1243, only 1228 was installed | Detect a missing browser at startup, return the exact fix command in the error, and fall back to rendering through an open canvas tab | P1 |
| 6 | Catch visual mistakes without a screenshot | `lint_design` passed while the calyx floated off the pod | Geometry lint: children that don't touch any sibling, near-misses (< 4px gaps), shapes fully hidden behind others | P2 |
| 7 | Read structured results | Tools return JSON as text; the agent has to parse strings | Declare `outputSchema` and return `structuredContent` | P2 |
| 8 | Layout wrappers that don't clip | Every wrapper frame needed `clip: false` and `fill: "transparent"` | A `group` node, or `clip: false` by default when a frame has auto layout | P3 |
| 9 | Quiet lint | 21 `raw-color` infos for intentional literals (white handles, black text on buttons) | Per-node `lintIgnore: ["raw-color"]` and a `minSeverity` parameter | P3 |
| 10 | See who did what | The actor name comes from the HTTP User-Agent (`node`, `brand-agent`), not from the MCP client | Use MCP `clientInfo.name` as the actor | P3 |
| 11 | One undo step for "draw proposal 3" | 7 history entries for one script run (rename, tokens, 5 creates) | `begin_transaction`/`commit` or a `group` label to merge entries | P3 |
| 12 | Agent-facing language | Guide and errors are in Brazilian Portuguese; English prompts mix languages | Ship the guide and errors in English, keep pt-BR as an option | P2 |
| 13 | Several boards | Everything shares one canvas; proposals had to be stacked by hand with fixed `y` offsets | Pages, plus `layout` on the canvas root (auto-stack top-level frames) | P3 |
| 14 | Watch the agent draw after the server switched files | The open canvas tab reconnected to the new document but kept the old zoom/pan, so the new boards could be off-screen (fixed: the canvas now refits when the document id changes) | Done in this change | — |

## 2026-11-21: bezier curves (`path` node, pen tool, `path_info`)

Task: add bezier curves so agents and humans can draw organic shapes, then redraw the pepper with paths only (`packages/server/scripts/bezier-demo.mjs`).

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 15 | A node box that matches the drawing | Without `width`/`height` the box runs from the node origin to the far edge of the curve, so a `d` that starts at (40,30) leaves empty space at the top left, and overflow lint measures that box | `normalize: true` on create (move the drawing to 0,0 and shift `x`/`y`), or report the gap in `path_info` | P2 |
| 16 | Layer several paths as one shape (body, shadow, highlight, calyx) | Each part repeats the same `x`/`y`; moving the pepper means moving 5 nodes | `group` node (see #8) or a `paths: []` list on one node | P2 |
| 17 | Edit one control point | Changing a curve means rewriting the whole `d` string | `update_path_points` (move anchor/handle by index), and handle editing on the canvas | P3 |
| 18 | Know the drawn size before placing a part | `path_info` with `canvasBounds` answered it in one call; it also caught a typo (`d inválido: número esperado na posição 12`) | Keep: return position-accurate parse errors for every string field | — |

## 2026-11-21: canvas renderer in Rust/WASM (ADR 0001)

Task: prototype the canvas in Rust/WASM (vello on WebGPU, vello_cpu fallback) and benchmark it against the DOM canvas ([ADR 0001](adr/0001-canvas-renderer-rust-wasm.md)). No MCP calls; the friction is about what agents rely on.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 19 | Load an example document outside the server | `examples/bezier.paprika.json` omits defaults (`visible`, `opacity`…); a renderer that read it without `parseDocument` drew nothing in every mode, and only a screenshot showed it | Write examples normalized, or say in AGENTS.md that every reader must go through `parseDocument` | P3 |
| 20 | Check a GPU-rendered canvas from an agent's headless browser | Headless Chromium without a GPU loses the WebGPU device when a canvas is presented (plain JS too), so pixels come back empty | If the canvas ever moves to WebGPU, keep `render_screenshot` on the HTML path, or render offscreen and read pixels back (as `gpu-readback-check.cjs` does) | P2 |
| 21 | Pick the fast path automatically | Headless Chromium offers a *software* WebGPU adapter (SwiftShader) that is 45–220× slower than vello_cpu; a naive "WebGPU if available" picks it | Treat `DeviceType::Cpu` adapters as no GPU (done in the prototype) | — |
| 22 | One geometry source for agents and renderers | The prototype re-derives boxes (and measures a hidden DOM for auto layout) because core exposes no resolved geometry | A core `layout(doc)` returning absolute boxes would serve the renderer, `get_bounds` (#2) and geometry lint (#6) | P2 |

## What worked well

- Nested `create_nodes` built a whole proposal (≈60 nodes) in one call, atomically.
- `lint_design` contrast checks drove the token choices (`brand.dark` for white text on buttons).
- `get_document_outline` with `depth: 0` was enough to confirm the result cheaply.
- One style engine: the screenshots the agent checked come from the same `nodeStyle` the canvas uses.
