[🇺🇸 English](../architecture.md) | 🇧🇷 Português

# Arquitetura

```
 agente (Claude Code, Cursor…)            humano (navegador)
        │ MCP stdio | Streamable HTTP /mcp        │ WebSocket /ws
        ▼                                         ▼
 ┌────────────────────── @paprika/server ──────────────────────┐
 │ createMcpServer ──┐                      ┌── startHttpServer │
 │                   ▼                      ▼                   │
 │              DocumentStore  (History + escrita atômica + watch)│
 └───────────────────────────┬─────────────────────────────────┘
                             ▼
 ┌──────────────────────── @paprika/core ──────────────────────┐
 │ schema (zod) · applyOps (transação) · History (undo/redo)    │
 │ nodeStyle → canvas React · renderHTML/screenshot · exportReact│
 │ lintDocument · outline/queryNodes                            │
 └──────────────────────────────────────────────────────────────┘
                             ▼
                    design.paprika.json (git)
```

## Decisões

1. **Mapa plano de nós + `children` em contêineres (`frame`, `group`, `page`).** Acesso O(1) por id para o agente, árvore explícita para render. `parseDocument` valida integridade (sem órfãos, sem duplicados, `parentId` coerente, páginas só no topo e, havendo uma página, só páginas no topo).
2. **Uma única porta de escrita: `applyOps`.** Canvas, MCP e `POST /api/ops` geram as mesmas operações. A transação roda num clone e só substitui o documento se todas as operações passarem. Cada transação gera as operações inversas, que alimentam o undo/redo compartilhado.
3. **Rejeitar campos desconhecidos.** Zod descartaria em silêncio (`colour` em vez de `color`); para agentes, um erro explícito é mais barato que um design errado.
4. **Um motor de estilo.** `nodeStyle` gera o CSS usado pelo canvas, pelo HTML do screenshot e pelo export React. O que o agente confere no PNG é o que o humano vê. Para nós `path`, `pathAttrs` faz o mesmo papel para os atributos de `<svg>`/`<path>`, e `packages/core/src/path.ts` (parser, normalização, caixa exata de bezier e arcos) roda igual no servidor, no canvas e nos testes; `d` inválido é rejeitado com a posição do caractere.
5. **Arquivo é a fonte da verdade.** Escrita atômica (tmp + rename), serializada; `fs.watch` recarrega mudanças externas (git checkout, outro processo) e zera o histórico.
6. **MCP HTTP stateless.** Um `McpServer` por requisição: sem sessões para vazar; o estado vive no `DocumentStore`. As ferramentas de escrita só respondem depois do flush em disco.
7. **Local primeiro.** Bind em loopback com validação de Host/Origin. Sem autenticação nem multiusuário nesta versão.
8. **Operações compostas se expandem dentro da transação.** `group`, `ungroup` e `add_page` também são operações, mas o `applyOps` as transforma em create/move/update/delete contra o documento *como ele está naquele momento* (`packages/core/src/structure.ts`): um canvas ou agente com uma cópia um pouco velha ainda recebe o resultado certo, numa só entrada de desfazer. A caixa de um grupo é derivada: no fim de cada transação o `fitGroups` ajusta cada grupo aos filhos (do mais fundo para o mais raso) e os desloca para nada se mover na tela; a inversa só guarda posições, e `width`/`height` de grupo são recusados na entrada.
9. **Instâncias são cópias derivadas.** Um componente é um frame com `component: true`; uma instância é um frame com `instanceOf`, `scale` opcional e `overrides` (por id de nó do componente, só `fill`, `color`, `text`, `src`, `alt`, `visible`, `opacity`; `fill` na raiz). No fim de cada transação o `syncInstances` (`packages/core/src/component.ts`) checa as regras e refaz os filhos de cada instância a partir do componente, com ids determinísticos (`copyId`, FNV-1a de instância + id de origem, igual no Go) e `sourceId` em cada cópia. As cópias são nós comuns, então renderizadores, export e lint funcionam sem mudança; como são derivadas, o desfazer nunca as guarda: desfazer a mudança no componente ou na instância e sincronizar de novo basta. Um `update` numa cópia vira override; mover, apagar ou criar filhos dentro de uma instância é recusado. `detach` transforma a instância num frame comum com os mesmos ids.

## Servidor em Go

`server-go/` implementa o mesmo servidor em Go, com SQLite como único armazenamento ([ADR 0001](adr/0001-servidor-go-sqlite.md)). As decisões 2, 3, 4, 6 e 7 valem lá também; a decisão 5 é trocada por "o SQLite é a fonte da verdade" (`.paprika.json` por `paprika import`/`export`). O core dele é um port de `@paprika/core` travado por fixtures geradas a partir do core TypeScript, que continua sendo a referência.

## Limitações conhecidas (v0.1)

- Um processo por arquivo: dois processos escrevendo o mesmo arquivo seguem "último a gravar vence" (o watch recarrega, mas não faz merge). Para usar MCP e canvas juntos, prefira `paprika serve` + MCP HTTP.
- Sem operações booleanas entre paths, edição ponto a ponto de paths no canvas (a caneta cria paths novos; os existentes se editam pelo `d`), gradientes estruturados ou rotação no hit-test do canvas.
- Grupos não têm rotação própria (gire os filhos), e filhos com tamanho `hug`/`fill` contam como um ponto no ajuste da caixa. Nós dentro de um frame row/column não podem ser agrupados (a posição vem do fluxo).
- Ainda não dá para pôr instâncias dentro de componentes, e só campos de aparência aceitam override (sem props nem slots de componente). `scale` não escala um `fontSize` que é token.
- O lint de contraste ignora gradientes e imagens de fundo.
- Arrastar no canvas só move nós em pais sem layout automático (em row/column a ordem vem do layout).

## Registros de decisão

- [ADR 0001: Servidor em Go com SQLite](adr/0001-servidor-go-sqlite.md): aceito.
- [ADR 0002: Renderizador do canvas em Rust/WASM (WebGPU com fallback para CPU)](adr/0002-renderizador-canvas-rust-wasm.md): aceito como renderizador híbrido opcional; o DOM continua padrão.
