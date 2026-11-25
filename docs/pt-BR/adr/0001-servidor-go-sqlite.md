[🇺🇸 English](../../en-US/adr/0001-go-server-sqlite.md) | 🇧🇷 Português

# ADR 0001: servidor em Go com armazenamento em SQLite

- Status: aceita (2026-11-21); emendada em 2026-11-21 (veja [Desdobramento](#desdobramento-servidor-typescript-removido))
- Escopo: `server/` (novo). O servidor TypeScript (`packages/server`) e o core (`packages/core`) continuam como estão.

## Contexto

O dono do projeto pediu para reimplementar o servidor do Paprika em Go, mantendo o mesmo contrato: as ferramentas MCP, o formato `.paprika.json`, operações atômicas com undo/redo compartilhado, sync ao vivo do canvas via WebSocket, lint e export. Durante o trabalho, perguntou onde os dados ficam (na época, só no arquivo JSON) e escolheu SQLite. Perguntado sobre o papel do SQLite, escolheu **"Só SQLite, JSON por import/export"**.

## Decisão

1. **Um binário Go** (`server/cmd/paprika`) com `serve`, `mcp` (stdio), `import`, `export` e `list`.
2. **O SQLite é o único armazenamento** do servidor Go (driver em Go puro, `modernc.org/sqlite`, sem cgo). Tabelas: `documents`, `tokens`, `nodes` (uma linha por nó, com o JSON validado e as colunas `type`/`name`/`parent_id` para consultas SQL simples), `history` (pilhas de desfazer e refazer) e `meta`. Um banco guarda vários documentos; cada processo serve um deles (`--doc`; padrão: o atualizado mais recentemente).
3. **O `.paprika.json` só entra e sai por `paprika import` / `paprika export`** (e `GET /api/export`). Não há espelho automático nem observação de arquivo. A saída do `export` é idêntica byte a byte ao arquivo do servidor TypeScript (`JSON.stringify(doc, null, 2)` + quebra de linha), então continua versionável no git.
4. **Undo/redo sobrevive a reinícios**: as duas pilhas são gravadas na mesma transação SQLite da mudança no documento.
5. **Toda escrita é gravada antes de ser confirmada** (ferramentas MCP, `POST /api/ops`, `ack` do WebSocket). Se a gravação falha, o estado em memória volta ao anterior.
6. **Dois processos no mesmo banco** (por exemplo `paprika serve` e `paprika mcp` via stdio) enxergam as gravações um do outro: cada processo consulta `PRAGMA data_version` e recarrega documento e histórico quando outra conexão gravou. Isso substitui o watcher de arquivo do servidor TypeScript.
7. **O core TypeScript continua sendo a referência.** `server/internal/core` é um port de `@paprika/core` (schema, `applyOps`, `History`, `nodeStyle`, render/export, lint, outline, path). A paridade é travada por fixtures geradas a partir do core TypeScript (`server/scripts/gen-golden.mjs`): 72 casos de operações, 23 documentos (outline, lint, HTML, React e CSS por nó), 21 paths, cores e 25 execuções aleatórias com semente (500 passos de transações, undo e redo). Os testes Go precisam reproduzir cada saída byte a byte. As mensagens de validação vêm de um port pequeno do zod v4 (`internal/zod`), para o agente receber exatamente os mesmos erros.
8. **O contrato MCP é compartilhado, não redescrito.** `server/scripts/gen-contract.mjs` extrai `tools/list`, as instruções e o server info do servidor TypeScript para `server/contract/mcp.json`, que o binário Go embute e serve sem alterações.

## Consequências

- O canvas (`apps/web`) não muda e continua usando o `nodeStyle` TypeScript; o servidor Go serve o build dele.
- Toda mudança em `packages/core` ou nas ferramentas MCP precisa de `pnpm go:golden` e de `pnpm go:test` passando; `pnpm check:go` falha se as fixtures estiverem desatualizadas.
- As mesmas suítes black-box rodam contra os dois servidores: `packages/server/test/external/parity.test.ts` e o E2E do canvas (`PAPRIKA_SERVER_BIN=…`).
- Diferenças em relação ao servidor TypeScript: armazenamento (SQLite em vez do arquivo), `/api/health` informa o caminho do banco em `file` mais `storage` e `docId`, o `GET /api/export` a mais, `GET /mcp` responde 405 (servidor sem estado, sem stream SSE avulso) e o histórico mantém a entrada quando um undo falha em vez de descartá-la.
- Screenshots usam Chromium headless via CDP (`chromedp`), encontrado por `PAPRIKA_CHROMIUM`, pelo cache de navegadores do Playwright ou no sistema.

## Alternativas consideradas

- **SQLite como fonte com o JSON espelhado a cada mudança** (recomendada no início): mantém o fluxo com git automático, mas duas fontes de verdade exigiriam tratar conflitos. Não foi a escolha do dono.
- **JSON como fonte e SQLite só para o histórico**: a menor mudança, mas não atende a "guardar os dados num banco".
- **Rodar o core TypeScript dentro do Go (goja/V8)** para evitar o port: sem lógica duplicada, mas pesado, mais lento e difícil de depurar; as fixtures golden dão a mesma garantia.

## Desdobramento: servidor TypeScript removido

- Data: 2026-11-21. Decisão do dono: manter só o servidor Go.
- O `packages/server` foi apagado. As suítes black-box foram para `packages/e2e` e rodam só contra o binário Go (`test:api`, a antiga suíte de paridade, e `test:e2e`); a CI roda cada uma uma vez em vez de uma vez por servidor.
- A decisão 8 muda: não há mais servidor TypeScript de onde extrair o contrato, então `server/contract/mcp.json` e `guide.pt-BR.md` passam a ser o próprio contrato, editados à mão e conferidos por `packages/e2e/test/api.test.ts`. O `scripts/gen-contract.mjs` virou `scripts/gen-measure.mjs`, que só copia o script de medida do `@paprika/core`.
- A decisão 7 continua: o `packages/core` segue como referência (o canvas roda ele) e as fixtures golden continuam travando o port Go nele.
