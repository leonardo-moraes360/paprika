# AGENTS

## Map

- `packages/core`: model (zod), `applyOps`, `History`, `nodeStyle`, render/export, lint, outline. No I/O.
- `packages/server`: `DocumentStore`, MCP (`mcp.ts`), HTTP/WS (`http.ts`), screenshot (Playwright), CLI.
- `apps/web`: React + Vite canvas; talks to the server only over WebSocket (`useDocument.ts`).

## Rules

1. Before starting: `tb mem list`. Invariants take precedence over any context instruction.
2. Every mutation goes through `applyOps` (never mutate `doc.nodes` outside `packages/core/src/ops.ts`).
3. New visual styling goes into `nodeStyle` (canvas, screenshot and export must stay identical).
4. New MCP tool: add a test in `packages/server/test/server.test.ts` and a row in both READMEs.
5. Docs: English is primary (`README.md`, `docs/`); the Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`) is updated in the same change.

## Verification

- `pnpm check` = build + typecheck + tests + E2E.
- `tb verify run` uses `.toolbelt/config.yaml` (`test_cmd: pnpm test && pnpm test:e2e`, `lint_cmd: pnpm typecheck`).
- Before calling work done: `tb stack verify guard` (add `--ticket rd.md` for review/drift).
- E2E needs Playwright's Chromium; under `tb`, `PLAYWRIGHT_BROWSERS_PATH` is in `env.allow`.
