[🇺🇸 English](../architecture.md) | 🇧🇷 Português

# Arquitetura

```
 agente (Claude Code, Cursor…)            humano (navegador)
        │ MCP stdio | Streamable HTTP /mcp        │ WebSocket /ws
        ▼                                         ▼
 ┌──────────────────────── server-go (paprika) ────────────────┐
 │ MCP (JSON-RPC) ──┐                       ┌── API HTTP + /ws  │
 │                  ▼                       ▼                   │
 │        Store  (internal/core: applyOps + History, SQLite)    │
 └───────────────────────────┬─────────────────────────────────┘
                             ▼
                    paprika.db (SQLite) ── import/export ── design.paprika.json (git)

 ┌──────────────── @paprika/core (TypeScript) ─────────────────┐
 │ schema (zod) · applyOps (transação) · History (undo/redo)    │
 │ nodeStyle → canvas React · renderHTML · exportReact          │
 │ lintDocument · outline/queryNodes      (referência do Go)    │
 └──────────────────────────────────────────────────────────────┘
```

## Decisões

1. **Mapa plano de nós + `children` em contêineres (`frame`, `group`, `page`).** Acesso O(1) por id para o agente, árvore explícita para render. `parseDocument` valida integridade (sem órfãos, sem duplicados, `parentId` coerente, páginas só no topo e, havendo uma página, só páginas no topo).
2. **Uma única porta de escrita: `applyOps`.** Canvas, MCP e `POST /api/ops` geram as mesmas operações. A transação roda num clone e só substitui o documento se todas as operações passarem. Cada transação gera as operações inversas, que alimentam o undo/redo compartilhado.
3. **Rejeitar campos desconhecidos.** Zod descartaria em silêncio (`colour` em vez de `color`); para agentes, um erro explícito é mais barato que um design errado.
4. **Um motor de estilo.** `nodeStyle` gera o CSS usado pelo canvas, pelo HTML do screenshot e pelo export React. O que o agente confere no PNG é o que o humano vê. Para nós `path`, `pathAttrs` faz o mesmo papel para os atributos de `<svg>`/`<path>`, e `packages/core/src/path.ts` (parser, normalização, caixa exata de bezier e arcos) roda igual no servidor, no canvas e nos testes; `d` inválido é rejeitado com a posição do caractere.
5. **SQLite é a fonte da verdade.** Documentos, tokens e o histórico de undo/redo ficam no SQLite ([ADR 0001](adr/0001-servidor-go-sqlite.md)); cada mudança é uma transação gravada antes da resposta. O `.paprika.json` entra e sai só por `paprika import`/`export`.
6. **MCP HTTP stateless.** Sem estado de servidor por conexão para vazar (o `Mcp-Session-Id` só carrega o nome do cliente); o estado vive no store. As ferramentas de escrita só respondem depois da gravação.
7. **Local primeiro.** Bind em loopback com validação de Host/Origin. Sem autenticação nem multiusuário nesta versão.
8. **Operações compostas se expandem dentro da transação.** `group`, `ungroup` e `add_page` também são operações, mas o `applyOps` as transforma em create/move/update/delete contra o documento *como ele está naquele momento* (`packages/core/src/structure.ts`): um canvas ou agente com uma cópia um pouco velha ainda recebe o resultado certo, numa só entrada de desfazer. A caixa de um grupo é derivada: no fim de cada transação o `fitGroups` ajusta cada grupo aos filhos (do mais fundo para o mais raso) e os desloca para nada se mover na tela; a inversa só guarda posições, e `width`/`height` de grupo são recusados na entrada.
9. **Instâncias são cópias derivadas.** Um componente é um frame com `component: true`; uma instância é um frame com `instanceOf`, `scale` opcional e `overrides` (por id de nó do componente, só `fill`, `color`, `text`, `src`, `alt`, `visible`, `opacity`; `fill` na raiz). No fim de cada transação o `syncInstances` (`packages/core/src/component.ts`) checa as regras e refaz os filhos de cada instância a partir do componente, com ids determinísticos (`copyId`, FNV-1a de instância + id de origem, igual no Go) e `sourceId` em cada cópia. As cópias são nós comuns, então renderizadores, export e lint funcionam sem mudança; como são derivadas, o desfazer nunca as guarda: desfazer a mudança no componente ou na instância e sincronizar de novo basta. Um `update` numa cópia vira override; mover, apagar ou criar filhos dentro de uma instância é recusado. `detach` transforma a instância num frame comum com os mesmos ids.
10. **Import e export SVG são funções puras no core; o navegador só mede.** `importSVG` e `importHTML` (`packages/core/src/svgImport.ts`, `htmlImport.ts`, sobre um leitor tolerante em `markup.ts`) devolvem árvores `NodeInput` mais `warnings`, e quem chama grava com ops `create` comuns, então colar é um passo de desfazer e passa pela mesma validação. `importHTML` é o inverso do `nodeStyle`: o HTML do `renderHTML` (que marca cada elemento com `data-paprika-type`) volta com os mesmos tipos e campos. `exportSVG` monta o SVG a partir do documento mais um `Measure` (caixas antes da rotação e linhas de texto já quebradas) que o `MEASURE_SCRIPT` coleta do HTML de export num Chromium, então layout automático, `hug`/`fill` e quebra de texto batem com o screenshot sem um motor de layout no core; o servidor Go embute o mesmo script (`server-go/contract/measure.js`).
11. **Presença do agente é implícita e efêmera.** O agente não chama uma ferramenta de presença: toda chamada MCP que chega ao handler reporta `{agent, actor, tool, nodes}` ao `PresenceHub` do store (`server-go/internal/server/presence.go`), e o `/ws` difunde como `{type: "presence", agent, actor, tool, nodes, idle}`. `nodes` são os ids que a chamada criou ou, se nenhum, os ids citados nos argumentos (que ainda existem); `agent` é um hash do `Mcp-Session-Id` do HTTP (duas sessões do mesmo cliente são dois agentes) ou o ator no stdio. A presença nunca toca o documento, o histórico nem o disco; um canvas que conecta recebe, logo depois do documento, a última presença de cada agente dos últimos 2 minutos. O canvas mede os nós no DOM (então layout automático e `hug` ficam certos) e desenha cursor, contorno e lista (`apps/web/src/AgentCursors.tsx`).

