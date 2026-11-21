🇺🇸 English | [🇧🇷 Português](pt-BR/backlog.md)

# Feature backlog

Imported on 2026-11-21 from a capability list the maintainer collected from public sources about design tools built for AI agents. Work starts after the Go server and the WASM canvas evaluation are done.

**Originality rule.** The list is a reference for *capabilities*, not a spec to copy. Paprika keeps its own name, brand, look, document format, tool names and keyboard map. It doesn't copy proprietary fonts, assets or product names, and nothing here is reverse-engineered (see the invariant in `.toolbelt/invariants.yaml`).

Status: ✅ done · 🟡 partial · ⬜ missing. Priority: **P1** next slice · **P2** after · **P3** later · **Out** out of scope for a local tool.
`fb#N` points to an item in the [agent feedback log](agent-feedback.md).

## Suggested first slice (after the Go server and the WASM evaluation)

1. Multi-select, `group` and pages (A, B).
2. Components and instances (H).
3. Paste SVG and HTML as nodes, export SVG (F, G, J).
4. Point-by-point path editing (F).
5. Theme modes and tokens exported as CSS variables (E).
6. Agent layer: `structuredContent`, English guide, grouped transactions, actor from `clientInfo` (I).

## A. Document model and layout

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Frames with flex-like layout (row/column, gap, padding, align, wrap) | `frame.layout` | ✅ | — |
| Pages inside a file | `page` nodes, page list in the canvas, `create_page` (2026-11-21) | ✅ | — |
| Group / wrap selection in a frame, unwrap | `group` node, `Ctrl+G`/`Ctrl+Shift+G`, `group_nodes`/`ungroup_nodes` (2026-11-21); no "wrap in frame" yet | 🟡 | P2 |
| Absolute child inside an auto-layout frame ("ignore layout") | Children of row/column always flow | ⬜ | P1 |
| Corner radius per corner | Single `radius` | 🟡 | P1 |
| Z-order (forward, backward, front, back) | `move_nodes` with `index`; no canvas shortcuts | 🟡 | P1 |
| Hide, lock, unlock all | `visible`, `locked`; no "unlock all" | 🟡 | P2 |
| Align and distribute selection | — | ⬜ | P2 |
| Constraints (behavior when the parent resizes) | — | ⬜ | P2 |
| Gap and padding handles on the canvas | Inspector only | ⬜ | P2 |
| Container and breakpoint tokens, responsive frames | — | ⬜ | P3 |
| CSS Grid layout | — | ⬜ | P3 |

## B. Selection and canvas navigation

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Multi-select (shift-click, marquee), select all, select siblings | Shift/Ctrl-click, marquee, `Ctrl+A` selects siblings (2026-11-21) | ✅ | — |
| Move down/up the hierarchy, deep select, cycle siblings | `Esc` selects the parent, double-click selects inside a group; no sibling cycling | 🟡 | P2 |
| Layer tree under the cursor (context menu) | — | ⬜ | P2 |
| Rotation-aware hit testing and handles | Box-based | ⬜ | P2 |
| Configurable nudge step | Arrows 1px, Shift 10px | 🟡 | P3 |
| Eyedropper (sample a color from the canvas) | — | ⬜ | P2 |
| Duplicate by modifier-drag | `Ctrl+D` duplicate | 🟡 | P3 |
| Hide UI (focus mode), rename shortcut, collapse layer tree | Double-click a layer or a frame title on the canvas to rename it in place (`Enter` confirms, `Esc` cancels, undoable) (2026-11-21); layer tree collapses; no focus mode | 🟡 | P3 |

