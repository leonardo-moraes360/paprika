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

1. **Flat node map + `children` on frames.** O(1) access by id for the agent, an explicit tree for rendering. `parseDocument` checks integrity (no orphans, no duplicates, consistent `parentId`).
2. **One write path: `applyOps`.** The canvas, MCP and `POST /api/ops` produce the same operations. A transaction runs on a clone and only replaces the document if every operation succeeds. Each transaction yields its inverse operations, which feed the shared undo/redo.
3. **Reject unknown fields.** Zod would drop them silently (`colour` instead of `color`); for agents, an explicit error is cheaper than a wrong design.
4. **One style engine.** `nodeStyle` produces the CSS used by the canvas, the screenshot HTML and the React export. What the agent checks in the PNG is what the human sees. For `path` nodes, `pathAttrs` plays the same role for the `<svg>`/`<path>` attributes, and `packages/core/src/path.ts` (parser, normalization, exact bezier/arc bounds) runs the same way on the server, in the canvas and in tests; invalid `d` is rejected with the character position.
5. **The file is the source of truth.** Atomic, serialized writes (tmp + rename); `fs.watch` reloads external changes (git checkout, another process) and resets history.
6. **Stateless MCP over HTTP.** One `McpServer` per request: no sessions to leak; state lives in the `DocumentStore`. Write tools only reply after the change is flushed to disk.
7. **Local first.** Loopback bind with Host/Origin validation. No authentication or multi-user support in this version.

## Go server

`server-go/` implements the same server in Go with SQLite as its only storage ([ADR 0001](adr/0001-go-server-sqlite.md)). Decisions 2, 3, 4, 6 and 7 hold there too; decision 5 is replaced by "SQLite is the source of truth" (`.paprika.json` through `paprika import`/`export`). Its core is a port of `@paprika/core` locked by fixtures generated from the TypeScript core, which stays the reference.

## Known limitations (v0.1)

- One process per file: two processes writing the same file are last-writer-wins (the watcher reloads but does not merge). To use MCP and the canvas together, prefer `paprika serve` + MCP over HTTP.
- No components/instances, boolean operations on paths, point-by-point path editing on the canvas (the pen creates new paths; existing ones are edited through `d`), structured gradients, multiple pages, rotation-aware hit testing or multi-select.
- The contrast lint ignores gradients and background images.
- Dragging on the canvas only moves nodes whose parent has no auto layout (in row/column, order comes from the layout).
- The agent-facing guide and error messages are in Brazilian Portuguese.
