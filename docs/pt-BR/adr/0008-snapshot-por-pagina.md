[🇺🇸 English](../../en-US/adr/0008-page-snapshots.md) | 🇧🇷 Português

# ADR 0008: Abrir o workspace uma página por vez

- **Status:** Proposto
- **Data:** 2026-11-26
- **Código:** `server/internal/server` (`serveWS`, outbox, delta), `apps/web/src/useDocument.ts` e quem lê `doc.nodes`
- **Backlog:** PAP-A-071 (este ADR), PAP-A-070 (compressão, feito), PAP-A-072 (abertura fria no servidor)

## Contexto

Quando uma aba abre `/w/<id>`, ela manda `{"type":"view"}` e o servidor responde com uma única mensagem
`{"type":"doc"}` com o workspace inteiro: todas as páginas, nós, tokens e assets. Depois disso só trafegam
deltas (PAP-A-057). O primeiro load cresce com o workspace inteiro, não com o que a pessoa está vendo.

Medido em 2026-11-26 (main 994e913, Chromium headless, renderizador DOM):

| Workspace | Nós | JSON do snapshot | No fio com deflate (PAP-A-070) | Até pronto, local |
|---|---|---|---|---|
| Workspace real do mantenedor | 17.139 | 8,4 MB | 1,25 MB | 1,1 s |
| Cópia 3× | 51.417 | 25,3 MB | 3,8 MB | 2,5 s |
| Cópia 6× | 102.834 | 50,7 MB | 7,6 MB | 5,0 s |

A compressão tira a maior parte dos bytes, mas não o crescimento, e não muda o tempo de parse e render na
aba, que também cresce com o documento inteiro. Com a CPU 4× mais lenta, o workspace real leva 3,1 s até
aparecer, e só 0,6 s disso é transferência.

A página aberta é uma parte pequena do documento. Contando os nós dela, os másters de componentes que as
instâncias usam (`sourceId`, `instanceOf`, recursivo) e seus ancestrais:

| Página do workspace real | Nós enviados | De outras páginas | JSON | Com deflate |
|---|---|---|---|---|
| 2 · Editor (maior) | 4.532 | 1.025 | 2,72 MB (33%) | 0,51 MB |
| 3 · Overview e estados | 3.616 | 579 | 1,70 MB (20%) | 0,29 MB |
| 6 · Correções do canvas | 2.592 | 405 | 1,19 MB (14%) | 0,18 MB |
| Capa | 91 | 0 | 0,04 MB (0%) | 0,01 MB |

Opções medidas e descartadas:

- **Fatiar a mesma mensagem:** não reduz bytes nem antecipa o render, porque a aba precisa do JSON inteiro
  para fazer o parse. Só permite uma barra de progresso.
- **Formato binário (MessagePack, CBOR):** cerca de 20% menor bruto e quase nada depois do deflate. O parse
  em JS é mais lento que o `JSON.parse` nativo, e mexe em todos os consumidores.
- **Omitir valores padrão no fio:** 16% menor bruto, 10% depois do deflate.

## Decisão

### 1. O snapshot de abertura leva a página aberta e o que ela usa

A aba declara a capacidade no `hello` (`"pages": true`) e nomeia a página no `view`
(`{"type":"view","workspaceId":…,"pageId":…}`; sem `pageId`, o servidor escolhe a primeira página). O
servidor responde com a mesma mensagem `doc` e um campo `partial`:

```json
{"type":"doc","doc":{…},"version":812,"partial":{"loaded":["<pageId>"]}, …}
```

`doc` mantém o formato (`format`, `id`, `name`, `tokens`, `modes`, `tokenMeta`, `rootIds`, `nodes`), mas
`nodes` traz só:

1. todos os nós de página, como stubs com a lista `children`, para a lista de páginas e a ordem ficarem completas;
2. a subárvore de cada página carregada;
3. o fecho do que essa subárvore referencia: o máster de cada instância (`sourceId`, `instanceOf`),
   recursivo, com a subárvore do máster e seus ancestrais até a página dele.

Tokens, modos e metadados de tokens vão sempre inteiros: são pequenos e toda página lê. Assets (imagens
inline) acompanham os nós que os referenciam.

