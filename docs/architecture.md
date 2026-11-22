🇺🇸 English | [🇧🇷 Português](pt-BR/arquitetura.md)

# Architecture

```
 agent (Claude Code, Cursor…)              human (browser)
        │ MCP stdio | Streamable HTTP /mcp        │ WebSocket /ws
        ▼                                         ▼
 ┌──────────────────────── server-go (paprika) ────────────────┐
 │ MCP (JSON-RPC) ──┐                       ┌── HTTP API + /ws  │
 │                  ▼                       ▼                   │
 │        Store  (internal/core: applyOps + History, SQLite)    │
 └───────────────────────────┬─────────────────────────────────┘
                             ▼
                    paprika.db (SQLite) ── import/export ── design.paprika.json (git)

 ┌──────────────── @paprika/core (TypeScript) ─────────────────┐
 │ schema (zod) · applyOps (transaction) · History (undo/redo)  │
 │ nodeStyle → React canvas · renderHTML · exportReact          │
 │ lintDocument · outline/queryNodes      (reference for Go)    │
 └──────────────────────────────────────────────────────────────┘
```

## Decisions

1. **Flat node map + `children` on containers (`frame`, `group`, `page`).** O(1) access by id for the agent, an explicit tree for rendering. `parseDocument` checks integrity (no orphans, no duplicates, consistent `parentId`, pages only at the top and, once there is a page, only pages at the top).
2. **One write path: `applyOps`.** The canvas, MCP and `POST /api/ops` produce the same operations. A transaction runs on a clone and only replaces the document if every operation succeeds. Each transaction yields its inverse operations, which feed the shared undo/redo.
3. **Reject unknown fields.** Zod would drop them silently (`colour` instead of `color`); for agents, an explicit error is cheaper than a wrong design.
4. **One style engine.** `nodeStyle` produces the CSS used by the canvas, the screenshot HTML and the React export. What the agent checks in the PNG is what the human sees. For `path` nodes, `pathAttrs` plays the same role for the `<svg>`/`<path>` attributes, and `packages/core/src/path.ts` (parser, normalization, exact bezier/arc bounds) runs the same way on the server, in the canvas and in tests; invalid `d` is rejected with the character position.
5. **SQLite is the source of truth.** Documents, tokens and the undo/redo history live in SQLite ([ADR 0001](adr/0001-go-server-sqlite.md)); every change is one transaction committed before the answer. `.paprika.json` goes in and out only through `paprika import`/`export`.
6. **Stateless MCP over HTTP.** No per-connection server state to leak (the `Mcp-Session-Id` only carries the client name); state lives in the store. Write tools only reply after the change is committed.
7. **Local first.** Loopback bind with Host/Origin validation. No authentication or multi-user support in this version.
8. **Composite operations expand inside the transaction.** `group`, `ungroup` and `add_page` are operations too, but `applyOps` turns them into create/move/update/delete against the document *as it is at that moment* (`packages/core/src/structure.ts`), so a canvas or an agent working from a slightly old copy still gets a correct result and one undo step. A group's box is derived: at the end of every transaction `fitGroups` fits each group to its children (deepest first) and shifts them so nothing moves on screen; the inverse only stores positions, and `width`/`height` of a group are rejected as input.
9. **Instances are derived copies.** A component is a frame with `component: true`; an instance is a frame with `instanceOf`, an optional `scale` and `overrides` (by component node id, only `fill`, `color`, `text`, `src`, `alt`, `visible`, `opacity`; `fill` on the root). At the end of every transaction `syncInstances` (`packages/core/src/component.ts`) checks the rules and rebuilds each instance's children from the component, with deterministic ids (`copyId`, FNV-1a of instance + source id, the same in Go) and `sourceId` on each copy. Copies are ordinary nodes, so every renderer, export and lint works unchanged; because they are derived, undo never stores them: undoing the change to the component or instance and syncing again is enough. An `update` on a copy is turned into an override; moving, deleting or adding children inside an instance is rejected. `detach` turns an instance into a plain frame with the same ids.
10. **Import and SVG export are pure functions in the core; the browser only measures.** `importSVG` and `importHTML` (`packages/core/src/svgImport.ts`, `htmlImport.ts`, over a small tolerant reader in `markup.ts`) return `NodeInput` trees plus `warnings`, and the caller writes them with ordinary `create` ops, so pasting is one undo step and goes through the same validation. `importHTML` is the inverse of `nodeStyle`: HTML from `renderHTML` (which tags each element with `data-paprika-type`) comes back with the same types and fields. `exportSVG` builds the SVG from the document plus a `Measure` (boxes before rotation and laid-out text lines) that `MEASURE_SCRIPT` collects from the export HTML in Chromium, so auto layout, `hug`/`fill` and text wrapping match the screenshot without a layout engine in the core; the Go server embeds the same script (`server-go/contract/measure.js`).
11. **Agent presence is implicit and ephemeral.** Agents don't call a presence tool: every MCP tool call that reaches its handler reports `{agent, actor, tool, nodes}` to the store's `PresenceHub` (`server-go/internal/server/presence.go`), and `/ws` broadcasts it as `{type: "presence", agent, actor, tool, nodes, idle}`. `nodes` are the ids the call created or, if none, the ids named in its arguments (that still exist); `agent` is a hash of the HTTP `Mcp-Session-Id` (so two sessions of one client are two agents) or the actor on stdio. Presence never touches the document, the history or the disk; a canvas that connects gets each agent's last presence from the past 2 minutes right after the document. The canvas measures the nodes in the DOM (so auto layout and `hug` are right) and draws the cursor, outline and roster (`apps/web/src/AgentCursors.tsx`).

