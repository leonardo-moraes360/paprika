🇺🇸 English | [🇧🇷 Português](pt-BR/arquitetura.md)

# Architecture

```
 agent (Claude Code, Cursor…)              human (browser)
        │ MCP stdio | Streamable HTTP /mcp        │ WebSocket /ws
        ▼                                         ▼
 ┌────────────────────── @paprika/server ──────────────────────┐
 │ createMcpServer ──┐                      ┌── startHttpServer │
 │                   ▼                      ▼                   │
 │              DocumentStore  (History + atomic write + watch) │
 └───────────────────────────┬─────────────────────────────────┘
                             ▼
 ┌──────────────────────── @paprika/core ──────────────────────┐
 │ schema (zod) · applyOps (transaction) · History (undo/redo)  │
 │ nodeStyle → React canvas · renderHTML/screenshot · exportReact│
 │ lintDocument · outline/queryNodes                            │
 └──────────────────────────────────────────────────────────────┘
                             ▼
                    design.paprika.json (git)
```

## Decisions

1. **Flat node map + `children` on containers (`frame`, `group`, `page`).** O(1) access by id for the agent, an explicit tree for rendering. `parseDocument` checks integrity (no orphans, no duplicates, consistent `parentId`, pages only at the top and, once there is a page, only pages at the top).
2. **One write path: `applyOps`.** The canvas, MCP and `POST /api/ops` produce the same operations. A transaction runs on a clone and only replaces the document if every operation succeeds. Each transaction yields its inverse operations, which feed the shared undo/redo.
3. **Reject unknown fields.** Zod would drop them silently (`colour` instead of `color`); for agents, an explicit error is cheaper than a wrong design.
4. **One style engine.** `nodeStyle` produces the CSS used by the canvas, the screenshot HTML and the React export. What the agent checks in the PNG is what the human sees. For `path` nodes, `pathAttrs` plays the same role for the `<svg>`/`<path>` attributes, and `packages/core/src/path.ts` (parser, normalization, exact bezier/arc bounds) runs the same way on the server, in the canvas and in tests; invalid `d` is rejected with the character position.
5. **The file is the source of truth.** Atomic, serialized writes (tmp + rename); `fs.watch` reloads external changes (git checkout, another process) and resets history.
6. **Stateless MCP over HTTP.** One `McpServer` per request: no sessions to leak; state lives in the `DocumentStore`. Write tools only reply after the change is flushed to disk.
7. **Local first.** Loopback bind with Host/Origin validation. No authentication or multi-user support in this version.
8. **Composite operations expand inside the transaction.** `group`, `ungroup` and `add_page` are operations too, but `applyOps` turns them into create/move/update/delete against the document *as it is at that moment* (`packages/core/src/structure.ts`), so a canvas or an agent working from a slightly old copy still gets a correct result and one undo step. A group's box is derived: at the end of every transaction `fitGroups` fits each group to its children (deepest first) and shifts them so nothing moves on screen; the inverse only stores positions, and `width`/`height` of a group are rejected as input.
9. **Instances are derived copies.** A component is a frame with `component: true`; an instance is a frame with `instanceOf`, an optional `scale` and `overrides` (by component node id, only `fill`, `color`, `text`, `src`, `alt`, `visible`, `opacity`; `fill` on the root). At the end of every transaction `syncInstances` (`packages/core/src/component.ts`) checks the rules and rebuilds each instance's children from the component, with deterministic ids (`copyId`, FNV-1a of instance + source id, the same in Go) and `sourceId` on each copy. Copies are ordinary nodes, so every renderer, export and lint works unchanged; because they are derived, undo never stores them: undoing the change to the component or instance and syncing again is enough. An `update` on a copy is turned into an override; moving, deleting or adding children inside an instance is rejected. `detach` turns an instance into a plain frame with the same ids.
10. **Import and SVG export are pure functions in the core; the browser only measures.** `importSVG` and `importHTML` (`packages/core/src/svgImport.ts`, `htmlImport.ts`, over a small tolerant reader in `markup.ts`) return `NodeInput` trees plus `warnings`, and the caller writes them with ordinary `create` ops, so pasting is one undo step and goes through the same validation. `importHTML` is the inverse of `nodeStyle`: HTML from `renderHTML` (which tags each element with `data-paprika-type`) comes back with the same types and fields. `exportSVG` builds the SVG from the document plus a `Measure` (boxes before rotation and laid-out text lines) that `MEASURE_SCRIPT` collects from the export HTML in Chromium, so auto layout, `hug`/`fill` and text wrapping match the screenshot without a layout engine in the core; the Go server embeds the same script (`server-go/contract/measure.js`).
11. **Agent presence is implicit and ephemeral.** Agents don't call a presence tool: every MCP tool call that reaches its handler reports `{agent, actor, tool, nodes}` to the store's `PresenceHub` (`packages/server/src/presence.ts`, `server-go/internal/server/presence.go`), and `/ws` broadcasts it as `{type: "presence", agent, actor, tool, nodes, idle}`. `nodes` are the ids the call created or, if none, the ids named in its arguments (that still exist); `agent` is a hash of the HTTP `Mcp-Session-Id` (so two sessions of one client are two agents) or the actor on stdio. Presence never touches the document, the history or the disk; a canvas that connects gets each agent's last presence from the past 2 minutes right after the document. The canvas measures the nodes in the DOM (so auto layout and `hug` are right) and draws the cursor, outline and roster (`apps/web/src/AgentCursors.tsx`).

11. **Workspace = document, one active per server.** The overview lists the documents a server can open: the `*.paprika.json` files next to `--file` (TypeScript, id = the document's `id`; invalid files and repeated ids are skipped) or the documents of the database (Go). The `DocumentStore`/`Store` keeps one active document; `openWorkspace` swaps it in place and emits a change with kind `open`, so the WebSocket, the HTTP API and every MCP tool follow without new plumbing. The canvas and the agents share the active workspace on purpose: the human watches what the agent edits. Undo history belongs to each workspace (in memory in TypeScript, so it starts empty after a switch; stored in SQLite in Go). The active workspace is per process: a separate `paprika mcp` over stdio keeps its own.

## Go server

`server-go/` implements the same server in Go with SQLite as its only storage ([ADR 0001](adr/0001-go-server-sqlite.md)). Decisions 2, 3, 4, 6 and 7 hold there too; decision 5 is replaced by "SQLite is the source of truth" (`.paprika.json` through `paprika import`/`export`). Its core is a port of `@paprika/core` locked by fixtures generated from the TypeScript core, which stays the reference.

## Known limitations (v0.1)

- One process per file: two processes writing the same file are last-writer-wins (the watcher reloads but does not merge). To use MCP and the canvas together, prefer `paprika serve` + MCP over HTTP.
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
