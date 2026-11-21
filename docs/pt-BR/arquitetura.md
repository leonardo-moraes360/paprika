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

1. **Mapa plano de nós + `children` em frames.** Acesso O(1) por id para o agente, árvore explícita para render. `parseDocument` valida integridade (sem órfãos, sem duplicados, `parentId` coerente).
2. **Uma única porta de escrita: `applyOps`.** Canvas, MCP e `POST /api/ops` geram as mesmas operações. A transação roda num clone e só substitui o documento se todas as operações passarem. Cada transação gera as operações inversas, que alimentam o undo/redo compartilhado.
3. **Rejeitar campos desconhecidos.** Zod descartaria em silêncio (`colour` em vez de `color`); para agentes, um erro explícito é mais barato que um design errado.
4. **Um motor de estilo.** `nodeStyle` gera o CSS usado pelo canvas, pelo HTML do screenshot e pelo export React. O que o agente confere no PNG é o que o humano vê. Para nós `path`, `pathAttrs` faz o mesmo papel para os atributos de `<svg>`/`<path>`, e `packages/core/src/path.ts` (parser, normalização, caixa exata de bezier e arcos) roda igual no servidor, no canvas e nos testes; `d` inválido é rejeitado com a posição do caractere.
5. **Arquivo é a fonte da verdade.** Escrita atômica (tmp + rename), serializada; `fs.watch` recarrega mudanças externas (git checkout, outro processo) e zera o histórico.
6. **MCP HTTP stateless.** Um `McpServer` por requisição: sem sessões para vazar; o estado vive no `DocumentStore`. As ferramentas de escrita só respondem depois do flush em disco.
7. **Local primeiro.** Bind em loopback com validação de Host/Origin. Sem autenticação nem multiusuário nesta versão.

## Limitações conhecidas (v0.1)

- Um processo por arquivo: dois processos escrevendo o mesmo arquivo seguem "último a gravar vence" (o watch recarrega, mas não faz merge). Para usar MCP e canvas juntos, prefira `paprika serve` + MCP HTTP.
- Sem componentes/instâncias, operações booleanas entre paths, edição ponto a ponto de paths no canvas (a caneta cria paths novos; os existentes se editam pelo `d`), gradientes estruturados, múltiplas páginas, rotação no hit-test do canvas ou seleção múltipla.
- O lint de contraste ignora gradientes e imagens de fundo.
- Arrastar no canvas só move nós em pais sem layout automático (em row/column a ordem vem do layout).
