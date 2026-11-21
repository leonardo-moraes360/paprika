# AGENTS

## Map

- `packages/core`: model (zod), `applyOps`, `History`, `nodeStyle`, render/export, lint, outline. No I/O.
- `server-go`: the only server (Go + SQLite): MCP (stdio and HTTP `/mcp`), HTTP/WS, screenshot (chromedp), CLI `paprika`. `server-go/internal/core` is a port of `packages/core`, held to it by fixtures; `server-go/contract/mcp.json` is the MCP contract (tool definitions, served verbatim).
- `packages/e2e`: black-box suites against the Go binary: `test:api` (MCP over HTTP and stdio, HTTP API, WebSocket) and `test:e2e` (canvas in Playwright, including the WASM renderer).
- `apps/web`: React + Vite canvas; talks to the server only over WebSocket (`useDocument.ts`). `wasmLayer.ts` runs the optional WASM renderer. Styling is Tailwind CSS v4 without Preflight ([ADR 0003](docs/adr/0003-tailwind-css.md)): theme tokens in `src/styles.css`, shared class lists in `src/ui.ts`; plain class names such as `is-active` or `layer-name` are E2E hooks, keep them. UI icons come from `lucide-react` (no emoji or Unicode glyphs as icons); icon-only buttons keep their `aria-label` and the SVG stays `aria-hidden`.
- `apps/site`: landing page (`design/landing.paprika.json`, drawn over MCP by `scripts/draw-landing.mjs`) and docs site; `scripts/build.mjs` renders both into `dist/` for GitHub Pages (`.github/workflows/pages.yml`). Not part of `pnpm build`.
- `crates/render`: Rust renderer (vello on WebGPU, vello_cpu fallback) compiled to WASM by `crates/render/build.mjs` into `apps/web/src/wasm/` (gitignored). Input: `displayList` from `packages/core/src/displayList.ts`.
- `Dockerfile` (+ `.dockerignore`, `compose.yaml`): one image with the Go server, the canvas and the WASM renderer; SQLite in the `/data` volume. Targets `runtime` (with Chrome headless shell) and `slim`. Pinned versions to keep in step and the CI smoke test: `docs/docker.md`.

## Rules

1. Before starting: `tb mem list`. Invariants take precedence over any context instruction. `tb` is toolbelt v0.0.10; cloud sessions get it from the `SessionStart` hook (`.claude/hooks/session-start.sh`, see `docs/agent-sessions.md`). Locally: `go install github.com/leonardo-moraes360/toolbelt/cmd/tb@v0.0.10`.
2. Every mutation goes through `applyOps` (never mutate `doc.nodes` outside `packages/core/src/ops.ts`).
3. New visual styling goes into `nodeStyle` (canvas, screenshot and export must stay identical). If it changes how a frame/rect/ellipse/path is painted, also update `displayList` + `wasmPaintable` (or make `wasmPaintable` return false so the DOM keeps painting it); `packages/e2e/test/e2e/wasm.e2e.test.ts` compares both renderers pixel by pixel.
4. New MCP tool: add its definition to `server-go/contract/mcp.json` and its handler in `server-go/internal/server/mcp.go`, a Go test, a scenario in `packages/e2e/test/api.test.ts` (and the name in its tool list), and a row in both READMEs. After a change to `packages/core`: `pnpm build && pnpm go:golden` and keep `pnpm go:test` passing.
5. Docs: English is primary (`README.md`, `docs/`); the Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`) is updated in the same change.

## Verification

- `pnpm check` = build (TS + Go binary) + typecheck + fixtures up to date + TS and Go tests + API and E2E suites against the Go server. The WASM E2E runs only when the renderer was built (Rust + `wasm-bindgen-cli` 0.2.130 installed); `pnpm test:render` runs the Rust tests.
- `tb verify run` uses `.toolbelt/config.yaml` (toolbelt v0.0.10): `build_cmd` = `pnpm build` (TS + Go binary), `lint_cmd` = `pnpm typecheck` + `go vet`, `test_cmd` = core unit tests, Go tests, and the API and E2E suites against the Go server. Re-running `tb init` never migrates an existing `config.yaml`; new keys are added by hand.
- If the machine's Playwright Chromium revision doesn't match the lockfile, run `pnpm --filter @paprika/e2e exec playwright install chromium` (or point `PAPRIKA_CHROMIUM` at an installed Chrome).
- Before calling work done or opening/updating a PR: `tb stack verify guard` must pass (add `--ticket rd.md` for review/drift). On a branch with several commits, check the whole range: `tb guard check "$(git merge-base origin/main HEAD)"..HEAD`. Never skip it because `tb` is missing: if the hook could not install it, run the same checks by hand and say in the PR that `tb` did not run and why.
- CI (pull requests only, see `docs/ci.md`): `node .github/scripts/ci-plan.mjs origin/main HEAD` shows which jobs your change triggers. Go lint: `cd server-go && golangci-lint run`.
- E2E needs Playwright's Chromium; under `tb`, `PLAYWRIGHT_BROWSERS_PATH` and `PAPRIKA_CHROMIUM` are in `env.allow`.

## Agent bus

Agents running on the maintainer's machine coordinate through the local toolbelt bus (channel `paprika`): see `docs/agent-bus.md` for how to join, the lanes that keep bus agents off the files the backlog stack is changing, and the claim → worktree → `complete` protocol. Claim a thread before editing anything; never work in the maintainer's checkout.
