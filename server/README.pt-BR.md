[🇺🇸 English](README.md) | 🇧🇷 Português

# Servidor do Paprika em Go

O servidor do Paprika: 29 ferramentas MCP (stdio e Streamable HTTP em `/mcp`), operações atômicas com undo/redo compartilhado, o protocolo WebSocket do canvas (`/ws`), a API HTTP, e lint, export e screenshot. Os dados ficam em **SQLite**; arquivos `.paprika.json` entram e saem com `import` e `export`. Nasceu como port do antigo servidor TypeScript, removido quando o Go passou a cobrir tudo. Por que e como: [ADR 0001](../docs/pt-BR/adr/0001-servidor-go-sqlite.md).

## Compilar e rodar

Requisitos: Go 1.26+ (o comando `go` baixa o toolchain se precisar). O Chromium só é necessário para screenshots (o export SVG usa o `layout(doc)` do core): o servidor usa `$PAPRIKA_CHROMIUM`, depois os navegadores do Playwright (`$PLAYWRIGHT_BROWSERS_PATH` ou `~/.cache/ms-playwright`), depois `chromium`/`google-chrome` no `PATH`.

```bash
pnpm install && pnpm build            # compila o app web (apps/web/dist/client) e o servidor (pnpm go:build)
                                      # → server/bin/paprika

B=server/bin/paprika
$B import packages/e2e/fixtures/demo.paprika.json --db design.db   # imprime o id do documento
$B serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
$B export --db design.db -o design.paprika.json       # de volta para um arquivo, por exemplo para commitar
```

Conecte um agente via HTTP:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

ou via stdio:

```json
{ "mcpServers": { "paprika": { "command": "<CAMINHO>/server/bin/paprika", "args": ["mcp", "--db", "<CAMINHO>/design.db"] } } }
```

## Comandos

| Comando | O que faz |
|---|---|
| `paprika serve [--db F] [--doc ID] [--port 4777] [--host 127.0.0.1] [--web DIR] [--team]` | Canvas, API HTTP, MCP via HTTP e WebSocket |
| `paprika mcp [--db F] [--doc ID] [--port 4777] [--no-ui]` | MCP via stdio; também serve o canvas se a porta estiver livre |
| `paprika import ARQUIVO.paprika.json [--db F] [--replace]` | Valida e grava um documento (o histórico começa vazio) |
| `paprika export [--db F] [--doc ID] [--root ID] [-o ARQUIVO]` | Escreve o documento como `.paprika.json` (stdout sem `-o`) |
| `paprika list [--db F]` | Lista os documentos do banco |

Cada comando tem seu próprio `--help` (`paprika serve --help`, `paprika help export`). As flags podem vir antes ou depois dos posicionais. `paprika version` e `-v`/`--version` imprimem a versão. O texto de ajuda segue em português por enquanto.

Autocompletar no shell para bash, zsh e fish:

```bash
source <(paprika completion bash)
paprika completion zsh > "${fpath[1]}/_paprika"
paprika completion fish > ~/.config/fish/completions/paprika.fish
```

Um comando desconhecido sai com código 2 e sugere o mais parecido; uma flag inválida ou qualquer erro em execução sai com código 1.

Padrões: `--db` é `./paprika.db` (ou `$PAPRIKA_DB`); `--doc` é o documento atualizado mais recentemente, e um vazio é criado quando o banco está vazio. `--web` (uma pasta cuja entrada é `_shell.html` ou `index.html`) usa `$PAPRIKA_WEB_ROOT` e depois o app (`apps/web/dist/client`, ou `web` ao lado do binário).

## Armazenamento

| Tabela | Conteúdo |
|---|---|
| `documents` | id, formato, nome, `root_ids` (JSON), versão, datas |
| `tokens` | uma linha por token: nome, valor JSON, ordem |
| `modes` | uma linha por modo de tema (`document.modes`): nome, ordem e os tokens que ele sobrescreve, em JSON |
| `nodes` | uma linha por nó: id, `parent_id`, `type`, `name`, ordem e o JSON validado do nó em `data` |
| `history` | pilhas de desfazer e refazer: autor, rótulo, ops, ops inversas, horário |

