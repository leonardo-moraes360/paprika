🇺🇸 English | [🇧🇷 Português](../pt-BR/adr/0001-servidor-go-sqlite.md)

# ADR 0001: Go server with SQLite storage

- Status: accepted (2026-11-21); amended 2026-11-21 (see [Follow-up](#follow-up-typescript-server-removed))
- Scope: `server-go/` (new). The TypeScript server (`packages/server`) and core (`packages/core`) stay as they are.

## Context

The owner asked for the Paprika server to be reimplemented in Go, keeping the same contract: the MCP tools, the `.paprika.json` format, atomic operations with shared undo/redo, live WebSocket sync for the canvas, lint and export. While this work was in progress the owner asked where the data is stored (only the JSON file, at the time) and chose SQLite. Asked which role SQLite should have, the owner picked **"SQLite only; JSON through import/export"**.

## Decision

1. **One Go binary** (`server-go/cmd/paprika`) with `serve`, `mcp` (stdio), `import`, `export` and `list`.
2. **SQLite is the only storage** of the Go server (pure-Go driver `modernc.org/sqlite`, no cgo). Tables: `documents`, `tokens`, `nodes` (one row per node, with the validated JSON plus `type`/`name`/`parent_id` columns for plain SQL queries), `history` (undo and redo stacks) and `meta`. One database can hold several documents; a server process serves one of them (`--doc`, default: the most recently updated).
3. **`.paprika.json` only enters or leaves through `paprika import` / `paprika export`** (and `GET /api/export`). There is no automatic mirror and no file watching. `export` output is byte-identical to the TypeScript server's file (`JSON.stringify(doc, null, 2)` + newline), so it can still be versioned with git.
4. **Undo/redo survives restarts**: both stacks are committed in the same SQLite transaction as the document change.
5. **Every write is committed before it is acknowledged** (MCP tools, `POST /api/ops`, WebSocket `ack`). If the commit fails, the in-memory state is rolled back.
6. **Two processes on the same database** (e.g. `paprika serve` plus `paprika mcp` over stdio) see each other's commits: each process polls `PRAGMA data_version` and reloads the document and history when another connection committed. This replaces the TypeScript server's file watcher.
7. **The TypeScript core stays the reference.** `server-go/internal/core` is a port of `@paprika/core` (schema, `applyOps`, `History`, `nodeStyle`, render/export, lint, outline, path). Parity is locked by fixtures generated from the TypeScript core (`server-go/scripts/gen-golden.mjs`): 72 operation cases, 23 documents (outline, lint, HTML, React, CSS per node), 21 paths, colors and 25 seeded random runs (500 steps of transactions, undo and redo). The Go tests must reproduce every output byte for byte. Validation messages come from a small port of zod v4 (`internal/zod`) so agents get exactly the same errors.
8. **The MCP contract is shared, not re-described.** `server-go/scripts/gen-contract.mjs` dumps `tools/list`, the instructions and the server info from the TypeScript server into `server-go/contract/mcp.json`, which the Go binary embeds and serves verbatim.

## Consequences

- The canvas (`apps/web`) is unchanged and still uses the TypeScript `nodeStyle`; the Go server serves its build.
- Any change to `packages/core` or to the MCP tools must be followed by `pnpm go:golden` and a passing `pnpm go:test`; `pnpm check:go` fails if the fixtures are stale.
- The same black-box suites run against both servers: `packages/server/test/external/parity.test.ts` and the canvas E2E (`PAPRIKA_SERVER_BIN=…`).
- Differences from the TypeScript server: storage (SQLite instead of the file), `/api/health` reports the database path in `file` plus `storage` and `docId`, the extra `GET /api/export`, `GET /mcp` answers 405 (stateless server, no standalone SSE stream), and the history keeps the entry when an undo fails instead of dropping it.
- Screenshots use headless Chromium over CDP (`chromedp`), found via `PAPRIKA_CHROMIUM`, Playwright's browser cache or the system.

## Alternatives considered

- **SQLite as the source with the JSON mirrored on every change** (recommended at first): keeps the git workflow automatic, but two sources of truth would need conflict handling. Not chosen by the owner.
- **JSON as the source, SQLite only for history**: smallest change, but does not answer "store the data in a database".
- **Running the TypeScript core inside Go (goja/V8)** to avoid a port: no duplicated logic, but heavy, slower and hard to debug; the golden fixtures give the same guarantee.

## Follow-up: TypeScript server removed

- Date: 2026-11-21. Decided by the owner: keep only the Go server.
- `packages/server` was deleted. The black-box suites moved to `packages/e2e` and run only against the Go binary (`test:api`, the former parity suite, and `test:e2e`); CI runs them once instead of once per server.
- Decision 8 changes: there is no TypeScript server to dump the contract from, so `server-go/contract/mcp.json` and `guide.pt-BR.md` are now the contract itself, edited by hand and checked by `packages/e2e/test/api.test.ts`. `scripts/gen-contract.mjs` became `scripts/gen-measure.mjs`, which only copies the measure script from `@paprika/core`.
- Decision 7 stays: `packages/core` is still the reference (the canvas runs it) and the golden fixtures still lock the Go port to it.
