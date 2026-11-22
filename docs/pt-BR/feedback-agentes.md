[🇺🇸 English](../agent-feedback.md) | 🇧🇷 Português

# Registro de feedback de agentes

Atritos encontrados por agentes de IA usando o Paprika via MCP, anotados durante trabalho real.
Formato: data · tarefa · o que o agente precisava vs. o que aconteceu · proposta · prioridade.

## 2026-11-21: desenhar 5 propostas de ícone + tema (`examples/brand/draw-brand.mjs`)

Tarefa: um agente desenhou 5 ícones flat de páprica com complexidade crescente (de 3 a ~20 formas), cada um em 240/96/48/24 px, ao lado de uma paleta e de uma amostra de UI, usando só ferramentas MCP.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 1 | Formas orgânicas (silhueta de pimentão) | Só existem `rect`/`ellipse`; o pimentão foi montado com elipses sobrepostas e rotacionadas | Nó `path` (SVG `d`, fill/stroke) e união booleana de filhos (`path` com curvas bezier feito em 2026-11-21, ver abaixo; união booleana ainda aberta) | P1 |
| 2 | Pôr o cabo na ponta de uma vagem rotacionada | A rotação gira em torno do centro da caixa e o agente teve de fazer trigonometria; o cálice ficou fora do lugar duas vezes e só o screenshot mostrou | Ferramenta `get_bounds` com a geometria rotacionada (cantos, pontas) e um campo `origin` (transform-origin) | P1 |
| 3 | O mesmo ícone em 4 tamanhos | Sem componentes/instâncias nem escala: o script regerou todas as formas com um fator (4× os nós, edição não propaga) | Componentes + instâncias com `scale`; `duplicate_nodes` com escala | P1 |
| 4 | 5 temas lado a lado | Tokens são globais; foi preciso prefixar à mão (`p1.brand` … `p5.brand`) e reescrever em cada nó | Feito (2026-11-21, ver #45): modos de tema (`set_tokens` com `mode`) e `mode` num frame ou página; coleções nomeadas continuam em aberto | — |
| 5 | Conferir o resultado na máquina do usuário | `render_screenshot` falhou: o Playwright 1.63 exige o Chromium 1243 e só havia o 1228 | Detectar o browser ausente ao iniciar, devolver o comando exato de correção no erro e cair para renderização via aba do canvas aberta | P1 |
| 6 | Pegar erro visual sem screenshot | `lint_design` passou com o cálice solto da vagem | Lint geométrico: filhos que não tocam nenhum irmão, quase-encostos (< 4px), formas totalmente encobertas | P2 |
| 7 | Ler resultados estruturados | As ferramentas devolvem JSON como texto; o agente precisa parsear string | Feito (2026-11-21, ver #48): `outputSchema` + `structuredContent` em toda ferramenta que responde JSON | — |
| 8 | Wrappers de layout sem recorte | Todo frame wrapper precisou de `clip: false` e `fill: "transparent"` | Nó `group`, ou `clip: false` por padrão em frame com layout automático | P3 |
| 9 | Lint menos ruidoso | 21 infos de `raw-color` para literais intencionais (alças brancas, texto preto em botões) | `lintIgnore: ["raw-color"]` por nó e parâmetro `minSeverity` | P3 |
| 10 | Saber quem fez o quê | O nome do ator vem do User-Agent HTTP (`node`, `brand-agent`), não do cliente MCP | Feito (2026-11-21, ver #48): `agent:<clientInfo.name>`, também no HTTP | — |
| 11 | Um desfazer para "desenhar proposta 3" | 7 entradas no histórico para uma execução do script (nome, tokens, 5 criações) | Feito (2026-11-21, ver #48): `batch` em toda ferramenta de escrita | — |
| 12 | Idioma para agentes | Guia e erros em português; prompts em inglês misturam idiomas | Feito (2026-11-21, ver #48): guia, descrições e erros em inglês; `get_design_guide {language: "pt-BR"}` | — |
| 13 | Vários quadros | Tudo divide um canvas só; as propostas foram empilhadas à mão com `y` fixo | Páginas e `layout` na raiz do canvas (empilhar frames de topo) | P3 |
| 14 | Ver o agente desenhar depois que o servidor trocou de arquivo | A aba aberta reconectou no documento novo mas manteve zoom/pan antigos; os quadros novos podiam ficar fora da tela (corrigido: o canvas reenquadra quando o id do documento muda) | Feito nesta mudança | — |

## 2026-11-21: curvas bezier (nó `path`, caneta, `path_info`)

Tarefa: adicionar curvas bezier para agentes e humanos desenharem formas orgânicas e redesenhar a páprica só com paths (`packages/server/scripts/bezier-demo.mjs`, removido junto com o servidor TypeScript).

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 15 | Caixa do nó igual ao desenho | Sem `width`/`height`, a caixa vai da origem do nó até a borda da curva; um `d` que começa em (40,30) deixa espaço vazio no canto e o lint de overflow mede essa caixa | `normalize: true` no create (leva o desenho para 0,0 e ajusta `x`/`y`), ou informar a folga no `path_info` | P2 |
| 16 | Camadas de vários paths como uma forma (corpo, sombra, brilho, cálice) | Cada parte repete o mesmo `x`/`y`; mover a pimenta é mover 5 nós | Nó `group` (ver #8) ou lista `paths: []` num nó só | P2 |
| 17 | Editar um ponto de controle | Mudar uma curva exige reescrever a string `d` inteira | Parte do canvas feita (2026-11-21, ver #43); `update_path_points` (mover âncora/alça por índice) para agentes continua em aberto | P3 |
| 18 | Saber o tamanho desenhado antes de posicionar uma parte | `path_info` com `canvasBounds` respondeu numa chamada só; também pegou um erro de digitação (`d inválido: número esperado na posição 12`) | Manter: erros de parse com posição em todo campo string | — |

## 2026-11-21: servidor em Go com SQLite (`server-go/`)

Tarefa: reimplementar o servidor em Go com o mesmo contrato, guardando os dados em SQLite.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 19 | Saber o que o servidor promete aos agentes | A lista de ferramentas e as instruções só existiam como código TypeScript; uma segunda implementação divergiria | Feito: `server-go/scripts/gen-contract.mjs` extrai `tools/list` e as instruções para `server-go/contract/mcp.json`, e a suíte de paridade confere que os dois servidores devolvem o mesmo contrato. Com a remoção do servidor TypeScript, o `mcp.json` passou a ser o próprio contrato, editado à mão e conferido pelo `packages/e2e` | — |
| 20 | Desfazer depois de reiniciar | No servidor com arquivo, o histórico ficava em memória e se perdia ao reiniciar | Feito no servidor Go: as duas pilhas são gravadas no SQLite junto com cada mudança | — |
| 21 | Consultar o design sem carregar tudo | O agente precisava chamar `get_document`/`query_nodes` | A tabela `nodes` do servidor Go pode ser lida com SQL simples (`type`, `name`, `parent_id`); uma ferramenta MCP `sql_query` (só leitura) poderia expor isso | P3 |
| 22 | Mesmo nome de autor em todo lugar | Continua vindo do User-Agent HTTP (ver #10); mantido igual no Go por paridade | Trocar os dois servidores para `clientInfo.name` juntos | P3 |

## 2026-11-21: renderizador do canvas em Rust/WASM (ADR 0002)

Tarefa: prototipar o canvas em Rust/WASM (vello no WebGPU, fallback vello_cpu) e comparar com o canvas DOM ([ADR 0002](adr/0002-renderizador-canvas-rust-wasm.md)). Sem chamadas MCP; o atrito é sobre aquilo de que os agentes dependem.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 23 | Carregar um documento de exemplo fora do servidor | `examples/bezier.paprika.json` omite defaults (`visible`, `opacity`…); um renderizador que o leu sem `parseDocument` não desenhou nada em nenhum modo, e só o screenshot mostrou | Gravar os exemplos normalizados, ou dizer no AGENTS.md que todo leitor passa por `parseDocument` | P3 |
| 24 | Conferir um canvas desenhado na GPU pelo navegador headless do agente | O Chromium headless sem GPU perde o device WebGPU ao apresentar um canvas (em JS puro também), então os pixels voltam vazios | Se o canvas for para WebGPU, manter o `render_screenshot` no caminho HTML, ou renderizar offscreen e ler os pixels (como faz `gpu-readback-check.cjs`) | P2 |
| 25 | Escolher o caminho rápido sozinho | O Chromium headless oferece um adapter WebGPU *por software* (SwiftShader), de 45 a 220× mais lento que o vello_cpu; um "WebGPU se existir" ingênuo escolhe ele | Tratar adapters `DeviceType::Cpu` como sem GPU (feito no protótipo) | — |
| 26 | Uma fonte de geometria para agentes e renderizadores | O protótipo recalcula as caixas (e mede um DOM oculto para auto layout) porque o core não expõe geometria resolvida | Um `layout(doc)` no core devolvendo caixas absolutas serviria ao renderizador, ao `get_bounds` (#2) e ao lint de geometria (#6) | P2 |

## 2026-11-21: integração do canvas WASM (`crates/render`, ADR 0002)

Tarefa: ligar o renderizador Rust/WASM ao canvas como híbrido opcional (o WASM desenha as formas, o DOM mantém texto e hit testing). Sem chamadas MCP.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 27 | Conferir o canvas WASM como o agente confere o DOM | O `render_screenshot` renderiza o export HTML, então nunca mostra o que a camada WASM desenha; só um screenshot do canvas ao vivo mostra | Manter screenshots em HTML (determinístico) e confiar no teste de paridade do E2E; se agentes precisarem, uma opção `renderer: "wasm"` no `render_screenshot` que carrega a página do canvas | P3 |
| 28 | Saber qual renderizador o humano está vendo | A escolha fica no navegador (localStorage), então o agente não sabe se o humano vê a saída do DOM ou do WASM | Informar o renderizador e o backend ativos no hello do WebSocket e expor nos metadados do `get_document_outline` | P3 |

## 2026-11-21: landing page desenhada no Paprika (`apps/site`)

Tarefa: desenhar a landing page do projeto no Paprika pelo MCP (desktop e mobile, inglês e português, ≈300 nós) e publicá-la como página web gerada a partir do documento.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 29 | Conferir uma página cuja altura segue o conteúdo | O `render_screenshot` de um frame raiz com `height: "hug"` devolveu uma imagem de 1280×1 px (o `rootBounds` transforma `hug` em 1 px), e o agente teve que conferir a página no próprio navegador | Medir raízes `hug`/`fill` no navegador antes do screenshot, ou devolver o tamanho medido no `get_bounds` (#2) | P1 |
| 30 | Botões e itens de menu com link | Os nós não têm campo de link; o build do site lê uma convenção de nome (`name: "link:<href>"`) e transforma esses nós em `<a>` | Um campo `href` em frames e textos, exportado como `<a>` pelo `export_code` e mantido pelo canvas | P2 |
| 31 | Uma página para qualquer largura de tela | Os frames raiz têm largura fixa e o `export_code` fixa o body nesse tamanho; a página foi desenhada duas vezes (1280 e 390) e o build estica as raízes até a largura da janela | Variantes de um frame por breakpoint, ou `minWidth`/`maxWidth`, e um export de página com raízes responsivas | P2 |
| 32 | Reaproveitar a mesma imagem | O data URI do ícone se repete em 8 nós de imagem (documento com ≈200 KB) | Assets no nível do documento (referências `$asset`) ou tokens de imagem | P3 |
| 33 | Marcar uma imagem como decorativa | O `lint_design` avisa `missing-alt` para `alt: ""`, que é o HTML correto para imagem decorativa | Um campo `decorative: true` (ou tratar `alt` vazio explícito como decorativo) | P3 |

## 2026-11-21: seleção múltipla, grupos e páginas (leva 1 do backlog)

Tarefa: adicionar nós `group` e `page` ao core (TS e Go), as ferramentas MCP `group_nodes`, `ungroup_nodes` e `create_page`, e seleção múltipla, laço e páginas no canvas. Atende #8, #13 e #16.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 34 | Agrupar ou desagrupar a partir de um cliente que pode estar atrasado | O canvas expandia `group`/`ungroup` em ops primitivas na própria cópia do documento; quando um agente escrevia no meio, o desagrupar usava a posição antiga do grupo e os filhos pulavam | Feito: `group`, `ungroup` e `add_page` são ops de verdade, expandidas dentro de `applyOps` sobre o documento atual, então clientes e agentes mandam a intenção, não coordenadas | — |
| 35 | Saber o tamanho de um grupo | A caixa do grupo vem dos filhos ao fim de cada transação, então escrever `width`/`height` nele é rejeitado com uma mensagem que explica o motivo | Manter a regra; `describe_node` já mostra a caixa ajustada | — |
| 36 | Pôr conteúdo numa página numa chamada | Com páginas, todo nó de topo precisa ser página; a checagem roda no fim da transação, então `create_page` + `create_nodes` com `parentId` funciona, mas um nó solto no topo falha com uma mensagem que o nomeia | Um `pageId` padrão em `create_nodes` (a página que a pessoa está vendo) pouparia uma consulta aos agentes | P3 |

## 2026-11-21: componentes e instâncias (leva 1 do backlog, item 2)

Tarefa: componentes (`component: true`) e instâncias (`instanceOf`, `scale`, `overrides`) no core (TS e Go), as ferramentas MCP `create_component`, `create_instance` e `detach_instance`, e painéis no inspector para instâncias e cópias. Atende #3.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 37 | Trocar algo numa cópia sem saber o id gerado | Os ids das cópias são derivados (instância + id de origem), então o agente não os adivinha | Feito: `create_instance` devolve `copies` (id de origem → id da cópia), e `overrides` pode ser escrito na instância pelo id de origem | — |
| 38 | Escalar um conjunto de ícones | O mesmo ícone em 4 tamanhos agora é 1 componente + 4 instâncias com `scale`; um `fontSize` que é token não escala | Tokens tipados (backlog E) deixariam `scale` multiplicar tokens de tamanho também | P3 |
| 39 | Pôr uma instância de botão dentro de um componente de card | Instâncias dentro de componentes ainda são recusadas, então design systems aninhados pedem detach ou componentes planos | Instâncias aninhadas, com overrides endereçados por caminho (`instância/cópia`) | P2 |

## 2026-11-21: colar SVG/HTML e exportar SVG (leva 1 do backlog, item 3)

Tarefa: `importSVG`, `importHTML` e `exportSVG` no core (TS e Go), as ferramentas MCP `import_svg` e `import_html`, `export_code` com formato `svg`, `GET /api/svg`, e colar mais um botão de export no canvas.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 40 | Trazer um ícone de um conjunto SVG | Antes o agente traduzia cada `<rect>`/`<circle>`/arco à mão para `d`; agora o `import_svg` faz isso numa chamada e diz o que ficou de fora em `warnings` | Suportar sprites `<use>`/`<symbol>` e `<text>` (como nós `text`), comuns em ícones e logos | P2 |
| 41 | Exportar SVG de um nó com layout automático sem navegador | O core não posiciona sozinho filhos `hug`/`fill`/row/column, então o `exportSVG` sem medida falha com uma mensagem que aponta o `export_code` | Um `layout(doc)` no core (#26) deixaria o core exportar tudo e daria as caixas aos agentes | P2 |
| 42 | Reaproveitar um componente de uma página web | O `import_html` só lê `style=""` inline; o HTML copiado da maioria dos sites depende de classes, então o resultado sai simples | Uma opção que renderiza o HTML no Chromium do servidor e importa os estilos computados | P2 |

## 2026-11-21: edição de path ponto a ponto (leva 1 do backlog, item 4)

Tarefa: funções no core que transformam `d` em âncoras com alças e de volta (`pathToSubpaths`, `moveAnchor`, `moveHandle`, `insertAnchor`, `removeAnchor`, `toggleSmooth`, `pathEditProps`) e um modo de edição de pontos no canvas.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 43 | Ajustar um ponto de um vetor que o agente desenhou | O humano agora arrasta no canvas; o agente ainda reescreve `d`, e depois de uma edição humana o `d` que ele lê vem com outros números (quadráticas e arcos viram cúbicas, a caixa é renormalizada) | Uma ferramenta MCP sobre as mesmas funções (`edit_path` com índice da âncora e posição nova), e as âncoras no `path_info`, para agente e humano endereçarem pontos do mesmo jeito | P2 |
| 44 | Editar um vetor dentro de um frame com layout automático | A posição do nó vem do layout, então quando a edição move o canto superior esquerdo do desenho a caixa cresce no lugar e a forma se desloca nessa medida | Manter, ou adotar filhos que "ignoram o layout" (backlog A) e posicionar vetores editados em absoluto | P3 |

## 2026-11-21: modos de tema e tokens como variáveis CSS (leva 1 do backlog, item 5)

Tarefa: `document.modes` e `mode` em frames e páginas no core (TS e Go), `set_tokens` com `mode`, `export_code` com `cssVariables`, uma seção de tema no inspector e a regra de lint `unknown-mode`. Atende o #4.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 45 | Mostrar a mesma tela clara e escura | Antes o agente duplicava o frame e reescrevia todas as cores; agora grava os valores escuros uma vez (`set_tokens` com `mode`) e põe `mode` numa cópia | Uma ferramenta `duplicate_nodes` que aceite overrides (`mode`, aqui) deixaria o lado a lado em uma chamada | P2 |
| 46 | Saber o valor que um nó recebe de fato | O `get_nodes` mostra `$fg`; o valor depende do `mode` mais próximo acima. O outline mostra `mode=` nos frames e os modos com os tokens | Uma opção `resolve` no `get_nodes` que acrescente a pintura resolvida de cada nó | P3 |
| 47 | Usar um token que só um modo define | Ele resolve dentro desse modo e é erro `unknown-token` fora; no export com variáveis CSS vira `var(--x)` sem valor base | Manter o erro; o agente deve definir também um valor base | — |

## 2026-11-21: camada de agentes (leva 1 do backlog, item 6)

Tarefa: `outputSchema` + `structuredContent` nas ferramentas que respondem JSON, `batch` em toda ferramenta de escrita (um passo só de undo), o ator vindo do `clientInfo` (stdio e HTTP stateless), e guia, descrições das ferramentas, erros, avisos e mensagens do lint em inglês, com o guia em pt-BR sob pedido. Atende #7, #10, #11 e #12.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 48 | Ler resultados sem parsear texto | O `structuredContent` segue o `outputSchema` de cada ferramenta; `get_nodes` e `get_history` mantêm o array puro no texto e o embrulham (`{ nodes }`, `{ entries }`) no `structuredContent`, porque o MCP exige um objeto ali | Na próxima mudança incompatível, deixar o texto igual ao objeto | P3 |
| 49 | Um passo de undo para um script longo | O `batch` junta escritas seguidas do mesmo agente; qualquer edição ou undo do humano no meio fecha o batch, e a chamada seguinte abre uma segunda entrada | Mostrar o batch aberto na lista de atividade do canvas, para o humano saber que uma edição vai dividi-lo | P3 |
| 50 | Mesmo nome de ator depois de reiniciar o servidor | No HTTP o nome fica num mapa em memória pelo `Mcp-Session-Id`; depois de reiniciar, o cliente continua com o id antigo e o ator volta ao User-Agent até um novo initialize | Responder 404 a ids de sessão desconhecidos, como a spec sugere, para o cliente reinicializar | P3 |
| 51 | Um idioma só na lista de atividade | Os rótulos padrão das ferramentas agora são em inglês (`create 1 node(s)`), enquanto os rótulos e a interface do próprio canvas seguem em pt-BR | Traduzir a interface do canvas ou localizar as duas por configuração | P3 |

## 2026-11-21: página de workspaces

Tarefa: uma página com os workspaces como tela inicial, com `list_workspaces`, `open_workspace` e `create_workspace` nos dois servidores.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 52 | Trabalhar num segundo workspace sem mexer no humano | O workspace ativo é compartilhado de propósito, então `open_workspace` também troca o canvas do humano; o guia pede ao agente que pergunte antes | Um argumento opcional `workspace` nas ferramentas de leitura (outline, nodes, screenshot), para o agente olhar outro workspace sem trocar | P2 |
| 53 | Saber que outra pessoa trocou o workspace | A chamada seguinte só vê outro documento; nada no resultado diz que o ativo mudou desde a última chamada do agente | Pôr o id do workspace ativo na primeira linha do `get_document_outline` e nos resultados de escrita | P2 |
| 54 | Desfazer depois de uma troca (servidor TypeScript) | O histórico fica em memória, então um workspace reaberto começa com a pilha de undo vazia; o servidor Go restaura do SQLite | Manter um `History` por workspace durante a vida do processo | P3 |

## 2026-11-21: diagramas (formas, conectores, `draw_diagram`)

Tarefa: nós `shape` e `connector`, ferramentas no canvas e `draw_diagram` para agentes, com paridade TS/Go. Notas de desenhar fluxogramas via MCP durante a construção.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 55 | Apagar uma forma e a seta dela numa chamada | `delete_nodes` com a forma primeiro e depois o conector falhava: o delete da forma já tinha levado o conector. Corrigido: um conector removido assim antes, na mesma transação, é ignorado (apagar duas vezes continua sendo erro) | — | — |
| 56 | Saber os ids das setas que o `draw_diagram` criou | O padrão é `<from>-to-<to>` (com `-2`, `-3` nas repetições) e eles voltam em `edges`, na ordem da entrada | — | — |
| 57 | Dizer o que uma seta significa ("sim", "não") | Conectores ainda não têm rótulo; o agente põe um texto pequeno ao lado da seta, que não a acompanha | Um `label` no conector, posicionado no meio da rota | P1 |
| 58 | Mover uma forma de um diagrama sem cruzar outras | A rota em cotovelo ignora obstáculos, então uma forma movida pode fazer uma seta cruzar outra forma | Rota em cotovelo que desvia de obstáculos, ou um modo `relayout` no `draw_diagram` para ids existentes | P2 |

## 2026-11-21: renomear e excluir workspaces

Tarefa: renomear e excluir na página de workspaces (clique duplo no nome, excluir com confirmação) e como `rename_workspace` / `delete_workspace` nos dois servidores.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 59 | Impedir que um agente apague trabalho sozinho | `delete_workspace` tem `destructiveHint` e o guia pede a confirmação do humano, mas nada obriga; o canvas pergunta, o MCP não | Dois passos: a primeira chamada devolve o que seria perdido e um token; a segunda, com o token, exclui | P2 |
| 60 | Desfazer um renomear | Renomear o workspace ativo é uma escrita `rename_document` (com desfazer); renomear outro muda no lugar, sem desfazer | Um registro de atividade por servidor para operações de workspace, ou uma lixeira que guarda os excluídos por um tempo | P3 |
| 61 | Dizer ao humano por que o canvas mudou | Excluir o workspace ativo abre para todos o outro atualizado mais recentemente; o canvas acompanha, sem mensagem | Um aviso curto no canvas ("workspace X excluído por agent:Y") | P3 |

## 2026-11-21: capas de workspace

Tarefa: imagem de capa nos cards da página inicial (enviar, soltar, remover; sem capa = primeira letra) e `set_workspace_cover` para agentes.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 62 | Dar uma capa a um workspace sem sair dele | `set_workspace_cover` com `rootId` tira o screenshot de um frame de qualquer workspace, ativo ou não, então o agente arruma a página inicial depois de desenhar | — | — |
| 63 | Manter a capa em dia com o design | A capa é uma foto: edições depois no frame não a atualizam | Uma capa "viva" opcional que renderiza de novo o frame escolhido quando o workspace muda (com debounce) | P3 |
| 64 | Levar a capa num export | As capas ficam no SQLite ao lado do documento, não no `.paprika.json`, então o `paprika export` as deixa de fora | Exportar/importar a capa como data URL num campo opcional de topo | P3 |

## 2026-11-21: telas do time P2P (Iroh + CRDT)

Tarefa: desenhar as telas do time (painel do time com pessoas, agentes remotos e estado de conexão; convite com link e QR; entrar com progresso e erro de convite vencido; chaves do time; os estados de sync da barra superior) numa página nova "Time P2P" do workspace "Paprika", por um script pelo MCP HTTP (cerca de 900 nós em 9 chamadas `create_nodes`).

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 65 | Texto que se ajusta ao conteúdo dentro de auto layout | Um `text` criado sem `width`/`height` tem 100×100, então cada rótulo de uma linha/coluna ocupou um quadrado de 100 px e o primeiro rascunho ficou inutilizável; os nós desenhados à mão no mesmo workspace são todos `hug`×`hug`. Custou apagar e redesenhar tudo | `text` novo com `width: "hug", height: "hug"` por padrão (e `height: "hug"` quando só vier `width`) | P0 |
| 66 | Usar o id que `create_page` devolveu | `create_page` responde `{page, created}` e `create_nodes` responde `{created}`; o script leu `created[0]` do jeito errado e passou o objeto inteiro como `parentId` | Um formato de resultado para toda tool de criação: `{created: [...]}` primeiro, `page` como extra | P2 |
| 67 | Saber o que `delete_nodes` removeu | Responde `{"created": []}` | `{deleted: [ids, incluindo subárvores e conectores presos]}` | P2 |
| 68 | Um frame sem layout que abraça o texto | Um `frame` com `height: "hug"` e sem `layout` (modo none) colapsa para 0, então o texto dentro some; as células da tabela ficaram vazias sem aviso | `hug` num frame sem layout se ajustar às caixas dos filhos, ou o `lint_design` apontar "hug em frame sem layout" | P1 |
| 69 | Ver no `lint_design` os problemas que importam | 140 avisos na página, quase todos um por rótulo de 11 px, com os poucos estouros reais no meio | Agrupar por regra com contagem e até N ids por regra; uma opção para subir o limite de `small-text` ou desligar uma regra | P2 |
| 70 | Pegar uma linha mais larga que o frame antes do screenshot | Três cards de 400 px mais os espaços estouraram um quadro de 1320 px; só o screenshot mostrou | Overflow no `lint_design` para filhos de row/column cuja soma passa do frame (existe para texto, não para layouts) | P2 |

Mais simples para o próximo agente:

1. Texto com `hug`×`hug` por padrão (#65): a única mudança que teria poupado um redesenho.
2. Um formato de resultado para as tools de criar/apagar (#66, #67).
3. Lint que agrupa e aponta estouro de layout (#68–#70).

- `create_nodes` aninhado montou uma proposta inteira (≈60 nós) numa chamada, de forma atômica.
- O contraste do `lint_design` guiou a escolha de tokens (`brand.dark` para texto branco em botões).
- `get_document_outline` com `depth: 0` bastou para confirmar o resultado gastando pouco.
- O `lint_design` pegou toda cor literal da landing page (`raw-color`), o que gerou o token `on.brand`.
- Um só motor de estilo: os screenshots que o agente conferiu saem do mesmo `nodeStyle` do canvas.
