# Desenvolvimento

Como rodar o Paprika a partir do código, a estrutura do repositório e as verificações antes de um pull request. Voltar ao [README](README.md).

English: [../development.md](../en-US/development.md).

## Rodar sem Docker

Requisitos: Node 22+, pnpm 10+ e Go 1.26+.

```bash
pnpm install
pnpm build                                   # canvas + binário do servidor (server/bin/paprika)
server/bin/paprika import packages/e2e/fixtures/demo.paprika.json --db design.db
server/bin/paprika serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshot pelo MCP precisa de um Chromium (o export SVG usa o `layout(doc)` do core e não). O servidor encontra sozinho os navegadores do Playwright; se não houver nenhum, instale um (ou aponte `PAPRIKA_CHROMIUM` para qualquer Chrome):

```bash
pnpm --filter @paprika/e2e exec playwright install chromium
```

## Estrutura

```
packages/core     modelo (zod), applyOps atômico, History, nodeStyle, render/export, lint, outline
server/        o servidor (Go + SQLite): MCP (stdio e HTTP), WebSocket, API HTTP, screenshot, CLI
packages/e2e      suítes black-box contra o binário do servidor: API MCP/HTTP/WS e E2E do canvas (Playwright); fixtures/ guarda os documentos de exemplo (demo gerada via MCP por scripts/seed-demo.mjs)
web-legacy       canvas React + Vite, o app que o servidor serve (`src/i18n/`: strings en + pt-BR, detecção/troca de idioma)
apps/web          app novo em construção (TanStack Start); ainda não servido nem coberto por E2E
apps/site         landing page (desenhada no Paprika) + site de docs, publicados em paprika.js.org
```

A UI do canvas segue o idioma do navegador na primeira visita (`en` ou `pt-BR`), pode ser trocada na barra superior e lembra a escolha no `localStorage` (`paprika.locale`). Nomes padrão de página ("Page 1" / "Página 1") e workspace em branco seguem esse idioma quando criados pela UI; MCP/HTTP caem no inglês. Mensagens de erro da API HTTP ficam em inglês (como o MCP). As suítes E2E fixam `pt-BR` via `packages/e2e/test/e2e/locale.ts`, salvo quando o teste cobre o inglês.

## Servidor (Go + SQLite)

O servidor fica em `server/` e guarda documentos, tokens e o histórico de undo/redo em SQLite; arquivos `.paprika.json` entram e saem com `paprika import` / `paprika export` (para versionar um design, por exemplo). Comandos, estrutura do banco e testes: [server/README.pt-BR.md](../../server/README.pt-BR.md); registro da decisão: [ADR 0001](adr/0001-servidor-go-sqlite.md). O lint (`cd server && golangci-lint run`) inclui o analisador `modernize` para a CI manter limpas as reescritas no estilo do gopls (`errors.AsType`, `slices.Contains`, …).

## Comandos

```bash
pnpm check        # build + typecheck + fixtures em dia + testes unitários e Go + suítes da API e E2E
pnpm dev          # servidor com o demo (dev.db, recriado ao iniciar); em outro terminal: pnpm --filter @paprika/web-legacy dev
pnpm test:api     # suíte black-box MCP/HTTP/WS contra server/bin/paprika
pnpm test:e2e     # E2E do canvas (Playwright) contra server/bin/paprika
pnpm test:render  # renderizador Rust (crates/render): testes nativos com vello_cpu
```

O CI roda só em pull requests e escolhe os jobs pelos arquivos que a PR altera: veja [docs/pt-BR/ci.md](ci.md).

Este repositório usa o [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) como harness: invariantes em `.toolbelt/invariants.yaml` (`tb mem list`) e `tb verify run` / `tb stack verify guard` antes de concluir. Sessões do Claude Code na nuvem instalam o `tb` fixado ao iniciar ([docs/pt-BR/sessoes-agentes.md](sessoes-agentes.md)).

## CLI

O binário `paprika` usa [Cobra](https://cobra.dev/): um comando por subcomando (`serve`, `mcp`, `import`, `export`, `list`, `version`), cada um com suas flags e `paprika <comando> --help`.

```bash
server/bin/paprika --help
server/bin/paprika export --help
source <(server/bin/paprika completion bash)    # também zsh e fish
```

`server/cmd/paprika/cli_test.go` trava a superfície: saída golden do `--help` e tabela de flags (`server/cmd/paprika/testdata/`, atualize com `cd server && go test ./cmd/paprika -update` quando mudar uma flag de propósito), as invocações que `Dockerfile`, `compose.team.yaml`, `package.json` e `packages/e2e/test/harness.ts` usam e os códigos de saída (2 para comando desconhecido, 1 para flag inválida ou erro em execução).

## Segurança

- Escuta em `127.0.0.1` por padrão; Host e Origin são validados (bloqueia DNS rebinding e CSRF de páginas abertas no navegador).
- Não há autenticação: `--host 0.0.0.0` expõe o documento na rede. Use só numa rede confiável.
- A imagem Docker escuta em `0.0.0.0` dentro do contêiner; publique no loopback do host (`-p 127.0.0.1:4777:4777`, como faz o `compose.yaml`) ([docker.md](docker.md)).
- Imagens `https://` são baixadas pelo Chromium ao tirar screenshots.

Para reportar uma vulnerabilidade, veja o [docs/pt-BR/SECURITY.md](SECURITY.md).
