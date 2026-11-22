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
| Z-order (forward, backward, front, back) | `update_nodes`/`move_nodes` take `index`: a number from 0, or `front`/`back`/`forward`/`backward`, one undo step (2026-11-22); no canvas shortcuts (PAP-B-021) | 🟡 | P1 |
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
| Theme modes (light/dark/compact) and token collections | `document.modes` + `set_tokens` with `mode`, inspector (2026-11-21), persisted in SQLite (2026-11-22); no named collections yet | 🟡 | P2 |
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
| Boolean operations (union, subtract, intersect, exclude) | — (fb#1, fb#76; see Q) | ⬜ | P1 |
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
| Workspace with several files, folders, thumbnails | Overview of the workspaces at `/` (2026-11-21): list, create, open, rename, delete; one active workspace shared by canvas and agents (`list_workspaces`, `open_workspace`, `create_workspace`, `rename_workspace`, `delete_workspace`), cover image per card (upload or `set_workspace_cover` from a frame). No folders yet | 🟡 | P2 |
| Tabs for open files | — | ⬜ | P3 |
| Live data in designs (fetch from an API or sheet) | — | ⬜ | P3 |
| Real-time multi-user editing (CRDT) | Peer-to-peer team sync: Iroh + Loro sidecar, `paprika serve --team`, signed operations, expiring invites (ADR 0004, PRs #61–#69); remove a member and rotate a key (2026-11-22); team mode in Compose (`compose.team.yaml`). Missing: leaving on your own, approval roles | 🟡 | P2 |
| Script / plugin pane | — | ⬜ | P3 |
| Sharing settings, SSO, organizations, hosted CDN assets, plans and quotas | — | — | Out |

## N. Code health (SonarCloud)

Open SonarCloud issues imported on 2026-11-21 (project `leonardo-moraes360_paprika`; filter: Security + Reliability, impact Blocker/High/Medium, status Open/Confirmed; code at `main` 21841f7). 40 issues, none Blocker. Fix in code; don't change issue status in SonarCloud by hand.

Update 2026-11-22: every issue below is fixed in code (the `fix(sonar)` commits on `main`, plus S7773 in `packages/core` and S2077 in `store.go` in the second backlog batch). SonarCloud closes them on its next analysis of `main`.


| Rule | Impact | Where | Fix | Status | Pri. |
|---|---|---|---|---|---|
| S8707 path traversal from CLI args (3) | Security High | `bench/tasks/lib.mjs:17` (`packages/server/scripts/bezier-demo.mjs:8, 31` went away with the TypeScript server) | Resolve the path and require it to stay under `process.cwd()` before reading, `rm` or writing | ✅ | — |
| S6506 HTTPS not enforced on redirects (2) | Security Medium | `.github/workflows/ci.yml:377`; `.github/actions/setup-rust-wasm/action.yml:23` | `curl --proto '=https' --proto-redir '=https'` (the sha256 check stays) | ✅ | — |
| S2077 dynamically formatted SQL (1) | Security Medium | `server-go/internal/server/store.go:332` | Table names come from a fixed list (likely false positive); write the three `DELETE`s as literals | ✅ | — |
| S7688 `[` instead of `[[` (10) | Reliability High | `.claude/hooks/session-start.sh:27, 34, 43, 46, 68, 80 (×2), 98 (×3)` | Use `[[ … ]]` (the script is bash) | ✅ | — |
| S2871 `sort()` without a compare function (1) | Reliability High | `.github/scripts/check-actions-pinned.mjs:105` | Explicit code-point comparator, so the order stays the same | ✅ | — |
| S8786 regex with super-linear backtracking (3) | Reliability Medium | `apps/site/scripts/build.mjs:287`; `apps/web/src/Inspector.tsx:380`; `.github/scripts/check-actions-pinned.mjs:27` | Remove ambiguous adjacent quantifiers (e.g. `/^# +(\S.*)$/m`) and cover with a test | ✅ | — |
| S7773 global `parseInt`/`parseFloat`/`isNaN` (10) | Reliability Medium | `bench/tasks/lib.mjs:126 (×4)`; `packages/core/src/lint.ts:26, 31 (×2), 121`; `apps/web/src/Inspector.tsx:373, 383` | `Number.parseInt` / `Number.parseFloat` / `Number.isNaN` | ✅ | — |
| S9383 floating promises (5) | Reliability Medium | `experiments/canvas-wasm/bench/webgpu-canvas-probe.cjs:4, 11`; `main.ts:177`; `run.cjs:12`; `gpu-readback-check.cjs:7` | `.catch()` that logs and exits 1 (or exclude `experiments/` from analysis) | ✅ | — |
| S6848 non-native interactive element (1) | Reliability Medium | `apps/web/src/Layers.tsx:32` | `role`, `tabIndex={0}` and Enter/Space in `onKeyDown`, or a `<button>` | ✅ | — |
| S9379 `autoFocus` (1) | Reliability Medium | `apps/web/src/Pages.tsx:54` | Focus through a `ref` + `useEffect` when editing starts | ✅ | — |
| S3923 ternary with identical branches (1) | Reliability Medium | `apps/site/scripts/draw-landing.mjs:161` | Use `"link:./"` directly | ✅ | — |
| Input without label (2) | Reliability Medium | `experiments/canvas-wasm/bench/index.html:16, 17` | `<label for>` or `aria-label` | ✅ | — |

## O. Diagrams

Simple diagrams (flowcharts, architecture sketches, mind maps) drawn by the human on the canvas or by an agent over MCP. Excalidraw and Whimsical are references for the kind of feature only; the look follows Paprika's own theme.

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Shapes with text inside (box, ellipse, diamond) and sticky notes | `shape` node, `S`/`D`/`N` tools, text edited in place (2026-11-21) | ✅ | — |
| Arrows that stick to shapes and follow them, straight or elbow | `connector` node, `A` tool, geometry derived from the ends (2026-11-21) | ✅ | — |
| Agent draws a whole diagram in one call, with automatic layout | `draw_diagram` (2026-11-21) | ✅ | — |
| Labels on arrows | `label` on `connector` and on `draw_diagram` edges, drawn at the middle of the line with a halo, edited in the inspector (2026-11-22, fb#57) | ✅ | — |
| Arrows that route around other shapes | Elbow routes ignore obstacles | ⬜ | P2 |
| Curved arrows and more shapes (cylinder, parallelogram, cloud) | — | ⬜ | P2 |
| Re-attach or detach an arrow end by dragging it on the canvas | Inspector only | ⬜ | P2 |
| Hand-drawn style | — | ⬜ | P3 |

## P. Maintainer requests (2026-11-22)

Added by the maintainer on 2026-11-22, to plan later (not started). The constraints in each row are part of the request.

| Capability | Constraints and notes | Status | Pri. |
|---|---|---|---|
| Export to PDF, HTML, CSS (Tailwind or CSS Modules), React, Angular or Svelte | Also as MCP tools. Extends J (today: HTML, React with inline styles, SVG) | ⬜ | TBD |
| Export to SVG, PNG, JPEG, AVIF, WebP | Also as MCP tools. **No headless Chromium**: in the canvas (TS) or in the Go server. Today SVG and PNG go through headless Chromium (J) | ⬜ | TBD |
| Resize images to qHD ("semi HD"), HD, 2K, 4K | Also as MCP tools. **No headless Chromium**: in the canvas (TS) or in the Go server | ⬜ | TBD |
| Turn `title` attributes into accessible tooltips | Follows the accessibility review ([thread "Revisar acessibilidade do Paprika"](https://claude.ai/code/project/chan_01QGCFibNVKw2MsxBcqe4Jmi?thread=cmsg_01QGCFibNVKw2MsxBcqe4Jmi1MtFJYQ4HiNMD17jXKGUrG), PR #70) | ⬜ | TBD |
| Side panels collapse into a floating button when shrunk past their minimum | Top-left or top-right corner; clicking the button expands that panel | ⬜ | TBD |
| Migrate the UI to shadcn components | Keep Paprika's own theme (ADR 0003, Tailwind without Preflight) | ⬜ | TBD |
| Better on-screen animations with tailwind-animate | — | ⬜ | TBD |
| Custom color picker | Today the inspector uses the native color input | ⬜ | TBD |
| Compact inspector | Today it is one long scroll area with a lot of information | ⬜ | TBD |
| Better-looking activity history | Today it is a block of poorly formatted information | ⬜ | TBD |
| Layer order: send to back or bring to front, arbitrarily | Shortcuts such as Page Up / Page Down, and also over MCP. Today only `move_nodes` with `index`, no canvas shortcut (see A, "Z-order") | ⬜ | TBD |
| Components reusable across pages and across workspaces | Today `component`/`instanceOf` only work inside one document (H); missing: a library shared by workspaces, instances that point to another workspace, and how updates reach them | ⬜ | TBD |
| Multiplayer LLM chat in the canvas | Floating, centered at the bottom of the canvas; shared by the people (and agents) of the workspace | ⬜ | TBD |
| Bug: the first page of a workspace cannot be renamed while it is the only one | Cause found: a workspace without pages shows a placeholder "Página 1" row (`apps/web/src/Pages.tsx`) that is not a real page node, so double-click does nothing; renaming it should create the page and name it | ⬜ | TBD |
| Destructive actions | A danger button variant (and confirmation pattern) for delete/remove; today every action uses the brand primary button | ⬜ | TBD |
| Design system as a concept in the canvas | A place for the workspace's tokens, components and rules that agents and people draw from (relates to E and H) | ⬜ | TBD |
| Assisted adversarial verification in the canvas | Port to Rust or Go. Prove with numbers that each app screen matches the approved board, light and dark: a generator tunes the app until pixel similarity reaches ≥ 95 % per screen and mode, and an independent discriminator redoes the build, references, captures and comparison and fails it on score, cheating (edited references, unjustified masks, comparator changes), regression or contrast; at most 3 rounds, then a human decides. Pieces to port: comparator (pixelmatch, threshold 0.1, magenta padding on size mismatch, masks with a reason), references rendered from the boards, capture, contrast gate, cheat guard. Spec supplied by the maintainer (TS/Playwright harness from another project) | ⬜ | TBD |
| Import PNG, JPEG, WebP, AVIF, GIF, `.fig` and other formats, besides SVG and HTML | Also as MCP tools. Extends G: today only SVG and HTML are imported (`import_svg`/`import_html`, `Ctrl+V`) and an `image` node is created only over MCP (G, "Paste or drop images"). Raster files become `image` nodes (data URI or local asset; decide whether animated GIFs keep moving). Dropping files on the canvas is in the next row. **`.fig` needs a decision**: it is an undocumented proprietary format, and reading it directly would mean reverse engineering, which the originality rule forbids; options are a documented route (the vendor's public API or its SVG/PDF exports) or leaving it out, as G already does for other design tools' clipboards. "etc." in the request: other formats (e.g. PDF) to be listed when planned | ⬜ | TBD |
| Drag and drop elements in the canvas | Reading recorded on 2026-11-22 (the request only says "drag and drop the elements inside the canvas"): (1) drag a node to move it **and reparent it**: dropping it inside a frame or group, or onto another layer, makes that its parent, and inside an auto-layout frame the drop point picks its position among the children; (2) drop external files (images, SVG, HTML) from the OS onto the canvas, using the import row above. Today dragging only moves absolutely positioned nodes inside their current parent (x/y `update`); children of auto-layout frames cannot be dragged, nothing reparents, the Layers panel has no drag, and only the workspace cover accepts a dropped file (overview). MCP already reparents with `move_nodes` (`parentId`, `index`). Relates to A "Z-order", B "Duplicate by modifier-drag", O "Re-attach or detach an arrow end by dragging" and the layer-order row above | ⬜ | TBD |
| Internationalization (i18n) | Reading recorded on 2026-11-22 (the request only says "add i18n"): translate the web app UI, at least English and pt-BR to match the bilingual docs, with a way to pick the language. Today the canvas UI, HTTP API messages and default names ("Página 1") are pt-BR only (I, "Guide and errors in English"); the agent-facing text is English with `get_design_guide {language: "pt-BR"}`, and the site already has en and pt-BR pages. Open when planned: whether default names and API messages follow the UI language, and which other languages come next | ⬜ | TBD |
| New version notice in the app | Smaller first step of the OTA request (agreed with the maintainer on 2026-11-22). The app checks the GitHub releases and shows "a new version is available" with the update command (`git pull` + `docker compose up -d --build`). Needs published releases first: the repo has no tags or releases yet; `paprika --version` already reports `server.Version` | ⬜ | TBD |
| Version check between team peers | The real risk today: two instances on different versions can diverge in the CRDT or in signed operations. The sidecar's ALPNs are versioned (`paprika/sync/1`, `paprika/join/1`), but peers do not compare app or document-format versions; the check should warn or refuse sync on an incompatible peer (M, "Real-time multi-user editing", ADR 0004) | ⬜ | TBD |
| Full OTA update (signed download, rollback) | Future, only once there is a standalone binary or desktop app. Under Docker an update means replacing the image: a binary that replaces itself inside the container fights that and is lost on the next `up --build`. Depends on the two rows above and on published releases | ⬜ | TBD |
| Three arrow line styles: square, rounded, free curve | Reading recorded on 2026-11-22 (screenshot from the maintainer shows today's elbow arrow): (1) square corners, what `route: "elbow"` draws today (`route: "straight"` also exists); (2) rounded, the same elbow route with rounded corners; (3) free curve, a bezier whose handle can be dragged on the canvas to shape it. Also over MCP and in the inspector. Refines O "Curved arrows" and relates to O "Re-attach or detach an arrow end by dragging" and F point editing | ⬜ | TBD |
| Double-click an arrow to add, edit or remove its label | Inline editing on the canvas, like shape text (O). Today the `label` is edited only in the inspector (O "Labels on arrows", PR #75); clearing the text removes the label | ⬜ | TBD |
| Drag the toolbar and dock it left, top, right or bottom | Today the floating toolbar is fixed, centered at the top of the canvas (`apps/web/src/App.tsx`). On the left and right it becomes vertical; the chosen side is remembered. Plan together with the side panels row above (collapse into a floating button), so the toolbar and the panels don't fight for the same edge | ⬜ | TBD |
| Resize handles on all four corners | Today a selected node has a single resize handle, at the bottom-right corner (`apps/web/src/Canvas.tsx`, screenshot from the maintainer). Dragging a corner keeps the opposite corner in place. Relates to B "Rotation-aware hit testing and handles" | ⬜ | TBD |
| Aspect-ratio lock shortcuts while resizing, with a visual hint | Three locks: square (1:1); rectangular driven by the width; rectangular driven by the height. Modifier keys such as `Shift` or `Ctrl` (exact mapping decided when planned); a hint on the canvas shows which lock is active. Today resizing takes no modifier and there is no ratio lock. "Driven by the width/height" (maintainer, 2026-11-22): keep the current ratio while that side leads and the other follows | ⬜ | TBD |
| Several border types for elements | Today `stroke` is only `{color, width}` (`packages/core/src/schema.ts`) and the inspector shows color and width; only connectors have `dashed`. Missing: solid, dashed, dotted and similar styles (and, to decide when planned, inside/center/outside position and per-side borders). Relates to C "Multiple shadows, inner shadow, outline" | ⬜ | TBD |
| Triangle as a simple shape | New `ShapeKind` next to `rect`, `ellipse`, `diamond`, `note` (O), with a toolbar tool, in the inspector shape picker and over MCP (`draw_diagram` too) | ⬜ | TBD |
| `+` and `−` buttons on every purely numeric field | A stepper in the inspector for fields such as opacity, weight, stroke width and position; fields that accept tokens (`$name`) or text keep a plain input. Relates to B "Configurable nudge step" | ⬜ | TBD |
| Bug: numeric fields accept non-numeric text | Screenshot from the maintainer: "Opacidade" shows `1aaaaa`. Cause: `Field` with `type="number"` renders a text `<input>` with only `inputMode="decimal"` (`apps/web/src/Inspector.tsx`), and `setNum` silently drops a value that does not parse. Numeric fields should refuse non-numeric input (and say why when a pasted value is rejected) | ⬜ | TBD |
| System fonts on any element with text | A font picker that lists the fonts installed on the machine (e.g. Local Font Access API, with a fallback list) for `text`, `shape` and every node that has `fontFamily`. Today `fontFamily` is a free text field. Relates to D "Font tokens" | ⬜ | TBD |
| Import and export fonts in several formats | E.g. TTF, OTF, WOFF, WOFF2: fonts embedded in the workspace (as assets) and carried in exports (`@font-face` in HTML/CSS, embedded in SVG/PDF). Also over MCP. Respect each font's license when embedding. Relates to J and the export rows above | ⬜ | TBD |

## Q. From the agent feedback log (2026-11-22)

Every item still open in the [agent feedback log](agent-feedback.md) (fb#1 to fb#79), grouped into implementation work. Each row names the feedback it closes; when a row ships, mark those `fb#` items "Done" in the log. Priorities come from the log, raised where several agents hit the same wall.

| Work item | What to build | Feedback | Status | Pri. |
|---|---|---|---|---|
| Move a board between Paprika servers | `import_document` (a `.paprika.json` in, a new workspace out, without switching the active one); `paprika export --root <id>` for one frame; `create_nodes` ignores derived connector fields instead of refusing them | fb#72, fb#75 | ⬜ | P1 |
| Core geometry: absolute boxes for agents | A core `layout(doc)` returning absolute boxes (Go port held by fixtures), a `get_bounds` tool with rotated corners, an `origin` field, and `normalize` on path create (or the offset in `path_info`); the core export uses the same boxes, so SVG of auto-layout nodes needs no browser | fb#2, fb#15, fb#26, fb#41 | ⬜ | P1 |
| Boolean operations and cut-outs | `union`/`subtract`/`intersect`/`exclude` producing a new `path` (MCP op + canvas command), or a `mask` on `group`; same item as F "Boolean operations" | fb#1, fb#76 | ⬜ | P1 |
| Trace a reference image | Place an image (local file or data URL) as a locked, semi-transparent reference under a frame; `render_screenshot` with a `compare` image side by side | fb#78 | ⬜ | P2 |
| Lint that points at what matters | Group `lint_design` results by rule (counts + first N ids), `minSeverity`, per-node `lintIgnore`; new rules: row/column children wider than the frame, geometry (siblings that don't touch, gaps under 4 px, fully hidden shapes) | fb#6, fb#9, fb#69, fb#70 | 🟡 | P2 |
| Agents edit path points | `edit_path` (anchor index + new position, handles) over the canvas helpers, and anchors listed in `path_info` | fb#17, fb#43 | 🟡 | P2 |
| Duplicate with changes | `duplicate_nodes` with `scale` and overrides (for example `mode: "dark"` for a light/dark pair) | fb#3, fb#45 | ⬜ | P2 |
| Work on another workspace without moving the human | Optional `workspace` on the read tools (outline, nodes, screenshot); the active workspace id in the outline's first line and in write results; one `History` per workspace for the life of the process | fb#52, fb#53, fb#54 | ⬜ | P2 |
| Z-order without an extra call | `index` or `"front"`/`"back"` in `update_nodes` props; pairs with P "Layer order" (canvas shortcuts) | fb#77 | ⬜ | P2 |
| Screenshots agents can rely on | Detect a missing browser at startup and return the fix command; optional `path` or a download URL on `render_screenshot`; report the active renderer in the WebSocket hello and the outline (the screenshot stays on the HTML path) | fb#5, fb#24, fb#27, fb#28, fb#79 | 🟡 | P2 |
| Safer deletes | Two-step `delete_workspace` (first call returns what would be lost and a token); a trash or activity log for workspace operations; a canvas notice when an agent deletes or switches the workspace | fb#59, fb#60, fb#61 | ⬜ | P2 |
| Nested components | Instances inside components, overrides addressed by path (`instance/copy`) | fb#39 | ⬜ | P2 |
| Import fidelity | `import_svg`: `<use>`/`<symbol>` sprites and `<text>` as `text` nodes; `import_html`: an option that renders in the server's Chromium and imports computed styles | fb#40, fb#42 | ⬜ | P2 |
| Web semantics in the document | `href` on frames and text (exported as `<a>`), responsive roots (`minWidth`/`maxWidth` or breakpoint variants), `decorative` images, document-level image assets | fb#30, fb#31, fb#32, fb#33 | ⬜ | P2 |
| Diagram routing around shapes | Obstacle-aware elbow routes, or `relayout` on `draw_diagram` for existing ids | fb#58 | ⬜ | P2 |
| Contract cleanups for the next breaking version | Text and `structuredContent` as the same object; `historyLabel` with `label` as an alias; unknown session ids answer 404 so clients re-initialize; one actor name in both transports | fb#22, fb#48, fb#50, fb#74 | 🟡 | P3 |
| Small conveniences | `pageId` default on `create_nodes` (the page the human sees); typed size tokens scaled by `scale`; `resolve` on `get_nodes`; read-only `sql_query`; open batch shown in the activity list; one UI language (or a setting); live cover and cover in export; normalized examples; edited paths as "ignore layout" children (A) | fb#21, fb#23, fb#36, fb#38, fb#44, fb#46, fb#49, fb#51, fb#63, fb#64 | ⬜ | P3 |

Already covered by shipped work, to mark "Done" in the log: fb#8 and fb#16 (`group` node), fb#13 (pages; auto-stacking top-level frames is still open, see A).
