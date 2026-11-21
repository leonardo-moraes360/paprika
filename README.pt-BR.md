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
| `get_design_guide` | Modelo de nós, campos e fluxo recomendado; em inglês, ou em português com `language: "pt-BR"` |
| `get_document_outline` | Árvore compacta + tokens + versão |
| `get_nodes` / `find_nodes` | JSON completo de nós / busca por tipo, nome, texto |
| `create_nodes` | Cria árvores aninhadas numa chamada |
| `update_nodes` / `move_nodes` / `delete_nodes` | Edição em lote, atômica |
| `group_nodes` / `ungroup_nodes` | Põe nós irmãos num `group` (o desenho não se move) / devolve ao pai |
| `create_page` | Cria uma página; a primeira leva o canvas atual para "Página 1" |
| `create_component` / `create_instance` / `detach_instance` | Marca um frame como componente / põe uma cópia dele (com `scale` e `overrides`; retorna o id de cada cópia) / transforma uma instância em nós comuns |
| `apply_ops` | Transação mista (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach) |
| `set_tokens` | Design tokens (`$nome`) para cores e tamanhos; com `mode`, os valores de um modo de tema (ex.: `dark`) que frames e páginas escolhem com `mode` |
| `undo` / `redo` / `get_history` | Histórico compartilhado com o humano; toda ferramenta de escrita aceita `batch`, e várias chamadas com o mesmo batch viram um passo só de undo |
| `lint_design` | Contraste WCAG AA, overflow, tokens inexistentes, texto pequeno, alt |
| `path_info` | Valida dados de caminho SVG e devolve a caixa exata (com extremos de bezier e arcos) e o `d` normalizado |
| `render_screenshot` | PNG de um nó, de uma página ou do canvas |
| `import_svg` / `import_html` | Transforma SVG colado (paths, formas, grupos, transforms) ou HTML com estilos inline em nós editáveis; o que não dá para importar volta em `warnings` |
| `export_code` | HTML autocontido, componente React (TSX) ou SVG vetorial (layout medido num Chromium headless); `cssVariables: true` escreve os tokens como `var(--nome)`, com uma regra por modo de tema |

Camada de agentes:
- O guia, as descrições das ferramentas, os erros, os avisos e as mensagens do lint são em inglês (o guia também em português, ver acima).
- As ferramentas que respondem JSON declaram `outputSchema` e devolvem `structuredContent`; o bloco de texto continua com o mesmo JSON (no `get_nodes` e no `get_history`, o array puro).
- O histórico identifica o agente pelo `clientInfo.name` do MCP (`agent:claude-code`). No HTTP o servidor é stateless, então o `initialize` devolve um `Mcp-Session-Id` que só guarda esse nome; sem ele, vale o User-Agent, como antes.

## Canvas

Atalhos: `V` selecionar, `F` frame, `R` retângulo, `O` elipse, `T` texto, `P` caneta (clique = vértice reto, clicar e arrastar = alças bezier, clicar no primeiro vértice fecha, `Enter`/`Esc`/duplo clique terminam um traço aberto, `Backspace` remove o último vértice), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D` duplicar, `Delete`, setas (Shift = 10px), `Esc` sobe para o pai.
Seleção: `Shift`+clique (no canvas ou nas camadas) adiciona ou tira um nó, arrastar no vazio desenha a caixa de seleção, `Ctrl+A` seleciona os irmãos (ou a página inteira), `Ctrl+G` agrupa, `Ctrl+Shift+G` desagrupa. Clicar dentro de um grupo seleciona o grupo; duplo clique seleciona o nó sob o cursor. Arrastar, setas, `Delete` e `Ctrl+D` valem para a seleção inteira.

Componentes: "Tornar componente" no inspector de um frame, depois "Nova instância". Clicar dentro de uma instância seleciona a instância; selecione uma cópia nas camadas (ou com duplo clique) para trocar texto, cores, opacidade ou visibilidade. Mudanças no componente chegam a todas as instâncias; "Desanexar" transforma a instância em nós comuns.
Modos de tema: o painel do documento no inspector lista os tokens de cada modo e adiciona um com `dark: bg = #14161f`; "Modo de tema" num frame ou página aplica o modo a tudo que está dentro.
Edição de pontos: duplo clique num vetor edita os pontos. Arraste um ponto (as alças vão junto) ou uma alça (a oposta espelha; segure `Alt` para mover só ela). Duplo clique num ponto alterna entre canto e suave, duplo clique no contorno adiciona um ponto, `Delete` remove o ponto selecionado, `Esc` ou `Enter` terminam. Cada gesto é um passo de desfazer. Curvas quadráticas e arcos viram curvas cúbicas depois da edição.
Colar e exportar: `Ctrl+V` com SVG ou HTML (por exemplo, copiado de uma página web) na área de transferência cria nós editáveis dentro do frame selecionado, ou na página, no centro da tela. O botão `⇩` da barra baixa a seleção (ou a página atual) como SVG.
Páginas: o painel "Páginas" à esquerda troca de página, `+` cria uma (o primeiro `+` transforma o canvas atual na "Página 1"), duplo clique renomeia, `×` apaga (dá para desfazer).
Renomear: duplo clique numa camada do painel "Camadas" ou no título de um frame no canvas renomeia no lugar. `Enter` ou clicar fora confirma, `Esc` cancela; cada renomeação é um passo de desfazer. Cópias de instância herdam o nome do componente.
Navegação: rolar = pan, `Ctrl`+rolar = zoom, segurar `Espaço` (ou `Enter`) e arrastar = pan (o cursor vira uma mão).
Edições do agente piscam no canvas e aparecem em "Atividade".