## C. Styling

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Fill, border, shadow, opacity, rotation | Base fields | ✅ | — |
| Multiple shadows, inner shadow, outline | One `shadow`, no outline | 🟡 | P2 |
| CSS filters (blur, saturate, grayscale, brightness, sepia, invert, hue-rotate) and backdrop filters | — | ⬜ | P2 |
| Structured gradients (linear, radial, conic) with on-canvas handles and angle | Raw CSS string only; lint ignores it | 🟡 | P2 |
| Modern color: `oklch()`, `color-mix()`, Display P3, OKLCH picker | Strings pass through to CSS, but lint can't parse them and the picker is sRGB hex | 🟡 | P2 |
| Blend modes | — | ⬜ | P3 |
| Selection colors panel (all colors used in the selection) | — | ⬜ | P3 |

## D. Typography

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Font family, size, weight, line height, letter spacing, alignment | `text` node | ✅ | — |
| Rich text (style per character/word, editable by agents) | One style per node | ⬜ | P2 |
| Font tokens (family, weight, size, line height, letter spacing) | Size tokens only | 🟡 | P2 |
| Variable font axes and OpenType features | — | ⬜ | P3 |
| Text shortcuts (bold, italic, size/weight steps), auto line height | — | ⬜ | P3 |
| CJK word-keep, combining marks, multi-codepoint emoji checks | Browser default | 🟡 | P3 |

## E. Tokens and themes

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Global tokens (`$name`) for colors and sizes, set by agents | `set_tokens` | ✅ | — |
| Theme modes (light/dark/compact) and token collections | `document.modes` + `set_tokens` with `mode`, inspector (2026-11-21); no named collections yet | 🟡 | P2 |
| Frame-scoped token overrides | `mode` on a frame or page applies a mode to its subtree (2026-11-21) | ✅ | — |
| Tokens exported as CSS variables in HTML/React export | `export_code` `cssVariables` (2026-11-21): `:root` plus `[data-paprika-mode]` rules; React exports `tokensCss` | ✅ | — |
| Typed tokens (color, radius, spacing, font…) with validation | Untyped string/number | 🟡 | P2 |
| Detach a token from a node | Manual edit | 🟡 | P2 |
| Generate tokens from an existing codebase via MCP | — | ⬜ | P2 |
| Tokens with `calc()` / `color-mix()` | Token chains only | ⬜ | P3 |
| Copy tokens between files | — | ⬜ | P3 |

