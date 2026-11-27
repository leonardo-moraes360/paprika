# Development

Running Paprika from source, the repository layout and the checks to run before a pull request. Back to the [README](../../README.md).

Português: [pt-BR/desenvolvimento.md](../pt-BR/desenvolvimento.md).

## Run from source

Requirements: Node 22+, pnpm 10+ and Go 1.26+.

```bash
pnpm install
pnpm build                                   # canvas + server binary (server/bin/paprika)
server/bin/paprika import packages/e2e/fixtures/demo.paprika.json --db design.db
server/bin/paprika serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshots over MCP need a Chromium (SVG export uses core `layout(doc)` and does not). The server finds Playwright's browsers on its own; if none is installed, install one (or point `PAPRIKA_CHROMIUM` at any Chrome):

```bash
pnpm --filter @paprika/e2e exec playwright install chromium
```

## Layout

```
packages/core     model (zod), atomic applyOps, History, nodeStyle, render/export, lint, outline
server/        the server (Go + SQLite): MCP (stdio and HTTP), WebSocket, HTTP API, screenshot, CLI
packages/e2e      black-box suites against the server binary: MCP/HTTP/WS API and canvas E2E (Playwright); fixtures/ holds the sample documents (demo generated over MCP by scripts/seed-demo.mjs)
web-legacy       old React + Vite canvas (read-only), kept only because the `packages/e2e` suites still drive it; the e2e harness pins it with `--web web-legacy/dist`
apps/web          the web app the server serves by default (TanStack Start SPA, build in `apps/web/dist/client`, entry `_shell.html`): routes `/` and `/w/$workspaceId` on the live data layer (`src/data/`)
apps/site         landing page (drawn in Paprika) + docs site, published to paprika.js.org
```

The canvas UI follows the browser language on first visit (`en` or `pt-BR`), can be switched in the top bar, and remembers the choice in `localStorage` (`paprika.locale`). Default page names ("Page 1" / "Página 1") and blank workspace names follow that locale when created from the UI; MCP/HTTP fallbacks stay English. HTTP API error messages are English (like MCP). E2E suites pin `pt-BR` via `packages/e2e/test/e2e/locale.ts` unless a test checks English.

## Server (Go + SQLite)

The server lives in `server/` and stores documents, tokens and the undo/redo history in SQLite; `.paprika.json` files go in and out with `paprika import` / `paprika export` (to commit a design, for example). Commands, storage layout and tests: [server/README.md](../../server/README.md); decision record: [ADR 0001](adr/0001-go-server-sqlite.md). Lint (`cd server && golangci-lint run`) includes the `modernize` analyzer so CI keeps gopls-style rewrites (`errors.AsType`, `slices.Contains`, …) clean.

## Commands

```bash
pnpm check        # build + typecheck + fixtures up to date + unit and Go tests + API and E2E suites
pnpm dev          # server with the demo (dev.db, reset on start); in another terminal: pnpm --filter @paprika/web dev (proxies /api, /ws, /mcp and /fonts to the server; `PAPRIKA_URL` changes the target)
pnpm test:api     # black-box MCP/HTTP/WS suite against server/bin/paprika
pnpm test:e2e     # canvas E2E (Playwright) against server/bin/paprika
pnpm test:render  # Rust renderer (crates/render): native tests with vello_cpu
```

CI runs on pull requests only and picks the jobs from the files the PR changes: see [docs/en-US/ci.md](ci.md).

This repository uses [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as its agent harness: invariants live in `.toolbelt/invariants.yaml` (`tb mem list`), and `tb verify run` / `tb stack verify guard` run before work is called done. Claude Code cloud sessions install the pinned `tb` on start ([docs/en-US/agent-sessions.md](agent-sessions.md)).

## CLI

The `paprika` binary is built on [Cobra](https://cobra.dev/): one command per subcommand (`serve`, `mcp`, `import`, `export`, `list`, `version`), each with its own flags and `paprika <command> --help`.

```bash
server/bin/paprika --help
server/bin/paprika export --help
source <(server/bin/paprika completion bash)    # also zsh and fish
```

`server/cmd/paprika/cli_test.go` locks the surface: golden `--help` output and flag table (`server/cmd/paprika/testdata/`, refresh with `cd server && go test ./cmd/paprika -update` when you change a flag on purpose), the invocations that `Dockerfile`, `compose.team.yaml`, `package.json` and `packages/e2e/test/harness.ts` use, and the exit codes (2 for an unknown command, 1 for a bad flag or a runtime error).

## Security

- Binds to `127.0.0.1` by default; Host and Origin are validated (blocks DNS rebinding and CSRF from pages open in the browser).
- There is no authentication: `--host 0.0.0.0` exposes the document to the network. Only use it on a trusted network.
- The Docker image binds `0.0.0.0` inside the container; publish it on the host's loopback (`-p 127.0.0.1:4777:4777`, as `compose.yaml` does) ([docker.md](docker.md)).
- `https://` images are fetched by Chromium when taking screenshots.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
