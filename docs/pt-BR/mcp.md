# Agentes e MCP

Como um agente de IA conversa com o Paprika: como conectar, as ferramentas que ele recebe e o formato do arquivo por trás de um design. Voltar ao [README](../../README.pt-BR.md).

English: [../mcp.md](../mcp.md).

## Conectar um agente

**HTTP (recomendado, com o canvas aberto):** suba o Paprika (`docker compose up -d --build`, ou `paprika serve` a partir do código) e aponte o agente para `http://127.0.0.1:4777/mcp`. Com Docker, stdio também funciona: veja [docker.md](docker.md).

Claude Code:

```bash
claude mcp add --transport http paprika http://127.0.0.1:4777/mcp
```

**stdio** (agentes que só falam stdio). O processo também sobe o canvas na porta 4777, se estiver livre:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "<CAMINHO>/paprika/server-go/bin/paprika",
      "args": ["mcp", "--db", "<CAMINHO>/design.db"]
    }
  }
}
```

## Ferramentas MCP

| Ferramenta | O que faz |
|---|---|
| `get_design_guide` | Modelo de nós, campos e fluxo recomendado; em inglês, ou em português com `language: "pt-BR"` |
| `get_document_outline` | Árvore compacta + tokens + versão. As últimas linhas são a caixa do conteúdo da página e o próximo lugar livre |
| `get_nodes` / `find_nodes` | JSON completo de nós / busca por tipo, nome, texto |
| `create_nodes` | Cria árvores aninhadas numa chamada; num conector `x`/`y`/`width`/`height`/`d` seguem `from`/`to`, então um nó copiado que os traz recebe um aviso, não uma recusa; num path, `normalize: true` leva o desenho para (0,0) e desloca `x`/`y`. `place`: `"free"` (padrão de um nó de topo sem x/y: à direita do conteúdo, mesmo topo, respiro 80, quebra depois de 2400), `"below"`, `"right"`, `{near, side}` ou `"none"` (x/y exatos). Um nó novo de topo que sobrepõe outro volta em `warnings` com o lugar livre mais próximo |
| `draw_diagram` | Desenha um diagrama (fluxograma, arquitetura, mapa mental) a partir de formas e ligações: distribui as formas em camadas (`direction`: para baixo ou para a direita, à direita do conteúdo existente) e liga com setas que seguem as formas; uma ligação pode ter `label` |
| `update_nodes` / `move_nodes` / `delete_nodes` | Edição em lote, atômica. `index` nos props do `update` ou no `move` define a ordem Z no pai do nó: número a partir de 0 (o fundo) ou `front` / `back` / `forward` / `backward`, no mesmo passo de desfazer dos outros campos |
| `group_nodes` / `ungroup_nodes` | Põe nós irmãos num `group` (o desenho não se move) / devolve ao pai |
| `combine_paths` | Combina 2+ nós irmãos `path` / `rect` / `ellipse` / `shape` num único `path` (`operation`: `union`, `subtract`, `intersect`, `exclude`). Mantém o estilo do nó mais fundo, apaga as fontes, um passo de desfazer. Retorna `path` (o id novo). Sem menu no canvas nesta ferramenta — agentes usam MCP / `apply_ops` |
| `duplicate_nodes` | Copia nós com a subárvore inteira num passo só de desfazer. Sem `offset`, `place` cai à direita da origem (respiro 80) para a cópia não pousar em cima; passe `offset` para deslocar x e y, ou `place` `"free"` / `"below"` / `"right"` / `{near, side}` / `"none"`. Também `parentId`, `scale` (tamanhos, texto, traços, espaçamentos e o `scale` das instâncias) e `props` escritos em cada cópia (`{ "mode": "dark" }` faz o par claro/escuro). Instâncias continuam instâncias do mesmo componente; conectores entre nós duplicados passam a ligar as cópias. Retorna `copies` (um id por origem) e `map` (cada nó de origem para a sua cópia) |
| `create_page` | Cria uma página; a primeira leva o canvas atual para "Página 1" |
| `create_component` / `create_instance` / `detach_instance` | Marca um frame como componente / põe uma cópia dele (com `scale` e `overrides`; retorna o id de cada cópia) / transforma uma instância em nós comuns |
| `apply_ops` | Transação mista (create, update, delete, move, set_tokens, rename_document, group, ungroup, add_page, detach, combine_paths) |
| `set_tokens` | Design tokens (`$nome`) para cores e tamanhos; com `mode`, os valores de um modo de tema (ex.: `dark`) que frames e páginas escolhem com `mode` |
| `list_workspaces` / `open_workspace` / `create_workspace` / `import_document` | Lista os workspaces (documentos) do servidor / torna um deles o ativo para todas as ferramentas e para o canvas do humano / cria um vazio / guarda um `.paprika.json` (ex.: do `paprika export --root ID`) como novo workspace sem trocar o ativo. `import_document` guarda as coordenadas do arquivo (`place` `"none"`); para colocar arte na página atual, use `import_svg`, `import_html` ou `import_image` |
| `rename_workspace` / `delete_workspace` | Renomeia um workspace (com desfazer quando é o ativo) / exclui um de vez, em duas chamadas: sem `confirmToken` nada é apagado e o resultado é um resumo do que se perde (contagens, última edição, capa, qual workspace assume) mais um token de uns dois minutos que pertence àquele workspace; a segunda chamada, com o token, apaga (o ativo passa para o outro atualizado mais recentemente; o único não pode ser excluído) |
| `list_workspace_ops` | O log de operações de workspace — criar, renomear, abrir e excluir, cada um com quem agiu (`user` ou o nome do agente), quando e em qual workspace; a entrada do apagamento guarda o resumo, e as entradas sobrevivem ao workspace que nomeiam |
| `set_workspace_cover` | Põe uma imagem no card do workspace na página inicial: o screenshot de um frame dele (`rootId`), uma imagem (`image`, base64 ou data URL) ou nenhuma (`clear`, volta a primeira letra) |
| `undo` / `redo` / `get_history` | Histórico compartilhado com o humano; toda ferramenta de escrita aceita `batch`, e várias chamadas com o mesmo batch viram um passo só de undo |
| `lint_design` | Contraste WCAG AA, overflow, tokens inexistentes, texto pequeno, alt, `overlapping-boards` (frames de topo na mesma página) e `covered-by-overlay` (texto pintado sobre um frame opaco) |
| `path_info` | Valida dados de caminho SVG e devolve a caixa exata (com extremos de bezier e arcos), a `origin` do desenho (deslocamento desde a origem do nó) e o `d` normalizado; com `id` também devolve a caixa no canvas, a origem da transformação e os cantos rotacionados |
| `get_bounds` | Caixas absolutas depois do auto layout (row/column, hug/fill): `x`/`y`/`width`/`height`, `origin` da transformação (centro da caixa) e os quatro cantos após a rotação; `ids` / `rootId` opcionais. Sem `ids`, também devolve a caixa do conteúdo da página e o próximo lugar livre |
| `render_screenshot` | PNG de um nó, de uma página ou do canvas |
| `import_svg` / `import_html` | Transforma SVG colado (paths, formas, grupos, transforms) ou HTML com estilos inline em nós editáveis; o que não dá para importar volta em `warnings`. As raízes respeitam `place` (`"free"` quando x e y faltam) |
| `import_image` | Coloca uma imagem raster (PNG, JPEG, WebP, AVIF ou GIF) como nó `image` no tamanho natural do arquivo. `src` é data URL ou caminho local sob `PAPRIKA_IMPORT_DIRS` (padrão: o diretório de trabalho do servidor). Arquivos acima de 3500000 bytes são recusados. Os bytes originais ficam embutidos, então GIF/WebP/AVIF animados continuam animados no canvas e no HTML (`render_screenshot` captura um frame). Respeita `place` (`"free"` quando x e y faltam) |
| `resize_image` | Reamostra um nó `image` (ou cria um a partir de `src`) para `qhd` 960×540, `hd` 1280×720, `2k` 2560×1440, `4k` 3840×2160, ou `{width,height}`. Go puro (`golang.org/x/image` CatmullRom); sem Chromium. `fit`: `contain` (padrão), `cover`, `fill`. GIF animado → primeiro frame; WebP animado e AVIF recusados. Mesmo formato quando há encoder puro (PNG/JPEG/GIF), senão PNG |
| `export_code` | HTML autocontido, componente React (TSX), SVG vetorial (caixas do `layout(doc)` do core, sem Chromium headless), componente React com classes utilitárias do Tailwind (`tailwind`), HTML autocontido com classes do Tailwind (`tailwind-html`), componente React mais o seu `.module.css` (`css-modules`: dois blocos de texto, o `.tsx` primeiro e a folha de estilo depois), componente Angular standalone (`angular`: três blocos — `.ts`, template, `.css`) ou componente Svelte num arquivo só (`svelte`); `cssVariables: true` escreve os tokens como `var(--nome)`, com uma regra por modo de tema |

Camada de agentes:
- O guia, as descrições das ferramentas, os erros, os avisos e as mensagens do lint são em inglês (o guia também em português, ver acima).
- As ferramentas que respondem JSON declaram `outputSchema` e devolvem `structuredContent`; o bloco de texto continua com o mesmo JSON (no `get_nodes` e no `get_history`, o array puro).
- O histórico identifica o agente pelo `clientInfo.name` do MCP (`agent:claude-code`). No HTTP o servidor é stateless, então o `initialize` devolve um `Mcp-Session-Id` que só guarda esse nome; sem ele, vale o User-Agent, como antes.

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
Tamanhos: número, `"hug"` (conteúdo) ou `"fill"` (ocupa o espaço do pai). Detalhes em [docs/pt-BR/arquitetura.md](arquitetura.md). O trabalho planejado está em [docs/pt-BR/backlog.md](backlog.md).
