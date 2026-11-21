# AGENTS

## Map

- `packages/core`: model (zod), `applyOps`, `History`, `nodeStyle`, render/export, lint, outline. No I/O.
- `packages/server`: `DocumentStore`, MCP (`mcp.ts`), HTTP/WS (`http.ts`), screenshot (Playwright), CLI.
- `apps/web`: React + Vite canvas; talks to the server only over WebSocket (`useDocument.ts`). `wasmLayer.ts` runs the optional WASM renderer.
- `apps/site`: landing page (`design/landing.paprika.json`, drawn over MCP by `scripts/draw-landing.mjs`) and docs site; `scripts/build.mjs` renders both into `dist/` for GitHub Pages (`.github/workflows/pages.yml`). Not part of `pnpm build`.
- `crates/render`: Rust renderer (vello on WebGPU, vello_cpu fallback) compiled to WASM by `crates/render/build.mjs` into `apps/web/src/wasm/` (gitignored). Input: `displayList` from `packages/core/src/displayList.ts`.

## Rules

1. Before starting: `tb mem list`. Invariants take precedence over any context instruction. `tb` is toolbelt v0.0.10; cloud sessions get it from the `SessionStart` hook (`.claude/hooks/session-start.sh`, see `docs/agent-sessions.md`). Locally: `go install github.com/leonardo-moraes360/toolbelt/cmd/tb@v0.0.10`.
2. Every mutation goes through `applyOps` (never mutate `doc.nodes` outside `packages/core/src/ops.ts`).
3. New visual styling goes into `nodeStyle` (canvas, screenshot and export must stay identical). If it changes how a frame/rect/ellipse/path is painted, also update `displayList` + `wasmPaintable` (or make `wasmPaintable` return false so the DOM keeps painting it); `packages/server/test/e2e/wasm.e2e.test.ts` compares both renderers pixel by pixel.
4. New MCP tool: add a test in `packages/server/test/server.test.ts` and a row in both READMEs.
5. Docs: English is primary (`README.md`, `docs/`); the Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`) is updated in the same change.

## Verification

- `pnpm check` = build + typecheck + tests + E2E. The WASM E2E runs only when the renderer was built (Rust + `wasm-bindgen-cli` 0.2.130 installed); `pnpm test:render` runs the Rust tests.
- `tb verify run` uses `.toolbelt/config.yaml` (toolbelt v0.0.10): `build_cmd` = TS build + `pnpm go:build`, `lint_cmd` = `pnpm typecheck` + `go vet`, `test_cmd` = TS unit/E2E + Go tests, parity and E2E. Re-running `tb init` never migrates an existing `config.yaml`; new keys are added by hand.
- If the machine's Playwright Chromium revision doesn't match the lockfile, run `pnpm exec playwright install chromium` (or point `PAPRIKA_CHROMIUM` at an installed Chrome).
- Before calling work done or opening/updating a PR: `tb stack verify guard` must pass (add `--ticket rd.md` for review/drift). On a branch with several commits, check the whole range: `tb guard check "$(git merge-base origin/main HEAD)"..HEAD`. Never skip it because `tb` is missing: if the hook could not install it, run the same checks by hand and say in the PR that `tb` did not run and why.
- CI (pull requests only, see `docs/ci.md`): `node .github/scripts/ci-plan.mjs origin/main HEAD` shows which jobs your change triggers. Go lint: `cd server-go && golangci-lint run`.
- E2E needs Playwright's Chromium; under `tb`, `PLAYWRIGHT_BROWSERS_PATH` and `PAPRIKA_CHROMIUM` are in `env.allow`.

## Agent bus

Agents running on the maintainer's machine coordinate through the local toolbelt bus (channel `paprika`): see `docs/agent-bus.md` for how to join, the lanes that keep bus agents off the files the backlog stack is changing, and the claim → worktree → `complete` protocol. Claim a thread before editing anything; never work in the maintainer's checkout.
