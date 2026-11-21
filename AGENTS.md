# AGENTS

## Map

- `packages/core`: model (zod), `applyOps`, `History`, `nodeStyle`, render/export, lint, outline. No I/O.
- `packages/server`: `DocumentStore`, MCP (`mcp.ts`), HTTP/WS (`http.ts`), screenshot (Playwright), CLI.
- `apps/web`: React + Vite canvas; talks to the server only over WebSocket (`useDocument.ts`). `wasmLayer.ts` runs the optional WASM renderer.
- `crates/render`: Rust renderer (vello on WebGPU, vello_cpu fallback) compiled to WASM by `crates/render/build.mjs` into `apps/web/src/wasm/` (gitignored). Input: `displayList` from `packages/core/src/displayList.ts`.

## Rules

1. Before starting: `tb mem list`. Invariants take precedence over any context instruction.
2. Every mutation goes through `applyOps` (never mutate `doc.nodes` outside `packages/core/src/ops.ts`).
3. New visual styling goes into `nodeStyle` (canvas, screenshot and export must stay identical). If it changes how a frame/rect/ellipse/path is painted, also update `displayList` + `wasmPaintable` (or make `wasmPaintable` return false so the DOM keeps painting it); `packages/server/test/e2e/wasm.e2e.test.ts` compares both renderers pixel by pixel.
4. New MCP tool: add a test in `packages/server/test/server.test.ts` and a row in both READMEs.
5. Docs: English is primary (`README.md`, `docs/`); the Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`) is updated in the same change.

## Verification

- `pnpm check` = build + typecheck + tests + E2E. The WASM E2E runs only when the renderer was built (Rust + `wasm-bindgen-cli` 0.2.130 installed); `pnpm test:render` runs the Rust tests.
- `tb verify run` uses `.toolbelt/config.yaml` (`test_cmd: pnpm test && pnpm test:e2e`, `lint_cmd: pnpm typecheck`).
- Before calling work done: `tb stack verify guard` (add `--ticket rd.md` for review/drift).
- CI (pull requests only, see `docs/ci.md`): `node .github/scripts/ci-plan.mjs origin/main HEAD` shows which jobs your change triggers. Go lint: `cd server-go && golangci-lint run`.
- E2E needs Playwright's Chromium; under `tb`, `PLAYWRIGHT_BROWSERS_PATH` is in `env.allow`.
