[🇺🇸 English](README.md) | 🇧🇷 Português

<p align="center"><img src="docs/brand/icon.svg" alt="Ícone do Paprika" width="128"></p>

# Paprika

Ferramenta de design **local** para agentes de IA, com **servidor MCP embutido**.
Você e o agente editam o mesmo documento ao mesmo tempo: o agente via MCP, você no canvas do navegador.
Toda edição dos dois passa pelo mesmo caminho (operações atômicas validadas), entra no mesmo histórico de desfazer e é salva em um arquivo `.paprika.json` versionável no git.

> Projeto original. O Paper (paper.design) foi apenas referência de conceito ("canvas em HTML/CSS conectado a agentes"); nenhum código, asset ou comportamento foi copiado ou obtido por engenharia reversa.

## Por que

| Problema com agentes em ferramentas de design | Como o Paprika resolve |
|---|---|
| Agente gasta tokens lendo árvores enormes | `get_document_outline`: uma linha por nó, com profundidade configurável |
| Edição parcial deixa o arquivo quebrado | Toda escrita é uma transação: tudo ou nada |
| Campos com typo somem em silêncio | Campos desconhecidos são rejeitados com mensagem acionável |
| Agente não sabe se ficou bom | `lint_design` (contraste WCAG, overflow, tokens) + `render_screenshot` |
| O que o agente vê ≠ o que o humano vê ≠ o código | Um único motor de estilo (`nodeStyle`) para canvas, screenshot e export |
| Limite de chamadas / SaaS | 100% local, sem conta, sem limite |

## Início rápido

Requisitos: Node 22+ e pnpm 10+.

```bash
pnpm install
pnpm build
node packages/server/dist/cli.js serve --file examples/demo.paprika.json
# canvas: http://127.0.0.1:4777   ·   MCP: http://127.0.0.1:4777/mcp
```

Screenshot pelo MCP usa Playwright (dependência opcional). Se o Chromium não estiver instalado:

```bash
pnpm --filter @paprika/server exec playwright install chromium
```

## Conectar um agente

**HTTP (recomendado, com o canvas aberto):** rode `paprika serve` e aponte o agente para `http://127.0.0.1:4777/mcp`.

Claude Code:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

**stdio** (agentes que só falam stdio). O processo também sobe o canvas na porta 4777, se estiver livre:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "node",
      "args": ["<CAMINHO>/paprika/packages/server/dist/cli.js", "mcp", "--file", "<CAMINHO>/design.paprika.json"]
    }
  }
}
```

## Ferramentas MCP

| Ferramenta | O que faz |
|---|---|
| `get_design_guide` | Modelo de nós, campos e fluxo recomendado |
| `get_document_outline` | Árvore compacta + tokens + versão |
| `get_nodes` / `find_nodes` | JSON completo de nós / busca por tipo, nome, texto |
| `create_nodes` | Cria árvores aninhadas numa chamada |
| `update_nodes` / `move_nodes` / `delete_nodes` | Edição em lote, atômica |
| `apply_ops` | Transação mista (create, update, delete, move, set_tokens, rename_document) |
| `set_tokens` | Design tokens (`$nome`) para cores e tamanhos |
| `undo` / `redo` / `get_history` | Histórico compartilhado com o humano |
| `lint_design` | Contraste WCAG AA, overflow, tokens inexistentes, texto pequeno, alt |
| `render_screenshot` | PNG de um nó ou do canvas |
| `export_code` | HTML autocontido ou componente React (TSX) |

## Canvas

Atalhos: `V` selecionar, `F` frame, `R` retângulo, `O` elipse, `T` texto, `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D` duplicar, `Delete`, setas (Shift = 10px), `Esc` sobe para o pai.
Navegação: rolar = pan, `Ctrl`+rolar = zoom, segurar `Espaço` (ou `Enter`) e arrastar = pan (o cursor vira uma mão).
Edições do agente piscam no canvas e aparecem em "Atividade".

## Formato do documento

```jsonc
{
  "format": "paprika/1",
  "name": "Demo",
  "tokens": { "brand": "#c43d27", "text.md": 16 },
  "rootIds": ["login"],
  "nodes": {
    "login": { "type": "frame", "id": "login", "parentId": null, "width": 390, "height": 760,
               "layout": { "mode": "column", "gap": 20, "padding": 24 }, "children": ["t1"] },
    "t1": { "type": "text", "id": "t1", "parentId": "login", "text": "Olá", "color": "$brand",
            "width": "fill", "height": "hug" }
  }
}
```

Tipos: `frame` (único com filhos; layout livre, linha ou coluna), `rect`, `ellipse`, `text`, `image`.
Tamanhos: número, `"hug"` (conteúdo) ou `"fill"` (ocupa o espaço do pai). Detalhes em [docs/pt-BR/arquitetura.md](docs/pt-BR/arquitetura.md).

## Estrutura

```
packages/core     modelo (zod), applyOps atômico, History, nodeStyle, render/export, lint, outline
packages/server   DocumentStore (arquivo + watch), MCP (stdio e HTTP), WebSocket, screenshot, CLI
apps/web          canvas React + Vite
examples/         demo gerada por um agente via MCP (packages/server/scripts/seed-demo.mjs)
```

## Desenvolvimento

```bash
pnpm check        # build + typecheck + testes unitários/integração + E2E (Playwright)
pnpm dev          # servidor com o demo; em outro terminal: pnpm --filter @paprika/web dev
```

Este repositório usa o [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) como harness: invariantes em `.toolbelt/invariants.yaml` (`tb mem list`) e `tb verify run` / `tb stack verify guard` antes de concluir.

## Segurança

- Bind em `127.0.0.1` por padrão; Host e Origin são validados (bloqueia DNS rebinding e CSRF de páginas abertas no navegador).
- Não há autenticação: `--host 0.0.0.0` expõe o documento para a rede. Use só em rede confiável.
- Imagens `https://` são carregadas pelo Chromium no screenshot.

## Licença

MIT
