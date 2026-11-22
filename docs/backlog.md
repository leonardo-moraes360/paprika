🇺🇸 English | [🇧🇷 Português](pt-BR/backlog.md)

# Feature backlog

Imported on 2026-11-21 from a capability list the maintainer collected from public sources about design tools built for AI agents. Work starts after the Go server and the WASM canvas evaluation are done.

**Originality rule.** The list is a reference for *capabilities*, not a spec to copy. Paprika keeps its own name, brand, look, document format, tool names and keyboard map. It doesn't copy proprietary fonts, assets or product names, and nothing here is reverse-engineered (see the invariant in `.toolbelt/invariants.yaml`).

Status: ✅ done · 🟡 partial · ⬜ missing. Priority: **P1** next slice · **P2** after · **P3** later · **Out** out of scope for a local tool.
`fb#N` points to an item in the [agent feedback log](agent-feedback.md).

## Batches

Batch 1 (the six items below) shipped on 2026-11-21 (PRs #16–#32), batch 2 on 2026-11-22 (PRs #71–#77). Batch 3 is on the local tb bus (`docs/agent-bus.md`, channel `paprika`): its ids (PAP-A-001…003 for cloud threads, PAP-B-013…026 for bus workers) are written in the rows they cover. "Batch 4" marks what was left for the next one. Rows with no batch are not planned yet.

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
| Z-order (forward, backward, front, back) | `update_nodes`/`move_nodes` take `index`: a number from 0, or `front`/`back`/`forward`/`backward`, one undo step (2026-11-22). Canvas: `Page Up`/`Page Down` step, `Ctrl+Page Up`/`Ctrl+Page Down` front/back; inspector **Ordem** section (2026-11-22, PAP-B-021). | ✅ | — |
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
| Drag and drop elements in the canvas | Reading recorded on 2026-11-22 (the request only says "drag and drop the elements inside the canvas"): (1) drag a node to move it **and reparent it**: dropping it inside a frame or group, or onto another layer, makes that its parent, and inside an auto-layout frame the drop point picks its position among the children; (2) drop external files (images, SVG, HTML) from the OS onto the canvas, using the import row in G. Canvas drop uses `move`/`create` through `applyOps` (one undo); auto-layout shows an insertion marker; Layers rows drag to reorder/reparent; OS files import as image (data URI), SVG or HTML. MCP already reparents with `move_nodes` (`parentId`, `index`). Relates to A "Z-order", B "Duplicate by modifier-drag", O "Re-attach or detach an arrow end by dragging". Requested 2026-11-22. Batch 4. | ✅ | PAP-B-049 |
| Resize handles on all four corners | Four corner handles on the selection (`apps/web/src/Canvas.tsx`); dragging a corner keeps the opposite corner in place (2026-11-22). Relates to B "Rotation-aware hit testing and handles". Batch 3: PAP-B-029. | ✅ | — |
| Aspect-ratio lock shortcuts while resizing, with a visual hint | Four-corner resize keeps the opposite corner fixed. `Shift` keeps the current ratio (the larger drag axis leads); `Shift+Alt` locks 1:1; a canvas hint names the active lock. Documented in `docs/canvas.md`. Batch 4: PAP-B-042. | ✅ | — |
| Preview of the element itself while drawing it, not only its area | While dragging a creation tool, `apps/web/src/Canvas.tsx` paints a semi-transparent ghost with the same `nodeStyle` defaults as the final node (`aria-hidden`, `pointer-events: none`); a plain click shows the default-size ghost before release. No document write until pointer up. Connector arrow ghost still open. Batch 4: PAP-B-043 (2026-11-22). | ✅ | — |

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
| Several border types for elements | `stroke` has optional `style` (`solid`\|`dashed`\|`dotted`, dash from width) and `position` (`inside`\|`center`\|`outside`) for frame/rect/ellipse/path/shape; inspector Estilo/Posição; WASM falls back to DOM when non-default. Per-side borders still out. (2026-11-22, PAP-B-044). | ✅ | — |
| Custom color picker | Custom popover (SV, hue/alpha, hex/rgb, document token swatches → `$token`, recent colors, keyboard). Replaces the native color input (2026-11-22, PAP-B-023). | ✅ | — |

## D. Typography

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Font family, size, weight, line height, letter spacing, alignment | `text` node | ✅ | — |
| Rich text (style per character/word, editable by agents) | One style per node | ⬜ | P2 |
| Font tokens (family, weight, size, line height, letter spacing) | Size tokens only | 🟡 | P2 |
| Variable font axes and OpenType features | — | ⬜ | P3 |
| Text shortcuts (bold, italic, size/weight steps), auto line height | — | ⬜ | P3 |
| CJK word-keep, combining marks, multi-codepoint emoji checks | Browser default | 🟡 | P3 |
| System fonts on any element with text | A font picker that lists the fonts installed on the machine (e.g. Local Font Access API, with a fallback list) for `text`, `shape` and every node that has `fontFamily`. Today `fontFamily` is a free text field. Relates to D "Font tokens". Requested 2026-11-22. Batch 4: PAP-B-047 — inspector **Fonte** on `text` is a shadcn combobox (`FontPicker`): common stacks + fonts already in the document; Local Font Access API only on **Usar fontes do sistema…** (never at load); custom typing still commits; list rows preview in their face. Shape / other `fontFamily` call sites later. | 🟡 | TBD |
| Import and export fonts in several formats | E.g. TTF, OTF, WOFF, WOFF2: fonts embedded in the workspace (as assets) and carried in exports (`@font-face` in HTML/CSS, embedded in SVG/PDF). Also over MCP. Respect each font's license when embedding. Relates to the export rows in J. Requested 2026-11-22. Batch 4. | ⬜ | TBD |

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
| Design system as a concept in the canvas | A place for the workspace's tokens, components and rules that agents and people draw from (relates to E and H). Requested 2026-11-22. Batch 4. | ⬜ | TBD |

## F. Vector

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Vector node from SVG path data (lines, bezier, arcs) | `path` node, `path_info` | ✅ | — |
| Pen tool to create paths | `P`, bezier handles, close on first point | ✅ | — |
| Edit points and handles of an existing path | Double-click a path: drag points and handles, add, remove, corner/smooth (2026-11-21); `d` in the inspector | ✅ | — |
| Import/paste SVG as editable `path` layers | `import_svg`, `Ctrl+V` in the canvas (2026-11-21): paths, shapes (axis-aligned rect/ellipse stay native), groups, transforms, inherited paint; no text, images, gradients or `<style>` CSS | ✅ | — |
| Boolean operations (union, subtract, intersect, exclude) | — (fb#1, fb#76; see Q). Batch 3: PAP-A-003 — MCP `combine_paths` + core op (canvas command later). | ✅ | P1 |
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
| Import PNG, JPEG, WebP, AVIF, GIF, `.fig` and other formats, besides SVG and HTML | Also as MCP tools. Extends G: today only SVG and HTML are imported (`import_svg`/`import_html`, `Ctrl+V`) and an `image` node is created only over MCP (G, "Paste or drop images"). Raster files become `image` nodes (data URI or local asset; decide whether animated GIFs keep moving). Dropping files on the canvas is in B, "Drag and drop elements in the canvas". **`.fig` is out** (maintainer, 2026-11-22): it is an undocumented proprietary format and reading it would mean reverse engineering, which the originality rule forbids; files from that tool come in through their SVG/PDF exports, as G already does for other design tools' clipboards. "etc." in the request: other formats (e.g. PDF) to be listed when planned. Requested 2026-11-22. Batch 3: PAP-B-019 (`import_image` for the raster formats; animated GIF/WebP/AVIF kept); other formats in batch 4. | 🟡 | PAP-B-019 |

## H. Components and reuse

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Components and instances with overrides and `scale` | `component`/`instanceOf`/`scale`/`overrides` on frames, `create_component`, `create_instance`, `detach_instance` (2026-11-21); no nested instances yet | ✅ | — |
| Component props and slots | — | ⬜ | P2 |
| Code components (render real components from the user's repo) | — | ⬜ | P3 |
| Icon packs / UI kit starters | — | ⬜ | P3 |
| Components reusable across pages and across workspaces | Today `component`/`instanceOf` only work inside one document (H); missing: a library shared by workspaces, instances that point to another workspace, and how updates reach them. Requested 2026-11-22. Batch 4. | ⬜ | TBD |

## I. Agent layer (MCP and CLI)

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Embedded MCP server (stdio + HTTP), read and write, CLI | `paprika serve`/`mcp`, 32 tools (contract `server-go/contract/mcp.json`) | ✅ | — |
| Server CLI on [Cobra](https://cobra.dev/) (`github.com/spf13/cobra`) | Today `server-go/cmd/paprika/main.go` parses by hand: a `switch` on the first argument (`serve`, `mcp`, `import`, `export`, `list`, `help`, `version`) and one shared `flag.FlagSet` with every flag of every command, a loop so flags may come before or after positionals, and a hand-written help text (pt-BR). With Cobra each command declares its own flags and help, gets `paprika <cmd> --help`, shell completion and suggestions for typos; flags, `$PAPRIKA_DB`/`$PAPRIKA_WEB_ROOT` and exit codes stay the same. Fits the i18n row (help text in the chosen language) and room for future commands such as `team`. Requested 2026-11-22. Batch 3: PAP-B-035. Done in PAP-B-035: one Cobra command per subcommand (`serve`, `mcp`, `import`, `export`, `list`, `version`) with its own flags and `--help`, `paprika completion bash|zsh|fish` and typo suggestions; flags, defaults, environment variables and exit codes are locked by golden and parsing tests. | ✅ | — |
| HTTP and MCP layer on [Gin](https://gin-gonic.com/) (`github.com/gin-gonic/gin`) | Gin route groups for `/api`, team, `/mcp`, `/ws` and the static canvas; Host/Origin + panic recovery as middleware; `/ws` keeps `coder/websocket`; MCP protocol and stdio stay outside Gin. Contract unchanged (PAP-B-036). | ✅ | — |
| Token-efficient reads | `get_document_outline` | ✅ | — |
| Structured results (`outputSchema` + `structuredContent`) | Every JSON tool declares `outputSchema` and returns `structuredContent` (2026-11-21) | ✅ | — |
| Guide and errors in English (pt-BR optional) | Guide, tool descriptions, errors, warnings and lint in English; `get_design_guide {language: "pt-BR"}` (2026-11-21). The canvas UI is still pt-BR | ✅ | — |
| Group several writes into one undo step | `batch` on every write tool (2026-11-21) | ✅ | — |
| Actor name from MCP `clientInfo` | `agent:<clientInfo.name>` on stdio and HTTP (session id carries the name) (2026-11-21) | ✅ | — |
| Agent presence on the canvas (cursor, what it is editing) | Own cursor, outline, name and color per agent session, roster; implicit from every tool call (2026-11-21) | ✅ | — |
| Move a board between Paprika servers | `paprika export --root ID` writes one frame plus the components and tokens it needs as a standalone `.paprika.json`; MCP `import_document` stores it as a new workspace without switching the active one, and `create_nodes` tolerates a connector's derived fields with a warning (2026-11-22) | ✅ | — |
| Comments for humans and agents (create, resolve, filter) | `notes` field only | 🟡 | P2 |
| Manage files via MCP (list, create, open, rename, archive), several files at once | Workspaces over MCP: `list_workspaces`, `create_workspace`, `open_workspace`, `rename_workspace`, `delete_workspace` (2026-11-21, see M); missing: archive, and reading another workspace without switching the active one (Q "Work on another workspace without moving the human") | 🟡 | P2 |
| "Connect your agent" panel with ready configs per client | README snippets | 🟡 | P2 |
| Geometry help for agents (rotated bounds, origin, geometry lint) | `path_info` only (fb#2, fb#6) | 🟡 | P2 |
| Visual diff between versions (for CI) | — | ⬜ | P3 |
| Remote MCP (server outside the user's machine) | Local by design | ⬜ | Out |
| Assisted adversarial verification in the canvas | Port to Rust or Go. Prove with numbers that each app screen matches the approved board, light and dark: a generator tunes the app until pixel similarity reaches ≥ 95 % per screen and mode, and an independent discriminator redoes the build, references, captures and comparison and fails it on score, cheating (edited references, unjustified masks, comparator changes), regression or contrast; at most 3 rounds, then a human decides. Pieces to port: comparator (pixelmatch, threshold 0.1, magenta padding on size mismatch, masks with a reason), references rendered from the boards, capture, contrast gate, cheat guard. Spec supplied by the maintainer (TS/Playwright harness from another project). Requested 2026-11-22. Batch 3: PAP-B-018 (image comparator in Go, first piece). | ⬜ | TBD |

## J. Export and handoff

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Standalone HTML, React (inline styles), PNG | `export_code`, `render_screenshot` | ✅ | — |
| SVG export (frame or selection) | `export_code` format `svg`, `⇩` in the toolbar, `GET /api/svg` (2026-11-22, PAP-A-002): boxes from core `layout(doc)`, no headless Chromium; text splits on `\n` (glyph wrap stays approximate); gradients and background images are left out | ✅ | — |
| Video export of animated frames | — | ⬜ | P3 |
| Export to PDF, HTML, CSS (Tailwind or CSS Modules), React, Angular or Svelte | Also as MCP tools. Extends J (today: HTML, React with inline styles, SVG). Requested 2026-11-22. Batch 3: PAP-B-016 ✅ (`export_code` formats `tailwind`, `tailwind-html` and `css-modules`, built from `nodeStyle`; the Tailwind page renders like the HTML export within 1% on the example boards, checked in Chromium against a Tailwind v4 build); Batch 4: PAP-B-041 ✅ (`angular` standalone `.ts`+template+styles and `svelte` single file; static markup of both matches the HTML export within 1% on the example boards); PDF: PAP-B-050 ✅ (`export_image` format `pdf`, vector from the same ExportSVG path, no Chromium). Replaces the older rows "Tailwind classes export" and "React + CSS module / CSS variables" (CSS variables are done, see E). | 🟡 | P2 |
| Export to SVG, PNG, JPEG, AVIF, WebP | Also as MCP tools. **No headless Chromium**: in the canvas (TS) or in the Go server. SVG: PAP-A-002 ✅ (`export_code`/`GET /api/svg` from `layout(doc)`). Raster + PDF: PAP-B-050 ✅ (`export_image` formats `png`/`jpeg`/`webp`/`avif`/`pdf` in pure Go from ExportSVG; ≥98% visualdiff vs `render_screenshot` on the example boards). Requested 2026-11-22. Replaces the older row "WebP/AVIF, PDF". | ✅ | PAP-B-050 |
| Resize images to qHD ("semi HD"), HD, 2K, 4K | Also as MCP tools. **No headless Chromium**: in the canvas (TS) or in the Go server. Requested 2026-11-22. Batch 4. | ✅ | PAP-B-040 |

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
| Multiplayer LLM chat in the canvas | Floating, centered at the bottom of the canvas; shared by the people (and agents) of the workspace. Requested 2026-11-22. Batch 4. | ⬜ | TBD |

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

Not from SonarCloud: simplifications that `gopls` suggests in the editor (screenshot from the maintainer, 2026-11-22).

| Rule | Impact | Where | Fix | Status | Pri. |
|---|---|---|---|---|---|
| gopls `modernize` hints, e.g. `errorsastype` ("errors.As can be simplified using AsType[usageError]") | Maintainability | `server-go`: 6 `errors.As` calls (`cmd/paprika/main.go`, `internal/server/http.go`, `internal/server/mcp.go`, `internal/core/ops.go`) plus whatever else the analyzer flags | Run `modernize -fix ./...` (golang.org/x/tools) across `server-go` and review the diff (`go.mod` is already `go 1.26.0`, which `errors.AsType` needs). Then enable the `modernize` linter in `server-go/.golangci.yml` so CI (`go-lint`, golangci-lint v2.15.0) keeps it clean. Keep math rewrites out, like the `-QF*` exclusion, to keep parity with the TypeScript core. Requested 2026-11-22. Not in a batch yet. | ✅ | — |

## O. Diagrams

Simple diagrams (flowcharts, architecture sketches, mind maps) drawn by the human on the canvas or by an agent over MCP. Excalidraw and Whimsical are references for the kind of feature only; the look follows Paprika's own theme.

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Shapes with text inside (box, ellipse, diamond) and sticky notes | `shape` node, `S`/`D`/`N` tools, text edited in place (2026-11-21) | ✅ | — |
| Arrows that stick to shapes and follow them, straight or elbow | `connector` node, `A` tool, geometry derived from the ends (2026-11-21) | ✅ | — |
| Agent draws a whole diagram in one call, with automatic layout | `draw_diagram` (2026-11-21) | ✅ | — |
| Labels on arrows | `label` on `connector` and on `draw_diagram` edges, drawn at the middle of the line with a halo, edited in the inspector (2026-11-22, fb#57) | ✅ | — |
| Arrows that route around other shapes | Elbow routes ignore obstacles | ⬜ | P2 |
| More shapes (cylinder, parallelogram, cloud) | — (curved arrows: see "Three arrow line styles" below; triangle below) | ⬜ | P2 |
| Re-attach or detach an arrow end by dragging it on the canvas | Inspector only | ⬜ | P2 |
| Hand-drawn style | — | ⬜ | P3 |
| Three arrow line styles: square, rounded, free curve | Reading recorded on 2026-11-22 (screenshot from the maintainer shows today's elbow arrow): (1) square corners, what `route: "elbow"` draws today (`route: "straight"` also exists); (2) rounded, the same elbow route with rounded corners; (3) free curve, a bezier whose handle can be dragged on the canvas to shape it. Also over MCP and in the inspector. Takes over the curved arrows of the old O row "Curved arrows and more shapes" and relates to O "Re-attach or detach an arrow end by dragging" and F point editing. Requested 2026-11-22. Batch 4. | ⬜ | TBD |
| Double-click an arrow to add, edit or remove its label | Double-click an arrow on the canvas opens an input at the middle of its route (`ConnectorLabelEditor`), like shape text: Enter or blur commits through `applyOps`, Esc cancels, clearing the text removes the label (one undo step; straight and elbow routes, inside frames too). Requested 2026-11-22. Batch 3: PAP-B-028. | ✅ | — |
| Triangle as a simple shape | New `ShapeKind` next to `rect`, `ellipse`, `diamond`, `note` (O), with a toolbar tool, in the inspector shape picker and over MCP (`draw_diagram` too). Requested 2026-11-22. Batch 3: PAP-A-004. **Done (PAP-A-004):** `triangle` in schema (TS+Go), outline/connectors via `diagram`, toolbar `G`, inspector picker, `draw_diagram`. | ✅ | — |

## P. Maintainer requests (2026-11-22)

The maintainer's requests of 2026-11-22 were moved on 2026-11-22 into the thematic sections (A, B, C, D, E, G, H, I, J, M, O) and the new sections R (app interface) and S (releases); each moved row says "Requested 2026-11-22". The constraints in each row are part of the request.

## Q. From the agent feedback log (2026-11-22)

Every item still open in the [agent feedback log](agent-feedback.md) (fb#1 to fb#79), grouped into implementation work. Each row names the feedback it closes; when a row ships, mark those `fb#` items "Done" in the log. Priorities come from the log, raised where several agents hit the same wall.

| Work item | What to build | Feedback | Status | Pri. |
|---|---|---|---|---|
| Move a board between Paprika servers | `import_document` (a `.paprika.json` in, a new workspace out, without switching the active one); `paprika export --root <id>` for one frame; `create_nodes` ignores derived connector fields instead of refusing them Batch 3: PAP-B-013. | fb#72, fb#75 | ⬜ | P1 |
| Core geometry: absolute boxes for agents | A core `layout(doc)` returning absolute boxes (Go port held by fixtures), a `get_bounds` tool with rotated corners, an `origin` field, and `normalize` on path create (or the offset in `path_info`); the core export uses the same boxes, so SVG of auto-layout nodes needs no browser Batch 3: PAP-A-001. | fb#2, fb#15, fb#26, fb#41 | ✅ | P1 |
| Boolean operations and cut-outs | `union`/`subtract`/`intersect`/`exclude` producing a new `path` (MCP op + canvas command), or a `mask` on `group`; same item as F "Boolean operations" Batch 3: PAP-A-003 — MCP `combine_paths` done; canvas command still open. | fb#1, fb#76 | ✅ | P1 |
| Trace a reference image | Place an image (local file or data URL) as a locked, semi-transparent reference under a frame; `render_screenshot` with a `compare` image side by side | fb#78 | ⬜ | P2 |
| Lint that points at what matters | Group `lint_design` results by rule (counts + first N ids), `minSeverity`, per-node `lintIgnore`; new rules: row/column children wider than the frame, geometry (siblings that don't touch, gaps under 4 px, fully hidden shapes) | fb#6, fb#9, fb#69, fb#70 | 🟡 | P2 |
| Agents edit path points | `edit_path` (anchor index + new position, handles) over the canvas helpers, and anchors listed in `path_info` | fb#17, fb#43 | 🟡 | P2 |
| Duplicate with changes | `duplicate_nodes` with `scale` and overrides (for example `mode: "dark"` for a light/dark pair). `duplicate_nodes {ids, offset?, parentId?, scale?, props?}` copies the whole subtree in one undo step, keeps instances as instances of the same component, re-points connectors between duplicated nodes to the copies and returns `copies` and `map` (2026-11-22, PAP-B-017). Batch 3: PAP-B-017. | fb#3, fb#45 | ✅ | — |
| Work on another workspace without moving the human | Optional `workspace` on the read tools (outline, nodes, screenshot); the active workspace id in the outline's first line and in write results; one `History` per workspace for the life of the process | fb#52, fb#53, fb#54 | ⬜ | P2 |
| Z-order without an extra call | `index` as a number or `front`/`back`/`forward`/`backward` in `update_nodes` props and `move_nodes` (2026-11-22, PAP-B-014); canvas shortcuts in A "Z-order" | fb#77 | ✅ | — |
| Agents place and layer elements on purpose (no boards on top of each other, no text above a modal) | Seen 2026-11-22 (screenshot from the maintainer): agents created the light/dark frames of PAP-A-004 and PAP-B-032 at overlapping positions, so one board hides the other. Today nothing steers placement: the design guide (`server-go/contract/mcp.json` `instructions`, `contract/guide.pt-BR.md`) covers `x`/`y` and layout but says nothing about where a new top-level frame goes, and no tool or lint warns about overlap. Fix over MCP: (1) a placement rule in the guide and in the `create_nodes`/`duplicate_nodes` descriptions: a new top-level frame goes in free space (to the right of or below what is on the page, with a gap), check `get_bounds`/`get_document_outline` first, and stack on purpose only (z-order via `index`); (2) a `warnings` entry in the write result when a new top-level node overlaps another one on the same page, with the free spot nearest to it; (3) maybe a `lint_design` rule for overlapping top-level frames, and an optional `place: "auto"` on `create_nodes` that picks the free spot itself. Second case, inside a frame (screenshot from the maintainer, 2026-11-22, PAP-B-031): an agent drew a delete modal over the workspace cards, but the cards' texts ("L", "Landing page", "Sistema de ícones") sit later in the layer order and show on top of the modal. Add a check for it: a `lint_design` rule (e.g. `covered-by-overlay`, next to `overflow` and `contrast`) and a `warnings` entry in write results when a `text` node is painted above an opaque node that overlaps it and should cover it (a modal or overlay: an opaque frame placed over other content); the warning names both nodes and the fix (`index: "front"` on the overlay, or move the texts under it). Guide rule: draw overlays (modals, menus, toasts) last, or move them to the front with `index`. Other overlap inside a frame (layout children) is not touched. Requested 2026-11-22. Not in a batch yet. | — | ⬜ | TBD |
| Screenshots agents can rely on | Detect a missing browser at startup and return the fix command; optional `path` or a download URL on `render_screenshot`; report the active renderer in the WebSocket hello and the outline (the screenshot stays on the HTML path) | fb#5, fb#24, fb#27, fb#28, fb#79 | 🟡 | P2 |
| Safer deletes | The MCP half landed 2026-11-22 (PAP-B-015): `delete_workspace` is two calls — the first returns what would be lost and a short-lived token bound to the workspace, the second deletes — and workspace operations (create/rename/open/delete, with the actor) are readable over `list_workspace_ops`, a delete entry keeping its summary. Canvas notice landed with PAP-B-037: WebSocket `workspaceOp` broadcast + `WorkspaceNotice` (actor, counts, overview action; `role=status`). | fb#59, fb#60, fb#61 | ✅ | — |
| Nested components | Instances inside components, overrides addressed by path (`instance/copy`) | fb#39 | ⬜ | P2 |
| Import fidelity | `import_svg`: `<use>`/`<symbol>` sprites and `<text>` as `text` nodes; `import_html`: an option that renders in the server's Chromium and imports computed styles | fb#40, fb#42 | ⬜ | P2 |
| Web semantics in the document | `href` on frames and text (exported as `<a>`), responsive roots (`minWidth`/`maxWidth` or breakpoint variants), `decorative` images, document-level image assets | fb#30, fb#31, fb#32, fb#33 | ⬜ | P2 |
| Diagram routing around shapes | Obstacle-aware elbow routes, or `relayout` on `draw_diagram` for existing ids | fb#58 | ⬜ | P2 |
| Contract cleanups for the next breaking version | Text and `structuredContent` as the same object; `historyLabel` with `label` as an alias; unknown session ids answer 404 so clients re-initialize; one actor name in both transports | fb#22, fb#48, fb#50, fb#74 | 🟡 | P3 |
| Small conveniences | `pageId` default on `create_nodes` (the page the human sees); typed size tokens scaled by `scale`; `resolve` on `get_nodes`; read-only `sql_query`; open batch shown in the activity list; one UI language (or a setting); live cover and cover in export; normalized examples; edited paths as "ignore layout" children (A) | fb#21, fb#23, fb#36, fb#38, fb#44, fb#46, fb#49, fb#51, fb#63, fb#64 | ⬜ | P3 |
| Write results agents can use as-is | `create_nodes`, `duplicate_nodes` and imports return `{ids, roots, created}` (`ids` keeps the old id list; `roots` is `{id, name, type, x, y, width, height}` for each new node whose parent was not created in the call; `created` is `{id, name, type, parentId}` for every new node) and one readable text line per root. `create_page` with `ensure: true` returns the existing page of that name. **Done (PAP-B-064).** | fb#91, fb#99 | ✅ | — |

Already covered by shipped work, to mark "Done" in the log: fb#8 and fb#16 (`group` node), fb#13 (pages; auto-stacking top-level frames is still open, see A).

## R. App interface (shell, panels, inspector)

The editor's own interface, apart from what is drawn on the canvas. Every row here is a UI change: draw it in a local Paprika over MCP first (AGENTS rule 6, design-first).

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| Bug: the first page of a workspace cannot be renamed while it is the only one | Cause found: a workspace without pages shows a placeholder "Página 1" row (`apps/web/src/Pages.tsx`) that is not a real page node, so double-click does nothing; renaming it should create the page and name it. Requested 2026-11-22. Batch 3: PAP-B-020. **Done (PAP-B-020):** double-click or F2 on the placeholder opens the inline rename; committing creates the page with that name, moves the content into it and opens it, in one undo step. | ✅ | — |
| Bug: numeric fields accept non-numeric text | Screenshot from the maintainer: "Opacidade" shows `1aaaaa`. Cause: `Field` with `type="number"` renders a text `<input>` with only `inputMode="decimal"` (`apps/web/src/Inspector.tsx`), and `setNum` silently drops a value that does not parse. Numeric fields should refuse non-numeric input (and say why when a pasted value is rejected). Requested 2026-11-22. Batch 3: PAP-B-027. **Done (PAP-B-027):** `numericInput.ts` filters typing (comma as decimal), rejects bad paste with `aria-live` / `aria-invalid`, and **clamps** out-of-range values (opacity `2` → `1`) with a message that includes the range (`Use um número entre 0 e 1.`). Size fields still accept `hug`/`fill`; token text fields unchanged. | ✅ | — |
| Compact inspector | Today it is one long scroll area with a lot of information. Requested 2026-11-22. Batch 3: PAP-B-022. **Done (PAP-B-022):** collapsible inspector sections with `aria-expanded`, two-column numerics, and `localStorage` for open state; default collapsed sections cut `#right-tabpanel` height ~60% for a selected text node (1440×900, `packages/e2e/b022-measure.mjs`). Boards in `docs/assets/boards/PAP-B-022/`. | ✅ | — |
| `+` and `−` buttons on every purely numeric field | A stepper in the inspector for fields such as opacity, weight, stroke width and position; fields that accept tokens (`$name`) or text keep a plain input. Relates to B "Configurable nudge step". Requested 2026-11-22. Batch 4: PAP-B-046. **Done (PAP-B-046):** `±` on pure numeric `Field`s (opacity step 0.05, weight 100, else 1; Shift×10; ArrowUp/Down); hug/fill and token/text stay plain; reuses PAP-B-027 clamp/ranges. Boards in `docs/assets/boards/PAP-B-046/`. | ✅ | — |
| Better-looking activity history | Today it is a block of poorly formatted information. Requested 2026-11-22. Batch 3: PAP-B-025. **Done (PAP-B-025):** `Activity.tsx` rows with actor color+name, action, relative time, batch grouping, undo/redo "agora" marker; long labels truncate with `aria-label`; boards in `docs/assets/boards/PAP-B-025/`. | ✅ | — |
| Side panels collapse into a floating button when shrunk past their minimum | Top-left or top-right corner; clicking the button expands that panel. Dragging a panel more than 32px below its minimum (or pressing the shrink arrow on its handle while it sits at the minimum) collapses it; the button restores the width it had before the drag, and each panel's state is remembered in `localStorage` (`paprika.panel.left.collapsed`, `paprika.panel.right.collapsed`) (2026-11-22). Requested 2026-11-22. Batch 3: PAP-B-024. | ✅ | — |
| Drag the toolbar and dock it left, top, right or bottom | Drag the grip (or pick a side in the toolbar menu) to dock left/top/right/bottom; left/right go vertical; side remembered in `localStorage` (`paprika.toolbar.dock`). Collapsed-panel buttons from PAP-B-024 shift past the bar when they share an edge. Requested 2026-11-22. Batch 4: PAP-B-048. | ✅ | — |
| Destructive actions | A danger palette (`--color-danger*`, apart from the brand red) behind the `destructive` button, `ui.dangerBtn` for the row-level delete/remove triggers, and one `ConfirmDialog` on the alert-dialog primitive (names what is lost, focus on Cancel, Esc cancels, typed name for a workspace delete) used by the overview delete and the team remove-member dialog (2026-11-22). The canvas notice when an agent deletes or switches the workspace stays in Q "Safer deletes", waiting for PAP-B-015. Batch 3: PAP-B-026. | ✅ | — |
| Turn `title` attributes into accessible tooltips | Follows the accessibility review ([thread "Revisar acessibilidade do Paprika"](https://claude.ai/code/project/chan_01QGCFibNVKw2MsxBcqe4Jmi?thread=cmsg_01QGCFibNVKw2MsxBcqe4Jmi1MtFJYQ4HiNMD17jXKGUrG), PR #70). Requested 2026-11-22. Batch 4: PAP-B-051. **Done (PAP-B-051):** every HTML `title` in `apps/web` replaced with shadcn/`Hint` Tooltip (hover+focus, Esc dismisses); icon buttons keep `aria-label`; `TooltipProvider` at app root; a11y E2E covers zoom + toolbar. Boards in `docs/assets/boards/PAP-B-051/`. | ✅ | — |
| Internationalization (i18n) | Reading recorded on 2026-11-22 (the request only says "add i18n"): translate the web app UI, at least English and pt-BR to match the bilingual docs, with a way to pick the language. Today the canvas UI, HTTP API messages and default names ("Página 1") are pt-BR only (I, "Guide and errors in English"); the agent-facing text is English with `get_design_guide {language: "pt-BR"}`, and the site already has en and pt-BR pages. Decided (maintainer, 2026-11-22): the UI and default names ("Página 1" / "Page 1") follow the chosen language; HTTP API messages move to English, like MCP. Still open: which languages come after en and pt-BR. Requested 2026-11-22. Batch 4. | ⬜ | TBD |
| Migrate the UI to shadcn components | Keep Paprika's own theme (ADR 0003, Tailwind without Preflight); how it fits: [ADR 0005](adr/0005-shadcn-ui.md). Requested 2026-11-22. Batch 3: PAP-B-030 ✅ in main (foundation: primitives copied into `apps/web/src/components/ui/` on `ui-*` tokens, gallery on `/ui`, `ConnectionStatus` migrated); PAP-B-034 ✅ (team panel); PAP-B-031 ✅ (overview and dialogs); PAP-B-032 ✅ (inspector: `Field`/`ModeField`/`SelectField` on `Input`+`Label`+`Textarea`+`Select`, sections on `Collapsible`, actions on `Button`; compact density from B-022 kept); remaining: PAP-B-033 shell/toolbar/layers/pages. | 🟡 | TBD |
| Migrate the UI to shadcn components | Keep Paprika's own theme (ADR 0003, Tailwind without Preflight); how it fits: [ADR 0005](adr/0005-shadcn-ui.md). Requested 2026-11-22. Batch 3: PAP-B-030 ✅ in main (foundation: primitives copied into `apps/web/src/components/ui/` on `ui-*` tokens, gallery on `/ui`, `ConnectionStatus` migrated); PAP-B-034 ✅ (team panel); PAP-B-031 ✅ (overview and dialogs); PAP-B-033 ✅ (shell, floating toolbar on `ToggleGroup`+`Tooltip`, layers/pages/`InlineName`/`PanelResizer`/floating panel buttons, zoom strip in `Canvas`; `ui.iconBtn` freed; `statusDotVariants` on the top bar); → PAP-B-032 inspector. Each phase waits for PAP-B-030 and for the batch-3 UI ticket on the same files. | 🟡 | TBD |
| Better on-screen animations with tailwind-animate | `tw-animate-css` 1.4.0 came in with PAP-B-030 (enter/exit utilities plus a scoped `prefers-reduced-motion` guard, used by the primitives), so part of this row is done; the app's own animations are still to do. Requested 2026-11-22. Batch 4. | 🟡 | TBD |
| Condensed agent roster | Seen 2026-11-22 (screenshot from the maintainer): with many agents the roster in the top-right corner of the canvas (`AgentCursors.tsx`, `data-testid="agent-roster"`) grows to 15+ pills, one per MCP session, with names numbered by session (`cursor-composer` to `cursor-composer 11`, `pap-b-051 2`, from `applyPresence` in `agents.ts`), and covers the canvas. Condense it: group sessions of the same client into one pill with a count (`cursor-composer ×11`) that expands on click or hover; show the busiest few (writing first, then reading) and a "+N" for the rest; fade idle sessions sooner than the 2-minute TTL; keep each session's color and cursor on the canvas. Respect the side panels (collapsed or not) and the toolbar docking row. Requested 2026-11-22. Not in a batch yet. | ⬜ | TBD |
| Bug: with many agents writing at once, the canvas goes blank (background only) | Seen 2026-11-22 (screenshot from the maintainer, `/w/<id>` at 19:30): the whole page shows only the dark background, no toolbar, panels or canvas. Not reproduced yet; what the code suggests: (1) the web app has no React error boundary (`apps/web/src/main.tsx` renders the tree with nothing around it), so any exception during a render unmounts the whole app and leaves only the body background, which matches the screenshot; (2) every write sends the whole document to every tab (`docMessage` in `server-go/internal/server/http.go`), and the tab parses it (`JSON.parse` in `useDocument.ts`) and re-renders the canvas each time, so many agents mean a burst of large messages on the main thread; the server drops messages for a slow client, and the next one carries the whole document again. Plan: reproduce with a script that runs N MCP sessions writing in parallel (e2e), read the browser console; add an error boundary that keeps the shell and shows the error with a reload button; batch incoming `doc` messages per animation frame (apply only the latest); later send patches instead of the whole document. Requested 2026-11-22. Not in a batch yet. | ⬜ | TBD |

## S. Releases and updates

From the maintainer's "OTA update?" question (2026-11-22): smaller steps first, full OTA only with a standalone binary or desktop app.

| Capability | Paprika today | Status | Pri. |
|---|---|---|---|
| New version notice in the app | Smaller first step of the OTA request (agreed with the maintainer on 2026-11-22). The app checks the GitHub releases and shows "a new version is available" with the update command (`git pull` + `docker compose up -d --build`). Needs published releases first: the repo has no tags or releases yet, and releases are cut by hand only when the maintainer asks, not on every merge (decided 2026-11-22); `paprika --version` already reports `server.Version`. Requested 2026-11-22. Batch 4. | ⬜ | TBD |
| Version check between team peers | The real risk today: two instances on different versions can diverge in the CRDT or in signed operations. The sidecar's ALPNs are versioned (`paprika/sync/1`, `paprika/join/1`), but peers do not compare app or document-format versions; the check should warn or refuse sync on an incompatible peer (M, "Real-time multi-user editing", ADR 0004). Requested 2026-11-22. Batch 4. | ✅ | PAP-B-039 |
| Full OTA update (signed download, rollback) | Future, only once there is a standalone binary or desktop app. Under Docker an update means replacing the image: a binary that replaces itself inside the container fights that and is lost on the next `up --build`. Depends on the two rows above and on published releases. Requested 2026-11-22. Batch 4. | ⬜ | TBD |
