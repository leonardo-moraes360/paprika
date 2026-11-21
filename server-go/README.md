🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# Paprika server in Go

The Paprika server: 29 MCP tools (stdio and Streamable HTTP at `/mcp`), atomic operations with shared undo/redo, the WebSocket protocol of the canvas (`/ws`), the HTTP API, and lint, export and screenshot. Data lives in **SQLite**; `.paprika.json` files go in and out with `import` and `export`. It started as a port of the former TypeScript server, removed once the Go one covered everything. Why and how: [ADR 0001](../docs/adr/0001-go-server-sqlite.md).

## Build and run

Requirements: Go 1.26+ (the `go` command downloads the toolchain if needed). Chromium is only needed for screenshots and SVG export: the server uses `$PAPRIKA_CHROMIUM`, then Playwright's browsers (`$PLAYWRIGHT_BROWSERS_PATH` or `~/.cache/ms-playwright`), then `chromium`/`google-chrome` on `PATH`.

```bash
pnpm install && pnpm build            # builds the canvas (apps/web/dist) and the server (pnpm go:build)
                                      # → server-go/bin/paprika

B=server-go/bin/paprika
$B import examples/demo.paprika.json --db design.db   # prints the document id
$B serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
$B export --db design.db -o design.paprika.json       # back to a file, e.g. to commit it
```

Connect an agent over HTTP:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

or over stdio:

```json
{ "mcpServers": { "paprika": { "command": "<PATH>/server-go/bin/paprika", "args": ["mcp", "--db", "<PATH>/design.db"] } } }
```

## Commands

| Command | What it does |
|---|---|
| `paprika serve [--db F] [--doc ID] [--port 4777] [--host 127.0.0.1] [--web DIR]` | Canvas, HTTP API, MCP over HTTP and WebSocket |
| `paprika mcp [--db F] [--doc ID] [--port 4777] [--no-ui]` | MCP over stdio; also serves the canvas if the port is free |
| `paprika import FILE.paprika.json [--db F] [--replace]` | Validates and stores a document (history starts empty) |
| `paprika export [--db F] [--doc ID] [-o FILE]` | Writes the document as `.paprika.json` (stdout without `-o`) |
| `paprika list [--db F]` | Lists the documents in the database |

Defaults: `--db` is `./paprika.db` (or `$PAPRIKA_DB`); `--doc` is the most recently updated document, and an empty one is created when the database is empty. `--web` falls back to `$PAPRIKA_WEB_ROOT` and then to `apps/web/dist` next to the binary or the current directory.

## Storage

| Table | Content |
|---|---|
| `documents` | id, format, name, `root_ids` (JSON), version, timestamps |
| `tokens` | one row per token: name, JSON value, order |
| `nodes` | one row per node: id, `parent_id`, `type`, `name`, order and the validated node JSON in `data` |
| `history` | undo and redo stacks: actor, label, ops, inverse ops, time |

Every change (document + history) is one SQLite transaction, committed before the agent or the canvas gets an answer, so undo/redo survives restarts. Only changed nodes and tokens are rewritten. Two processes on the same database (`serve` + `mcp`) pick up each other's commits within ~300 ms (`PRAGMA data_version`). The tables are meant to be read with plain SQL, e.g. `sqlite3 design.db "SELECT id, name FROM nodes WHERE type = 'text'"`; write through the server so validation and history apply.

## Layout

```
cmd/paprika        CLI
contract/          MCP contract served verbatim (tool definitions, instructions, pt-BR guide) + measure script of @paprika/core
internal/jsonv     JSON values with JavaScript semantics (key order, number formatting, JSON.stringify)
internal/zod       the subset of zod v4 used by the core, with the same messages
internal/core      port of @paprika/core: schema, applyOps, History, nodeStyle, render/export, lint, outline, path
internal/server    SQLite store, MCP (JSON-RPC over stdio and HTTP), HTTP API, WebSocket, screenshot (chromedp)
scripts/           fixture and measure-script generators (run with Node against the @paprika/core build)
```

## Tests and the reference core

`@paprika/core` (TypeScript) stays the reference: the canvas runs it, and `internal/core` must produce the same results. Three layers check the server:

1. **Golden fixtures** (`internal/core/testdata/golden.json`, from `scripts/gen-golden.mjs`): operation results and errors, zod error JSON, history, outline, lint, HTML, React, CSS of every node of 23 documents, path parsing/bounds, colors, SVG/HTML import, SVG export (with and without a synthetic browser measure) and 500 seeded random steps. `go test` compares byte for byte.
2. **Black-box API suite** (`packages/e2e/test/api.test.ts`): MCP over HTTP and stdio (including the served contract), WebSocket, HTTP API and Host/Origin checks, run against a server process.
3. **Canvas E2E** (`packages/e2e/test/e2e`): Playwright drives the canvas served by the binary, including the WASM renderer.

```bash
pnpm go:test            # go vet + go test (fixtures, SQLite, MCP, HTTP, WebSocket)
pnpm test:api           # black-box API suite against server-go/bin/paprika
pnpm test:e2e           # canvas E2E against server-go/bin/paprika
pnpm check              # everything + fails if the fixtures or the measure script are stale
```

`PAPRIKA_SERVER_BIN=<path>` runs both suites against another binary.

After changing `packages/core`: `pnpm build && pnpm go:golden`, then make `pnpm go:test` pass again. The MCP contract (`contract/mcp.json`, `contract/guide.pt-BR.md`) is edited by hand: a new or changed tool updates it, its handler in `internal/server/mcp.go`, a Go test and a scenario in the API suite.

## Behavior notes

- `GET /api/health` returns `file` (the database path), `storage: "sqlite"` and `docId`. `GET /api/export` downloads the active document as `.paprika.json`.
- Workspaces are the documents of the database; `open_workspace` loads that document's stored undo history.
- No file watching: edit a `.paprika.json` and `import --replace` it, or go through the server.
- `GET /mcp` answers 405 (stateless server without a standalone SSE stream; MCP clients handle it).
- A failing undo keeps its entry in the history instead of dropping it.

## Known limitations

- Floating-point math (`Math.pow`, `sin`, `cos`) can differ from V8 in the last bit; the fixtures pass today, but a path whose bounds land exactly on a rounding boundary could round differently.
- The WebSocket error for malformed JSON is worded differently from `JSON.parse`'s message.
- No authentication: `--host 0.0.0.0` exposes the document to the network.