Cada mudança (documento + histórico) é uma transação SQLite, gravada antes de o agente ou o canvas receber a resposta, então o undo/redo sobrevive a reinícios. Só os nós e tokens alterados são regravados. Dois processos no mesmo banco (`serve` + `mcp`) enxergam as gravações um do outro em ~300 ms (`PRAGMA data_version`). As tabelas foram pensadas para leitura com SQL simples, por exemplo `sqlite3 design.db "SELECT id, name FROM nodes WHERE type = 'text'"`; escreva pelo servidor, para valer a validação e o histórico.

## Estrutura

```
cmd/paprika        CLI
contract/          contrato MCP servido como está (definições das ferramentas, instruções, guia pt-BR) + script de medida do @paprika/core
internal/jsonv     valores JSON com semântica de JavaScript (ordem de chaves, formato de números, JSON.stringify)
internal/zod       o subconjunto do zod v4 usado pelo core, com as mesmas mensagens
internal/core      port de @paprika/core: schema, applyOps, History, nodeStyle, render/export, lint, outline, path
internal/server    store SQLite, MCP (JSON-RPC via stdio e HTTP), API HTTP, WebSocket, screenshot (chromedp)
scripts/           geradores das fixtures e do script de medida (rodam com Node sobre o build do @paprika/core)
```

## Testes e o core de referência

O `@paprika/core` (TypeScript) continua sendo a referência: o canvas roda ele, e o `internal/core` precisa produzir os mesmos resultados. Três camadas conferem o servidor:

1. **Fixtures golden** (`internal/core/testdata/golden.json`, de `scripts/gen-golden.mjs`): resultados e erros de operações, JSON de erro do zod, histórico, outline, lint, HTML, React, CSS de cada nó de 23 documentos, parse/bounds de paths, cores, import de SVG/HTML, export SVG (a partir do `layout(doc)`, mais overrides opcionais de medida sintética) e 500 passos aleatórios com semente. O `go test` compara byte a byte.
2. **Suíte black-box da API** (`packages/e2e/test/api.test.ts`): MCP via HTTP e stdio (incluindo o contrato servido), WebSocket, API HTTP e checagem de Host/Origin, contra um processo servidor.
3. **E2E do canvas** (`packages/e2e/test/e2e`): o Playwright dirige o canvas servido pelo binário, incluindo o renderizador WASM.

```bash
pnpm go:test            # go vet + go test (fixtures, SQLite, MCP, HTTP, WebSocket)
pnpm test:api           # suíte black-box da API contra server/bin/paprika
pnpm test:e2e           # E2E do canvas contra server/bin/paprika
pnpm check              # tudo + falha se as fixtures ou o script de medida estiverem desatualizados
```

`PAPRIKA_SERVER_BIN=<caminho>` roda as duas suítes contra outro binário.

Depois de mudar `packages/core`: `pnpm build && pnpm go:golden`, e faça o `pnpm go:test` passar de novo. O contrato MCP (`contract/mcp.json`, `contract/guide.pt-BR.md`) é editado à mão: uma ferramenta nova ou alterada atualiza ele, o handler em `internal/server/mcp.go`, um teste Go e um cenário na suíte da API.

## Notas de comportamento

- `GET /api/health` devolve `file` (o caminho do banco), `storage: "sqlite"` e `docId`. `GET /api/export` baixa o documento ativo como `.paprika.json`.
- Os workspaces são os documentos do banco; `open_workspace` carrega o histórico de undo gravado daquele documento.
- Sem observação de arquivo: edite um `.paprika.json` e rode `import --replace`, ou passe pelo servidor.
- `GET /mcp` responde 405 (servidor sem estado, sem stream SSE avulso; os clientes MCP lidam com isso).
- Um undo que falha mantém a entrada no histórico em vez de descartá-la.

## Limitações conhecidas

- Contas de ponto flutuante (`Math.pow`, `sin`, `cos`) podem diferir do V8 no último bit; as fixtures passam hoje, mas um path cujos bounds caiam exatamente num limite de arredondamento poderia arredondar diferente.
- O erro do WebSocket para JSON malformado tem texto diferente da mensagem do `JSON.parse`.
- Sem autenticação: `--host 0.0.0.0` expõe o documento na rede.
