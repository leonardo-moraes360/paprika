[🇺🇸 English](README.md) | 🇧🇷 Português

# Servidor do Paprika em Go

Uma implementação em Go do servidor do Paprika com o mesmo contrato do servidor TypeScript (`packages/server`): as mesmas 17 ferramentas MCP (stdio e Streamable HTTP em `/mcp`), as mesmas operações e o mesmo undo/redo compartilhado, o mesmo protocolo WebSocket do canvas (`/ws`), a mesma API HTTP e o mesmo lint, export e screenshot. Os dados ficam em **SQLite**; arquivos `.paprika.json` entram e saem com `import` e `export`. Por que e como: [ADR 0001](../docs/pt-BR/adr/0001-servidor-go-sqlite.md).

## Compilar e rodar

Requisitos: Go 1.25+ (o comando `go` baixa o toolchain se precisar). O Chromium só é necessário para screenshots.

```bash
pnpm install && pnpm build            # compila o canvas (apps/web/dist) que o servidor Go serve
pnpm go:build                         # → server-go/bin/paprika

B=server-go/bin/paprika
$B import examples/demo.paprika.json --db design.db   # imprime o id do documento
$B serve --db design.db
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
$B export --db design.db -o design.paprika.json       # de volta para um arquivo, por exemplo para commitar
```

Conecte um agente do mesmo jeito que no servidor TypeScript:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

ou via stdio:

```json
{ "mcpServers": { "paprika": { "command": "<CAMINHO>/server-go/bin/paprika", "args": ["mcp", "--db", "<CAMINHO>/design.db"] } } }
```

## Comandos

| Comando | O que faz |
|---|---|
| `paprika serve [--db F] [--doc ID] [--port 4777] [--host 127.0.0.1] [--web DIR]` | Canvas, API HTTP, MCP via HTTP e WebSocket |
| `paprika mcp [--db F] [--doc ID] [--port 4777] [--no-ui]` | MCP via stdio; também serve o canvas se a porta estiver livre |
| `paprika import ARQUIVO.paprika.json [--db F] [--replace]` | Valida e grava um documento (o histórico começa vazio) |
| `paprika export [--db F] [--doc ID] [-o ARQUIVO]` | Escreve o documento como `.paprika.json` (stdout sem `-o`) |
| `paprika list [--db F]` | Lista os documentos do banco |

Padrões: `--db` é `./paprika.db` (ou `$PAPRIKA_DB`); `--doc` é o documento atualizado mais recentemente, e um vazio é criado quando o banco está vazio. `--web` usa `$PAPRIKA_WEB_ROOT` e depois `apps/web/dist` ao lado do binário ou no diretório atual.

## Armazenamento

| Tabela | Conteúdo |
|---|---|
| `documents` | id, formato, nome, `root_ids` (JSON), versão, datas |
| `tokens` | uma linha por token: nome, valor JSON, ordem |
| `nodes` | uma linha por nó: id, `parent_id`, `type`, `name`, ordem e o JSON validado do nó em `data` |
| `history` | pilhas de desfazer e refazer: autor, rótulo, ops, ops inversas, horário |

Cada mudança (documento + histórico) é uma transação SQLite, gravada antes de o agente ou o canvas receber a resposta, então o undo/redo sobrevive a reinícios. Só os nós e tokens alterados são regravados. Dois processos no mesmo banco (`serve` + `mcp`) enxergam as gravações um do outro em ~300 ms (`PRAGMA data_version`). As tabelas foram pensadas para leitura com SQL simples, por exemplo `sqlite3 design.db "SELECT id, name FROM nodes WHERE type = 'text'"`; escreva pelo servidor, para valer a validação e o histórico.

## Estrutura

```
cmd/paprika        CLI
contract/          contrato MCP extraído do servidor TypeScript (tools/list, instruções), embutido
internal/jsonv     valores JSON com semântica de JavaScript (ordem de chaves, formato de números, JSON.stringify)
internal/zod       o subconjunto do zod v4 usado pelo core, com as mesmas mensagens
internal/core      port de @paprika/core: schema, applyOps, History, nodeStyle, render/export, lint, outline, path
internal/server    store SQLite, MCP (JSON-RPC via stdio e HTTP), API HTTP, WebSocket, screenshot (chromedp)
scripts/           geradores de fixtures e do contrato (rodam com Node sobre o build TypeScript)
```

## Paridade com o servidor TypeScript

O core TypeScript é a referência. Três camadas conferem que o servidor Go se comporta igual:

1. **Fixtures golden** (`internal/core/testdata/golden.json`, de `scripts/gen-golden.mjs`): resultados e erros de operações, JSON de erro do zod, histórico, outline, lint, HTML, React, CSS de cada nó de 23 documentos, parse/bounds de paths, cores e 500 passos aleatórios com semente. O `go test` compara byte a byte.
2. **Suíte black-box** (`packages/server/test/external/parity.test.ts`): MCP via HTTP e stdio, WebSocket, API HTTP e checagem de Host/Origin, contra um processo servidor.
3. **E2E do canvas** (`packages/server/test/e2e`): a mesma suíte Playwright, com o binário Go por trás do canvas.

```bash
pnpm go:test            # go vet + go test (fixtures, SQLite, MCP, HTTP, WebSocket)
pnpm test:parity        # suíte black-box contra o servidor TypeScript
pnpm test:parity:go     # … contra o servidor Go
pnpm test:e2e:go        # E2E do canvas contra o servidor Go
pnpm check:go           # tudo acima + falha se as fixtures ou o contrato estiverem desatualizados
```

Depois de mudar `packages/core` ou as ferramentas MCP em TypeScript: `pnpm build && pnpm go:golden`, e faça o `pnpm go:test` passar de novo.

## Diferenças em relação ao servidor TypeScript

- Armazenamento: SQLite (`--db`, `--doc`) em vez de `--file`; sem observação de arquivo.
- `GET /api/health` devolve `file` (o caminho do banco), `storage: "sqlite"` e `docId`. Novo `GET /api/export`.
- `GET /mcp` responde 405 (servidor sem estado, sem stream SSE avulso; os clientes MCP lidam com isso).
- Um undo que falha mantém a entrada no histórico em vez de descartá-la.

## Limitações conhecidas

- Contas de ponto flutuante (`Math.pow`, `sin`, `cos`) podem diferir do V8 no último bit; as fixtures passam hoje, mas um path cujos bounds caiam exatamente num limite de arredondamento poderia arredondar diferente.
- O erro do WebSocket para JSON malformado tem texto diferente da mensagem do `JSON.parse`.
- Como no servidor TypeScript: sem autenticação (`--host 0.0.0.0` expõe o documento), e o guia e os erros voltados ao agente estão em português.