## F. Vector

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Vector node from SVG path data (lines, bezier, arcs) | `path` node, `path_info` | ✅ | — |
| Pen tool to create paths | `P`, bezier handles, close on first point | ✅ | — |
| Edit points and handles of an existing path | Double-click a path: drag points and handles, add, remove, corner/smooth (2026-11-21); `d` in the inspector | ✅ | — |
| Import/paste SVG as editable `path` layers | `import_svg`, `Ctrl+V` in the canvas (2026-11-21): paths, shapes (axis-aligned rect/ellipse stay native), groups, transforms, inherited paint; no text, images, gradients or `<style>` CSS | ✅ | — |
| Boolean operations (union, subtract, intersect, exclude) | — (fb#1) | ⬜ | P2 |
| Convert rect/ellipse to path | — | ⬜ | P2 |
| Snapping and guides for points, half-pixel snapping | — | ⬜ | P3 |
| Mirror, repeat, shape builder, vector networks | — | ⬜ | P3 |

## G. Paste and import

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Paste HTML with inline styles as nodes (inverse of `nodeStyle`) | `import_html`, `Ctrl+V` (2026-11-21): Paprika's own HTML comes back the same; other HTML is approximated (flex → row/column, blocks → column); classes and stylesheets are not applied | ✅ | — |
| Paste SVG | `Ctrl+V` with SVG markup (see F) | ✅ | — |
| Paste or drop images (stored as data URI or local asset) | `image` node via MCP only | 🟡 | P2 |
| Capture an element from any web page into nodes (browser extension) | — | ⬜ | P3 |
| Import from other design tools' clipboards | — | ⬜ | Out |

## H. Components and reuse

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Components and instances with overrides and `scale` | `component`/`instanceOf`/`scale`/`overrides` on frames, `create_component`, `create_instance`, `detach_instance` (2026-11-21); no nested instances yet | ✅ | — |
| Component props and slots | — | ⬜ | P2 |
| Code components (render real components from the user's repo) | — | ⬜ | P3 |
| Icon packs / UI kit starters | — | ⬜ | P3 |

## I. Agent layer (MCP and CLI)

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Embedded MCP server (stdio + HTTP), read and write, CLI | `paprika serve`/`mcp`, 23 tools | ✅ | — |
| Token-efficient reads | `get_document_outline` | ✅ | — |
| Structured results (`outputSchema` + `structuredContent`) | Every JSON tool declares `outputSchema` and returns `structuredContent` (2026-11-21) | ✅ | — |
| Guide and errors in English (pt-BR optional) | Guide, tool descriptions, errors, warnings and lint in English; `get_design_guide {language: "pt-BR"}` (2026-11-21). The canvas UI is still pt-BR | ✅ | — |
| Group several writes into one undo step | `batch` on every write tool (2026-11-21) | ✅ | — |
| Actor name from MCP `clientInfo` | `agent:<clientInfo.name>` on stdio and HTTP (session id carries the name) (2026-11-21) | ✅ | — |
| Agent presence on the canvas (cursor, what it is editing) | Own cursor, outline, name and color per agent session, roster; implicit from every tool call (2026-11-21) | ✅ | — |
| Comments for humans and agents (create, resolve, filter) | `notes` field only | 🟡 | P2 |
| Manage files via MCP (list, create, open, rename, archive), several files at once | One file per process | ⬜ | P2 |
| "Connect your agent" panel with ready configs per client | README snippets | 🟡 | P2 |
| Geometry help for agents (rotated bounds, origin, geometry lint) | `path_info` only (fb#2, fb#6) | 🟡 | P2 |
| Visual diff between versions (for CI) | — | ⬜ | P3 |
| Remote MCP (server outside the user's machine) | Local by design | ⬜ | Out |

## J. Export and handoff

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Standalone HTML, React (inline styles), PNG | `export_code`, `render_screenshot` | ✅ | — |
| SVG export (frame or selection) | `export_code` format `svg`, `⇩` in the toolbar, `GET /api/svg` (2026-11-21): layout and text lines measured in headless Chromium; gradients and background images are left out | ✅ | — |
| Tailwind classes export | — | ⬜ | P2 |
| WebP/AVIF, PDF (single or combined frames) | — | ⬜ | P2 |
| React + CSS module / CSS variables | — (see E) | ⬜ | P2 |
| Video export of animated frames | — | ⬜ | P3 |

## K. Generative features in the canvas

Paprika's stance: the connected agent does generation through MCP, so the tool stays model-agnostic and needs no API keys.

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Generate SVG/vector from a prompt | Agent writes `path` nodes | 🟡 | P3 |
| Generate or edit images from a prompt | — | ⬜ | P3 |
| "Remix" a selection (variations, palettes, font pairs) | — | ⬜ | P3 |
| Embeds (Lottie, Rive, video) | — | ⬜ | P3 |

## L. Effects and shaders

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Procedural effect layers (mesh gradient, noise, grain, dithering, halftone, warp) | — | ⬜ | P3 |
| Image filters (texture, glass, distortion) | — | ⬜ | P3 |

Decision pending: write our own effects (WebGL/WebGPU, ties into the WASM evaluation) instead of embedding third-party shader packages, to keep the originality rule simple. Only reuse an open-source package after a license check and under its own name.

## M. Files and collaboration

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Workspace with several files, folders, thumbnails | Overview of the workspaces at `/` (2026-11-21): list, create, open; one active workspace shared by canvas and agents (`list_workspaces`, `open_workspace`, `create_workspace`). No folders, thumbnails, rename or delete yet | 🟡 | P2 |
| Tabs for open files | — | ⬜ | P3 |
| Live data in designs (fetch from an API or sheet) | — | ⬜ | P3 |
| Real-time multi-user editing (CRDT) | Single writer + watcher | ⬜ | P3 |
| Script / plugin pane | — | ⬜ | P3 |
| Sharing settings, SSO, organizations, hosted CDN assets, plans and quotas | — | — | Out |

## N. Code health (SonarCloud)

Open SonarCloud issues imported on 2026-11-21 (project `leonardo-moraes360_paprika`; filter: Security + Reliability, impact Blocker/High/Medium, status Open/Confirmed; code at `main` 21841f7). 40 issues, none Blocker. Fix in code; don't change issue status in SonarCloud by hand.

| Rule | Impact | Where | Fix | Status | Pri. |
|---|---|---|---|---|---|
| S8707 path traversal from CLI args (3) | Security High | `bench/tasks/lib.mjs:17`; `packages/server/scripts/bezier-demo.mjs:8, 31` | Resolve the path and require it to stay under `process.cwd()` before reading, `rm` or writing | ⬜ | P1 |
| S6506 HTTPS not enforced on redirects (2) | Security Medium | `.github/workflows/ci.yml:377`; `.github/actions/setup-rust-wasm/action.yml:23` | `curl --proto '=https' --proto-redir '=https'` (the sha256 check stays) | ⬜ | P1 |
| S2077 dynamically formatted SQL (1) | Security Medium | `server-go/internal/server/store.go:332` | Table names come from a fixed list (likely false positive); write the three `DELETE`s as literals | ⬜ | P2 |
| S7688 `[` instead of `[[` (10) | Reliability High | `.claude/hooks/session-start.sh:27, 34, 43, 46, 68, 80 (×2), 98 (×3)` | Use `[[ … ]]` (the script is bash) | ⬜ | P1 |
| S2871 `sort()` without a compare function (1) | Reliability High | `.github/scripts/check-actions-pinned.mjs:105` | Explicit code-point comparator, so the order stays the same | ⬜ | P1 |
| S8786 regex with super-linear backtracking (3) | Reliability Medium | `apps/site/scripts/build.mjs:287`; `apps/web/src/Inspector.tsx:380`; `.github/scripts/check-actions-pinned.mjs:27` | Remove ambiguous adjacent quantifiers (e.g. `/^# +(\S.*)$/m`) and cover with a test | ⬜ | P2 |
| S7773 global `parseInt`/`parseFloat`/`isNaN` (10) | Reliability Medium | `bench/tasks/lib.mjs:126 (×4)`; `packages/core/src/lint.ts:26, 31 (×2), 121`; `apps/web/src/Inspector.tsx:373, 383` | `Number.parseInt` / `Number.parseFloat` / `Number.isNaN` | ⬜ | P2 |
| S9383 floating promises (5) | Reliability Medium | `experiments/canvas-wasm/bench/webgpu-canvas-probe.cjs:4, 11`; `main.ts:177`; `run.cjs:12`; `gpu-readback-check.cjs:7` | `.catch()` that logs and exits 1 (or exclude `experiments/` from analysis) | ⬜ | P3 |
| S6848 non-native interactive element (1) | Reliability Medium | `apps/web/src/Layers.tsx:32` | `role`, `tabIndex={0}` and Enter/Space in `onKeyDown`, or a `<button>` | ⬜ | P2 |
| S9379 `autoFocus` (1) | Reliability Medium | `apps/web/src/Pages.tsx:54` | Focus through a `ref` + `useEffect` when editing starts | ⬜ | P3 |
| S3923 ternary with identical branches (1) | Reliability Medium | `apps/site/scripts/draw-landing.mjs:161` | Use `"link:./"` directly | ⬜ | P3 |
| Input without label (2) | Reliability Medium | `experiments/canvas-wasm/bench/index.html:16, 17` | `<label for>` or `aria-label` | ⬜ | P3 |