11. **Workspace = document, one active per server.** The overview lists the documents of the server's database. The `Store` keeps one active document; `openWorkspace` swaps it in place and emits a change with kind `open`, so the WebSocket, the HTTP API and every MCP tool follow without new plumbing. The canvas and the agents share the active workspace on purpose: the human watches what the agent edits. Undo history belongs to each workspace and is stored in SQLite, so it survives a switch. The active workspace is per process: a separate `paprika mcp` over stdio keeps its own.
12. **Diagram connectors are derived from their ends.** A `shape` node (rect, ellipse, diamond, triangle, note) is a box with text inside, painted by `shapeAttrs` (an `<svg>` outline behind the text, the same in canvas, screenshot, React and SVG export). A `connector` stores only its ends (`from`/`to`: a `nodeId` with an optional side, or a free `x`/`y` in the parent's coordinates), the route (straight or elbow) and its look; `x`, `y`, `width`, `height` and `d` are recomputed by `routeConnectors` (`packages/core/src/diagram.ts`) at the end of every transaction, after the instance sync, and are rejected as input. Like instance copies, that geometry stores no inverse. Ends are clipped to the shape's outline with only `sqrt` (no trigonometry), so the Go port gives the same numbers. Deleting a node deletes the connectors attached to it inside the same operation (undo brings both back), and a connector never counts in its group's box. `draw_diagram` is a pure function of the document (`diagramOps`): it ranks the shapes by longest path (back edges found by DFS are ignored for ranking), centers each layer and returns plain `create` ops.

## Server and core

`server-go/` is the only server; the TypeScript server it was ported from has been removed. `server-go/internal/core` is a port of `@paprika/core`, which the canvas runs and which stays the reference: fixtures generated from the TypeScript core (`pnpm go:golden`) lock the Go port byte for byte. The MCP contract (tool definitions, instructions) is `server-go/contract/mcp.json`, served verbatim; `packages/e2e` checks the binary from outside (MCP, HTTP, WebSocket, canvas).

**HTTP layer.** `StartHTTP` mounts the canvas, `/api/*`, team routes, `/ws` and Streamable HTTP `/mcp` on [Gin](https://gin-gonic.com/) (`gin.New()`, release mode, trusted proxies disabled). Panic recovery and the Host/Origin check (`AllowedRequest`) run as middleware before every route, including 404s. `/ws` still uses `github.com/coder/websocket` inside a Gin handler; `team.Service.Routes` takes a Gin router. The MCP protocol (`MCP.Handle`, tools, schemas) and stdio (`ServeStdio`) stay outside Gin.

## Known limitations (v0.1)

- Two processes on the same database (`serve` + `mcp`) see each other's commits within ~300 ms, but each keeps its own active workspace. To use MCP and the canvas together, prefer `paprika serve` + MCP over HTTP.
- No boolean operations on paths, point-by-point path editing on the canvas (the pen creates new paths; existing ones are edited through `d`), structured gradients or rotation-aware hit testing.
- Groups have no rotation of their own (rotate the children), and children sized `hug`/`fill` count as a point when the group box is fitted. Nodes inside a row/column frame can't be grouped (their position comes from the flow).
- Instances can't be nested inside components yet, and only appearance fields can be overridden (no component props or slots). `scale` doesn't scale a `fontSize` that is a token.
- The contrast lint ignores gradients and background images.
- Agent presence reaches only canvases of the same process: a `paprika mcp` (stdio) whose port was taken runs without a canvas, so its cursor does not show in the `paprika serve` canvas. Use MCP over HTTP to be seen.
- SVG import skips text, images, gradients/patterns (filled gray), masks, clip paths and `<style>` CSS; HTML import only reads inline `style=""` (no classes or stylesheets). SVG export leaves out gradients and background images, draws shadows without spread, and needs a browser for auto layout (`export_code` and `/api/svg` measure in headless Chromium).
- Dragging on the canvas only moves nodes whose parent has no auto layout (in row/column, order comes from the layout).
- The agent-facing guide and error messages are in Brazilian Portuguese.

## Decision records

- [ADR 0001: Go server with SQLite](adr/0001-go-server-sqlite.md): accepted.
- [ADR 0002: Canvas renderer in Rust/WASM (WebGPU with a CPU fallback)](adr/0002-canvas-renderer-rust-wasm.md): accepted as an opt-in hybrid renderer; the DOM stays the default.
- [ADR 0003: Tailwind CSS for the canvas app UI](adr/0003-tailwind-css.md): accepted; Tailwind v4 without Preflight, so the app CSS never changes how a document renders.
- [ADR 0004: Peer-to-peer team sync (Iroh, Loro, Rust sidecar)](adr/0004-p2p-team-sync.md): accepted; protocol in [team-sync.md](team-sync.md).
- [ADR 0005: shadcn components on Paprika's closed theme](adr/0005-shadcn-ui.md): accepted; amends ADR 0003 — copied primitives in `apps/web/src/components/ui/`, `ui-*` semantic tokens, still no Preflight.