### Renderizador: DOM ou WASM

O botão à direita do controle de zoom troca como as formas são desenhadas ([ADR 0002](docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md)):

- **DOM** (padrão): cada nó é um elemento HTML estilizado pelo `nodeStyle`, o mesmo motor do screenshot e do export.
- **WASM**: frames, retângulos, elipses e paths são desenhados pelo `crates/render` (Rust, [vello](https://github.com/linebender/vello)) num `<canvas>` abaixo do DOM. Usa **WebGPU** quando o navegador tem um adapter de hardware (o botão mostra `GPU`) e cai para o **vello_cpu** nos outros casos (`CPU`), inclusive quando só existe um adapter WebGPU por software. Texto, imagens, seleção e hit testing continuam no DOM.

A escolha fica salva no navegador; `?renderer=wasm` ou `?renderer=dom` na URL têm prioridade. Nós que a camada WASM não consegue desenhar com exatidão (gradientes e outras cores não sólidas, sombra em path) continuam pintados pelo DOM. Diferença conhecida: texto e imagens ficam sempre acima das formas desenhadas pelo WASM, mesmo quando a forma vem depois na ordem das camadas. Screenshots e exports não mudam (HTML).

O renderizador WASM é compilado pelo `pnpm build` quando o Rust está instalado (`rustup target add wasm32-unknown-unknown` e `cargo install wasm-bindgen-cli --version 0.2.130`); sem ele o build mostra um aviso e o botão fica desabilitado. `PAPRIKA_REQUIRE_WASM=1` transforma o aviso em erro.

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

Tipos: `frame` (contêiner com pintura e layout livre, linha ou coluna), `group` (agrupa sem pintar; a caixa segue os filhos), `frame` com `component: true` (componente) ou `instanceOf` (instância: os filhos são cópias geradas do componente, escaladas por `scale`, com `overrides`), `page` (canvas separado no arquivo; com páginas, todo nó de topo é página e os frames ficam dentro delas), `rect`, `ellipse`, `text`, `image`, `path` (forma vetorial com dados de caminho SVG: retas, curvas bezier cúbicas e quadráticas, arcos; `fill`, `stroke`, `fillRule`, `strokeCap`, `strokeJoin` e `viewBox` opcional para escalar um grid de ícone).
Tamanhos: número, `"hug"` (conteúdo) ou `"fill"` (ocupa o espaço do pai). Detalhes em [docs/pt-BR/arquitetura.md](docs/pt-BR/arquitetura.md). O trabalho planejado está em [docs/pt-BR/backlog.md](docs/pt-BR/backlog.md).

## Estrutura

```
packages/core     modelo (zod), applyOps atômico, History, nodeStyle, render/export, lint, outline
packages/server   DocumentStore (arquivo + watch), MCP (stdio e HTTP), WebSocket, screenshot, CLI
apps/web          canvas React + Vite
apps/site         landing page (desenhada no Paprika) + site de docs, publicados em paprika.js.org
server-go/        o mesmo servidor em Go, com armazenamento em SQLite (ver abaixo)
examples/         demo gerada por um agente via MCP (packages/server/scripts/seed-demo.mjs)
```

## Servidor em Go (SQLite)

`server-go/` é uma implementação em Go do servidor com as mesmas ferramentas MCP, o mesmo protocolo WebSocket e a mesma API HTTP, que guarda documentos, tokens e o histórico de undo/redo em SQLite (arquivos `.paprika.json` entram e saem com `paprika import` / `paprika export`). Ele serve o mesmo canvas, e as mesmas suítes black-box e E2E rodam contra os dois servidores. Uso, estrutura do banco e checagens de paridade: [server-go/README.pt-BR.md](server-go/README.pt-BR.md); registro da decisão: [ADR 0001](docs/pt-BR/adr/0001-servidor-go-sqlite.md).

```bash
pnpm build && pnpm go:build
server-go/bin/paprika import examples/demo.paprika.json --db design.db
server-go/bin/paprika serve --db design.db
```

## Desenvolvimento

```bash
pnpm check        # build + typecheck + testes unitários/integração + E2E (Playwright)
pnpm dev          # servidor com o demo; em outro terminal: pnpm --filter @paprika/web dev
pnpm check:go     # servidor Go: fixtures em dia, go test, paridade e E2E contra o binário Go
pnpm test:render  # renderizador Rust (crates/render): testes nativos com vello_cpu
```

O CI roda só em pull requests e escolhe os jobs pelos arquivos que a PR altera: veja [docs/pt-BR/ci.md](docs/pt-BR/ci.md).

Este repositório usa o [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) como harness: invariantes em `.toolbelt/invariants.yaml` (`tb mem list`) e `tb verify run` / `tb stack verify guard` antes de concluir. Sessões do Claude Code na nuvem instalam o `tb` fixado ao iniciar ([docs/pt-BR/sessoes-agentes.md](docs/pt-BR/sessoes-agentes.md)).

## Segurança

- Bind em `127.0.0.1` por padrão; Host e Origin são validados (bloqueia DNS rebinding e CSRF de páginas abertas no navegador).
- Não há autenticação: `--host 0.0.0.0` expõe o documento para a rede. Use só em rede confiável.
- Imagens `https://` são carregadas pelo Chromium no screenshot.

Para reportar uma vulnerabilidade, use o reporte privado de vulnerabilidades do GitHub; veja o [SECURITY.pt-BR.md](SECURITY.pt-BR.md). Não abra issue pública.

## Como contribuir

Veja o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md). Toda participação segue o [Código de Conduta](CODE_OF_CONDUCT.pt-BR.md).

## Licença

[MIT](LICENSE)
