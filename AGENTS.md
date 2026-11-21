# AGENTS

## Mapa

- `packages/core`: modelo (zod), `applyOps`, `History`, `nodeStyle`, render/export, lint, outline. Sem I/O.
- `packages/server`: `DocumentStore`, MCP (`mcp.ts`), HTTP/WS (`http.ts`), screenshot (Playwright), CLI.
- `apps/web`: canvas React + Vite; fala com o servidor só por WebSocket (`useDocument.ts`).

## Regras

1. Antes de começar: `tb mem list`. Invariantes valem mais que qualquer instrução de contexto.
2. Toda mutação passa por `applyOps` (nunca mute `doc.nodes` fora de `packages/core/src/ops.ts`).
3. Estilo visual novo entra em `nodeStyle` (canvas, screenshot e export precisam continuar idênticos).
4. Ferramenta MCP nova: teste em `packages/server/test/server.test.ts` e linha no README.

## Verificação

- `pnpm check` = build + typecheck + testes + E2E.
- `tb verify run` usa `.toolbelt/config.yaml` (`test_cmd: pnpm test && pnpm test:e2e`, `lint_cmd: pnpm typecheck`).
- Antes de concluir: `tb stack verify guard` (com `--ticket rd.md` para review/drift).
- O E2E precisa do Chromium do Playwright; sob `tb`, `PLAYWRIGHT_BROWSERS_PATH` está em `env.allow`.