### 2. As outras páginas carregam sob demanda

Quando a pessoa abre outra página, a aba manda `{"type":"page","pageId":…,"reqId":…}`. O servidor responde
`{"type":"nodes","id":<workspaceId>,"version":<head>,"pageId":…,"nodes":{…}}` com a subárvore e o fecho da
página, e adiciona a página ao conjunto carregado da conexão. Se a aba estiver atrás de `version`, primeiro
aplica os deltas que já tem na fila; se estiver à frente ou perdeu um delta, pede resync, como hoje.

A lista de páginas mostra a página como carregando até a resposta chegar. Opcionalmente, depois que a página
aberta renderizou e a aba está ociosa, ela pode pré-carregar as outras páginas, uma por vez.

### 3. O servidor filtra os deltas por conexão

Cada conexão guarda o conjunto de páginas carregadas. Um delta enviado a uma conexão parcial leva só os nós
das páginas carregadas, mais qualquer nó que uma mudança puxe para o fecho (por exemplo, uma instância criada
numa página carregada cujo máster está numa página não carregada). Remoções sempre vão: apagar um id que a aba
não tem não faz nada. Fazer isso no servidor mantém a regra do fecho num lugar só, junto do core que já
conhece `sourceId` e `instanceOf`.

### 4. Snapshot inteiro continua sendo o padrão

Um cliente que não anuncia `"pages": true` recebe o documento inteiro, como hoje. Isso cobre abas antigas, o
harness de e2e, scripts e qualquer outro consumidor do `/ws`. MCP (`/mcp`), `/api/document`, `/api/export` e o
sync de time (servidor ↔ `paprika-sync`) continuam trabalhando com o documento inteiro no servidor. Agentes
não são afetados.

### 5. Recursos da aba que leem o documento inteiro

Estes leem `doc.nodes` inteiro hoje, e cada um precisa de uma decisão:

| Recurso | Onde | Proposta |
|---|---|---|
| Índice de render, camadas, seleção | `renderIndex.ts`, `Layers.tsx`, `Canvas.tsx` | Já são por página; trabalham com os nós carregados |
| Lint | `lintRunner.ts`, `docLint.ts` | Lint das páginas carregadas; o lint completo continua no MCP (`lint_design`) |
| Nomes padrão ("Retângulo 12") | `Canvas.tsx` | Numerados dentro dos nós carregados, ou atribuídos pelo servidor no create |
| Fontes em uso | `FontPicker.tsx` | Páginas carregadas, mais uma lista que o servidor manda com o snapshot |
| Pular para um nó de outra página (pinos, atividade de agentes, histórico) | `App.tsx` `pageOfNodes` | O servidor manda um `pageOf` para os ids que menciona; a aba carrega a página e depois pula |
| Biblioteca de componentes (inserir instância) | inspector e painel de componentes | Stubs de todos os másters (id, nome, página, tamanho) com o snapshot |
| Busca entre páginas | ainda não existe | Feita pelo servidor quando existir |

## Consequências

- O primeiro load para de crescer com o número de páginas: custa a página aberta e o que ela usa. No
  workspace real isso é 0–33% do documento hoje.
- `doc` deixa de significar "o documento inteiro" para clientes parciais. Todo recurso novo da aba que leia
  `doc.nodes` precisa dizer se precisa de uma página ou de todas.
- O servidor passa a guardar estado por conexão (páginas carregadas) e calcula um fecho em cada delta que
  distribui. Esse custo precisa caber nos orçamentos de escrita atuais (`serverWriteMs`, `wsBytesPerWrite`).
- Orçamentos novos de desempenho: bytes no fio e tempo até pronto no primeiro load do pior caso escalam com a
  página aberta, não com o documento; trocar para uma página ainda não carregada mostra o conteúdo em menos
  de 1 s localmente.
- Estados novos de interface: página carregando, na lista de páginas e no canvas. Eles são desenhados antes
  num Paprika local via MCP (regra 6 do AGENTS), antes de qualquer código.
- Implantação: primeiro servidor e contrato atrás da capacidade no `hello`, depois a aba, recurso por recurso,
  e por fim a aba anuncia `"pages": true` por padrão.