11. **Workspace = documento, um ativo por servidor.** A página inicial lista os documentos do banco do servidor. O `Store` mantém um documento ativo; `openWorkspace` troca esse documento no lugar e emite uma mudança com kind `open`, então o WebSocket, a API HTTP e toda ferramenta MCP acompanham sem encanamento novo. Canvas e agentes compartilham o workspace ativo de propósito: o humano vê o que o agente edita. O histórico de undo é de cada workspace e fica gravado no SQLite, então sobrevive à troca. O workspace ativo é por processo: um `paprika mcp` separado via stdio mantém o seu.
12. **Conectores de diagrama derivam das pontas.** Um nó `shape` (rect, ellipse, diamond, note) é uma caixa com texto dentro, pintada por `shapeAttrs` (um contorno `<svg>` atrás do texto, igual no canvas, screenshot, React e export SVG). Um `connector` guarda só as pontas (`from`/`to`: um `nodeId` com lado opcional, ou um `x`/`y` livre nas coordenadas do pai), a rota (reta ou cotovelo) e a aparência; `x`, `y`, `width`, `height` e `d` são recalculados por `routeConnectors` (`packages/core/src/diagram.ts`) no fim de toda transação, depois da sincronização das instâncias, e são recusados na entrada. Como as cópias de instância, essa geometria não guarda inversa. As pontas são cortadas no contorno da forma usando só `sqrt` (sem trigonometria), então o port em Go dá os mesmos números. Apagar um nó apaga, na mesma operação, os conectores presos a ele (o desfazer traz os dois), e um conector nunca conta na caixa do grupo. `draw_diagram` é uma função pura do documento (`diagramOps`): ordena as formas pelo caminho mais longo (arestas de volta, achadas por DFS, não contam), centraliza cada camada e devolve operações `create` comuns.

## Servidor e core

O `server-go/` é o único servidor; o servidor TypeScript do qual ele foi portado foi removido. O `server-go/internal/core` é um port do `@paprika/core`, que o canvas roda e que continua sendo a referência: fixtures geradas a partir do core TypeScript (`pnpm go:golden`) travam o port Go byte a byte. O contrato MCP (definições das ferramentas, instruções) é o `server-go/contract/mcp.json`, servido como está; o `packages/e2e` confere o binário por fora (MCP, HTTP, WebSocket, canvas).

## Limitações conhecidas (v0.1)

- Dois processos no mesmo banco (`serve` + `mcp`) enxergam as gravações um do outro em ~300 ms, mas cada um mantém o seu workspace ativo. Para usar MCP e canvas juntos, prefira `paprika serve` + MCP HTTP.
- Sem operações booleanas entre paths, edição ponto a ponto de paths no canvas (a caneta cria paths novos; os existentes se editam pelo `d`), gradientes estruturados ou rotação no hit-test do canvas.
- Grupos não têm rotação própria (gire os filhos), e filhos com tamanho `hug`/`fill` contam como um ponto no ajuste da caixa. Nós dentro de um frame row/column não podem ser agrupados (a posição vem do fluxo).
- Ainda não dá para pôr instâncias dentro de componentes, e só campos de aparência aceitam override (sem props nem slots de componente). `scale` não escala um `fontSize` que é token.
- O lint de contraste ignora gradientes e imagens de fundo.
- A presença do agente só chega aos canvas do mesmo processo: um `paprika mcp` (stdio) cuja porta estava ocupada roda sem canvas, então o cursor dele não aparece no canvas do `paprika serve`. Use MCP via HTTP para ser visto.
- O import de SVG ignora texto, imagens, gradientes/padrões (viram cinza), máscaras, clip paths e CSS de `<style>`; o import de HTML só lê `style=""` inline (sem classes nem folhas de estilo). O export SVG deixa de fora gradientes e imagens de fundo, desenha sombras sem spread e precisa de um navegador para layout automático (`export_code` e `/api/svg` medem num Chromium headless).
- Arrastar no canvas só move nós em pais sem layout automático (em row/column a ordem vem do layout).

## Registros de decisão

- [ADR 0001: Servidor em Go com SQLite](adr/0001-servidor-go-sqlite.md): aceito.
- [ADR 0002: Renderizador do canvas em Rust/WASM (WebGPU com fallback para CPU)](adr/0002-renderizador-canvas-rust-wasm.md): aceito como renderizador híbrido opcional; o DOM continua padrão.
- [ADR 0003: Tailwind CSS na interface do app do canvas](adr/0003-tailwind-css.md): aceito; Tailwind v4 sem Preflight, para o CSS do app nunca mudar como um documento é renderizado.
