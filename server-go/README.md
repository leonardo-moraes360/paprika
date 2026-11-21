🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# Paprika server in Go

A Go implementation of the Paprika server with the same contract as the TypeScript one (`packages/server`): the same 17 MCP tools (stdio and Streamable HTTP at `/mcp`), the same operations and shared undo/redo, the same WebSocket protocol for the canvas (`/ws`), the same HTTP API and the same lint, export and screenshot. Data lives in **SQLite**; `.paprika.json` files go in and out with `import` and `export`. Why and how: [ADR 0001](../docs/adr/0001-go-server-sqlite.md).

## Build and run

Requirements: Go 1.26+ (the `go` command downloads the toolchain if needed). Chromium is only needed for screenshots.

```bash
pnpm install && pnpm build            # builds the canvas (apps/web/dist) that the Go server serves
pnpm go:build                         # → server-go/bin/paprika

B=server-go/bin/paprika
$B import examples/demo.paprika.json --db design.db   # prints the document id
$B serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
$B export --db design.db -o design.paprika.json       # back to a file, e.g. to commit it
```

Connect an agent exactly as with the TypeScript server:

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
contract/          MCP contract dumped from the TypeScript server (tools/list, instructions), embedded
internal/jsonv     JSON values with JavaScript semantics (key order, number formatting, JSON.stringify)
internal/zod       the subset of zod v4 used by the core, with the same messages
internal/core      port of @paprika/core: schema, applyOps, History, nodeStyle, render/export, lint, outline, path
internal/server    SQLite store, MCP (JSON-RPC over stdio and HTTP), HTTP API, WebSocket, screenshot (chromedp)
scripts/           fixture and contract generators (run with Node against the TypeScript build)
```

## Parity with the TypeScript server

The TypeScript core is the reference. Three layers check that the Go server behaves the same:

1. **Golden fixtures** (`internal/core/testdata/golden.json`, from `scripts/gen-golden.mjs`): operation results and errors, zod error JSON, history, outline, lint, HTML, React, CSS of every node of 23 documents, path parsing/bounds, colors and 500 seeded random steps. `go test` compares byte for byte.
2. **Black-box suite** (`packages/server/test/external/parity.test.ts`): MCP over HTTP and stdio, WebSocket, HTTP API and Host/Origin checks, run against a server process.
3. **Canvas E2E** (`packages/server/test/e2e`): the same Playwright suite, with the Go binary behind the canvas.

```bash
pnpm go:test            # go vet + go test (fixtures, SQLite, MCP, HTTP, WebSocket)
pnpm test:parity        # black-box suite against the TypeScript server
pnpm test:parity:go     # … against the Go server
pnpm test:e2e:go        # canvas E2E against the Go server
pnpm check:go           # all of the above + fails if the fixtures or the contract are stale
```

After changing `packages/core` or the MCP tools in TypeScript: `pnpm build && pnpm go:golden`, then make `pnpm go:test` pass again.

## Differences from the TypeScript server

- Storage: SQLite (`--db`, `--doc`) instead of `--file`; no file watching.
- `GET /api/health` returns `file` (the database path), `storage: "sqlite"` and `docId`. New `GET /api/export`.
- `GET /mcp` answers 405 (stateless server without a standalone SSE stream; MCP clients handle it).
- A failing undo keeps its entry in the history instead of dropping it.

## Known limitations

- Floating-point math (`Math.pow`, `sin`, `cos`) can differ from V8 in the last bit; the fixtures pass today, but a path whose bounds land exactly on a rounding boundary could round differently.
- The WebSocket error for malformed JSON is worded differently from `JSON.parse`'s message.
- Like the TypeScript server: no authentication (`--host 0.0.0.0` exposes the document), and the agent-facing guide and errors are in Brazilian Portuguese.
