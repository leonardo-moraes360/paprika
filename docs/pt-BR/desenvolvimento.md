# Desenvolvimento

Como rodar o Paprika a partir do código, a estrutura do repositório e as verificações antes de um pull request. Voltar ao [README](../../README.pt-BR.md).

English: [../development.md](../development.md).

## Rodar sem Docker

Requisitos: Node 22+, pnpm 10+ e Go 1.26+.

```bash
pnpm install
pnpm build                                   # canvas + binário do servidor (server-go/bin/paprika)
server-go/bin/paprika import examples/demo.paprika.json --db design.db
server-go/bin/paprika serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshot e export SVG pelo MCP precisam de um Chromium. O servidor encontra sozinho os navegadores do Playwright; se não houver nenhum, instale um (ou aponte `PAPRIKA_CHROMIUM` para qualquer Chrome):

```bash
pnpm --filter @paprika/e2e exec playwright install chromium
```

## Estrutura

```
packages/core     modelo (zod), applyOps atômico, History, nodeStyle, render/export, lint, outline
server-go/        o servidor (Go + SQLite): MCP (stdio e HTTP), WebSocket, API HTTP, screenshot, CLI
packages/e2e      suítes black-box contra o binário do servidor: API MCP/HTTP/WS e E2E do canvas (Playwright)
apps/web          canvas React + Vite
apps/site         landing page (desenhada no Paprika) + site de docs, publicados em paprika.js.org
examples/         demo gerada por um agente via MCP (packages/e2e/scripts/seed-demo.mjs)
```

## Servidor (Go + SQLite)

O servidor fica em `server-go/` e guarda documentos, tokens e o histórico de undo/redo em SQLite; arquivos `.paprika.json` entram e saem com `paprika import` / `paprika export` (para versionar um design, por exemplo). Comandos, estrutura do banco e testes: [server-go/README.pt-BR.md](../../server-go/README.pt-BR.md); registro da decisão: [ADR 0001](adr/0001-servidor-go-sqlite.md). O lint (`cd server-go && golangci-lint run`) inclui o analisador `modernize` para a CI manter limpas as reescritas no estilo do gopls (`errors.AsType`, `slices.Contains`, …).

## Comandos

```bash
pnpm check        # build + typecheck + fixtures em dia + testes unitários e Go + suítes da API e E2E
pnpm dev          # servidor com o demo (dev.db, recriado ao iniciar); em outro terminal: pnpm --filter @paprika/web dev
pnpm test:api     # suíte black-box MCP/HTTP/WS contra server-go/bin/paprika
pnpm test:e2e     # E2E do canvas (Playwright) contra server-go/bin/paprika
pnpm test:render  # renderizador Rust (crates/render): testes nativos com vello_cpu
```

O CI roda só em pull requests e escolhe os jobs pelos arquivos que a PR altera: veja [docs/pt-BR/ci.md](ci.md).

Este repositório usa o [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) como harness: invariantes em `.toolbelt/invariants.yaml` (`tb mem list`) e `tb verify run` / `tb stack verify guard` antes de concluir. Sessões do Claude Code na nuvem instalam o `tb` fixado ao iniciar ([docs/pt-BR/sessoes-agentes.md](sessoes-agentes.md)).

## CLI

O binário `paprika` usa [Cobra](https://cobra.dev/): um comando por subcomando (`serve`, `mcp`, `import`, `export`, `list`, `version`), cada um com suas flags e `paprika <comando> --help`.

```bash
server-go/bin/paprika --help
server-go/bin/paprika export --help
source <(server-go/bin/paprika completion bash)    # também zsh e fish
```

`server-go/cmd/paprika/cli_test.go` trava a superfície: saída golden do `--help` e tabela de flags (`server-go/cmd/paprika/testdata/`, atualize com `cd server-go && go test ./cmd/paprika -update` quando mudar uma flag de propósito), as invocações que `Dockerfile`, `compose.team.yaml`, `package.json` e `packages/e2e/test/harness.ts` usam e os códigos de saída (2 para comando desconhecido, 1 para flag inválida ou erro em execução).

## Segurança

- Escuta em `127.0.0.1` por padrão; Host e Origin são validados (bloqueia DNS rebinding e CSRF de páginas abertas no navegador).
- Não há autenticação: `--host 0.0.0.0` expõe o documento na rede. Use só numa rede confiável.
- A imagem Docker escuta em `0.0.0.0` dentro do contêiner; publique no loopback do host (`-p 127.0.0.1:4777:4777`, como faz o `compose.yaml`) ([docker.md](docker.md)).
- Imagens `https://` são baixadas pelo Chromium ao tirar screenshots.

Para reportar uma vulnerabilidade, veja o [SECURITY.pt-BR.md](../../SECURITY.pt-BR.md).
