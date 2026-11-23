[🇺🇸 English](../agent-feedback.md) | 🇧🇷 Português

# Registro de feedback de agentes

Atritos encontrados por agentes de IA usando o Paprika via MCP, anotados durante trabalho real.
Formato: data · tarefa · o que o agente precisava vs. o que aconteceu · proposta · prioridade.

## 2026-11-21: desenhar 5 propostas de ícone + tema (`examples/brand/draw-brand.mjs`)

Tarefa: um agente desenhou 5 ícones flat de páprica com complexidade crescente (de 3 a ~20 formas), cada um em 240/96/48/24 px, ao lado de uma paleta e de uma amostra de UI, usando só ferramentas MCP.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 1 | Formas orgânicas (silhueta de pimentão) | Só existem `rect`/`ellipse`; o pimentão foi montado com elipses sobrepostas e rotacionadas | Nó `path` (SVG `d`, fill/stroke) e união booleana de filhos (`path` com curvas bezier feito em 2026-11-21; MCP `combine_paths` / ops booleanas no core feitos em PAP-A-003 — comando no canvas ainda aberto) | P1 |
| 2 | Pôr o cabo na ponta de uma vagem rotacionada | A rotação gira em torno do centro da caixa e o agente teve de fazer trigonometria; o cálice ficou fora do lugar duas vezes e só o screenshot mostrou | Feito (2026-11-22, PAP-A-001): `get_bounds` devolve origin + cantos; `path_info` ganha origin / transformOrigin | — |
| 3 | O mesmo ícone em 4 tamanhos | Sem componentes/instâncias nem escala: o script regerou todas as formas com um fator (4× os nós, edição não propaga) | Componentes + instâncias com `scale`; `duplicate_nodes` com escala | P1 |
| 4 | 5 temas lado a lado | Tokens são globais; foi preciso prefixar à mão (`p1.brand` … `p5.brand`) e reescrever em cada nó | Feito (2026-11-21, ver #45): modos de tema (`set_tokens` com `mode`) e `mode` num frame ou página; coleções nomeadas continuam em aberto | — |
| 5 | Conferir o resultado na máquina do usuário | `render_screenshot` falhou: o Playwright 1.63 exige o Chromium 1243 e só havia o 1228 | Feito (2026-11-22, PAP-B-062): browser ausente ou incompatível é informado na inicialização e quando o screenshot falha, com `pnpm --filter @paprika/e2e exec playwright install chromium` | — |
| 6 | Pegar erro visual sem screenshot | `lint_design` passou com o cálice solto da vagem | Feito (2026-11-22, PAP-B-066): `detached-sibling`, `near-gap` (abaixo de 4px) e `fully-hidden` | — |
| 7 | Ler resultados estruturados | As ferramentas devolvem JSON como texto; o agente precisa parsear string | Feito (2026-11-21, ver #48): `outputSchema` + `structuredContent` em toda ferramenta que responde JSON | — |
| 8 | Wrappers de layout sem recorte | Todo frame wrapper precisou de `clip: false` e `fill: "transparent"` | Nó `group`, ou `clip: false` por padrão em frame com layout automático | P3 |
| 9 | Lint menos ruidoso | 21 infos de `raw-color` para literais intencionais (alças brancas, texto preto em botões) | Feito (2026-11-22, PAP-B-066): `lintIgnore` por nó e `minSeverity` no `lint_design` | — |
| 10 | Saber quem fez o quê | O nome do ator vem do User-Agent HTTP (`node`, `brand-agent`), não do cliente MCP | Feito (2026-11-21, ver #48): `agent:<clientInfo.name>`, também no HTTP | — |
| 11 | Um desfazer para "desenhar proposta 3" | 7 entradas no histórico para uma execução do script (nome, tokens, 5 criações) | Feito (2026-11-21, ver #48): `batch` em toda ferramenta de escrita | — |
| 12 | Idioma para agentes | Guia e erros em português; prompts em inglês misturam idiomas | Feito (2026-11-21, ver #48): guia, descrições e erros em inglês; `get_design_guide {language: "pt-BR"}` | — |
| 13 | Vários quadros | Tudo divide um canvas só; as propostas foram empilhadas à mão com `y` fixo | Feito (2026-11-22, PAP-B-061): páginas já existiam; um frame novo de topo sem x/y cai no espaço livre (`place: "free"`) | — |
| 14 | Ver o agente desenhar depois que o servidor trocou de arquivo | A aba aberta reconectou no documento novo mas manteve zoom/pan antigos; os quadros novos podiam ficar fora da tela (corrigido: o canvas reenquadra quando o id do documento muda) | Feito nesta mudança | — |

## 2026-11-21: curvas bezier (nó `path`, caneta, `path_info`)

Tarefa: adicionar curvas bezier para agentes e humanos desenharem formas orgânicas e redesenhar a páprica só com paths (`packages/server/scripts/bezier-demo.mjs`, removido junto com o servidor TypeScript).

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 15 | Caixa do nó igual ao desenho | Sem `width`/`height`, a caixa vai da origem do nó até a borda da curva; um `d` que começa em (40,30) deixa espaço vazio no canto e o lint de overflow mede essa caixa | Feito (2026-11-22, PAP-A-001): `normalize: true` no create; `path_info.origin` informa a folga | — |
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
| 26 | Uma fonte de geometria para agentes e renderizadores | O protótipo recalcula as caixas (e mede um DOM oculto para auto layout) porque o core não expõe geometria resolvida | Feito (2026-11-22, PAP-A-001): `layout(doc)` no core (+ port Go / goldens); MCP `get_bounds` | — |

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
| 29 | Conferir uma página cuja altura segue o conteúdo | O `render_screenshot` de um frame raiz com `height: "hug"` devolveu uma imagem de 1280×1 px (o `rootBounds` transforma `hug` em 1 px), e o agente teve que conferir a página no próprio navegador | Feito (2026-11-22): o `render_screenshot` mede no navegador uma raiz `hug`/`fill` e dimensiona a imagem por ela | — |
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
| 41 | Exportar SVG de um nó com auto layout sem navegador | O core não coloca sozinho filhos `hug`/`fill`/row/column, então `exportSVG` sem medida falha apontando para `export_code` | Feito (2026-11-22, PAP-A-002): `exportSVG` / `export_code` svg / `GET /api/svg` usam as caixas do `layout(doc)`; o texto quebra em `\n`; gradientes e imagens de fundo ficam de fora | — |
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
| 52 | Trabalhar num segundo workspace sem mexer no humano | O workspace ativo é compartilhado de propósito, então `open_workspace` também troca o canvas do humano; o guia pede ao agente que pergunte antes | Feito (2026-11-22, PAP-B-063): `workspaceId` opcional nas ferramentas de documento, leitura e escrita, sem trocar o canvas | — |
| 53 | Saber que outra pessoa trocou o workspace | A chamada seguinte só vê outro documento; nada no resultado diz que o ativo mudou desde a última chamada do agente | Feito (2026-11-22, PAP-B-063): a primeira linha do outline e todo resultado de escrita trazem o id e o nome do workspace | — |
| 54 | Desfazer depois de uma troca (servidor TypeScript) | O histórico fica em memória, então um workspace reaberto começa com a pilha de undo vazia; o servidor Go restaura do SQLite | Feito (2026-11-22, PAP-B-063): um histórico por workspace enquanto o processo estiver no ar, inclusive o undo de um workspace que não é o ativo | — |

## 2026-11-21: diagramas (formas, conectores, `draw_diagram`)

Tarefa: nós `shape` e `connector`, ferramentas no canvas e `draw_diagram` para agentes, com paridade TS/Go. Notas de desenhar fluxogramas via MCP durante a construção.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 55 | Apagar uma forma e a seta dela numa chamada | `delete_nodes` com a forma primeiro e depois o conector falhava: o delete da forma já tinha levado o conector. Corrigido: um conector removido assim antes, na mesma transação, é ignorado (apagar duas vezes continua sendo erro) | — | — |
| 56 | Saber os ids das setas que o `draw_diagram` criou | O padrão é `<from>-to-<to>` (com `-2`, `-3` nas repetições) e eles voltam em `edges`, na ordem da entrada | — | — |
| 57 | Dizer o que uma seta significa ("sim", "não") | Conectores ainda não têm rótulo; o agente põe um texto pequeno ao lado da seta, que não a acompanha | Feito (2026-11-22): `label` nos conectores e nas ligações do `draw_diagram`, desenhado no meio da rota na cor do traço, com um halo da cor do fundo | — |
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
| 65 | Texto que se ajusta ao conteúdo dentro de auto layout | Um `text` criado sem `width`/`height` tem 100×100, então cada rótulo de uma linha/coluna ocupou um quadrado de 100 px e o primeiro rascunho ficou inutilizável; os nós desenhados à mão no mesmo workspace são todos `hug`×`hug`. Custou apagar e redesenhar tudo | Feito (2026-11-22): `text` novo sem `width`/`height` nasce `hug`×`hug` (só com `width`, `height: "hug"`) | — |
| 66 | Usar o id que `create_page` devolveu | `create_page` responde `{page, created}` e `create_nodes` responde `{created}`; o script leu `created[0]` do jeito errado e passou o objeto inteiro como `parentId` | Feito em parte (2026-11-22): o `create_page` mantém `{page, created, version}` (extras primeiro, como no `group_nodes`), e a descrição agora diz que `page` é a página nova e que `created` também lista a "Página 1" na primeira vez | — |
| 67 | Saber o que `delete_nodes` removeu | Responde `{"created": []}` | Feito (2026-11-22): o `delete_nodes` responde `{deleted, version}` com todo id removido (subárvores e conectores presos) | — |
| 68 | Um frame sem layout que abraça o texto | Um `frame` com `height: "hug"` e sem `layout` (modo none) colapsa para 0, então o texto dentro some; as células da tabela ficaram vazias sem aviso | Feito (2026-11-22): o `lint_design` avisa `hug-without-layout` num frame sem layout que tem filhos e um lado `hug` | — |
| 69 | Ver no `lint_design` os problemas que importam | 140 avisos na página, quase todos um por rótulo de 11 px, com os poucos estouros reais no meio | Feito (2026-11-22, PAP-B-066): `groups` (contagem + primeiros `maxIds` ids por regra, em ordem de severidade), `minFontSize`, `minSeverity` | — |
| 70 | Pegar uma linha mais larga que o frame antes do screenshot | Três cards de 400 px mais os espaços estouraram um quadro de 1320 px; só o screenshot mostrou | Feito (2026-11-22, PAP-B-066): `layout-overflow` quando filhos de row/column saem do frame | — |

Mais simples para o próximo agente:

1. Texto com `hug`×`hug` por padrão (#65): a única mudança que teria poupado um redesenho.
2. Um formato de resultado para as tools de criar/apagar (#66, #67).
3. Lint que agrupa e aponta estouro de layout (#68–#70).

- `create_nodes` aninhado montou uma proposta inteira (≈60 nós) numa chamada, de forma atômica.
- O contraste do `lint_design` guiou a escolha de tokens (`brand.dark` para texto branco em botões).
- `get_document_outline` com `depth: 0` bastou para confirmar o resultado gastando pouco.
- O `lint_design` pegou toda cor literal da landing page (`raw-color`), o que gerou o token `on.brand`.
- Um só motor de estilo: os screenshots que o agente conferiu saem do mesmo `nodeStyle` do canvas.

## 2026-11-22: rodada de acessibilidade (proposta de contraste)

Tarefa: desenhar pelo MCP HTTP, numa sessão na nuvem, um quadro antes/depois das correções de contraste (texto branco sobre o acento, cores das etiquetas de agente) e tirar o screenshot para a decisão do usuário.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 71 | Screenshot de um quadro que abraça o conteúdo | `render_screenshot` de um `frame` raiz com `width`/`height: "hug"` devolveu um PNG de 2×2, sem erro nem aviso; o canvas mostrava o quadro inteiro (ele mede no navegador), o screenshot usa o tamanho gravado. O contorno foi medir o quadro no canvas e fixar largura e altura | Feito (2026-11-22): raízes `hug`/`fill` são medidas no Chromium headless antes do screenshot (mesma mudança do #29) | — |
| 72 | Desenhar no Paprika do próprio usuário a partir da nuvem | A regra design-first aponta para `127.0.0.1:4777` na máquina do usuário; a sessão na nuvem não alcança esse endereço, então o quadro ficou num servidor descartável no container e só o PNG chega ao usuário | `paprika export --root <id>` de um frame só mais uma tool `import_nodes`, ou deixar o sync do time levar um workspace compartilhado de "propostas" | P2 |

- Um `create_nodes` aninhado montou o quadro inteiro (≈100 nós) numa chamada; com `width`/`height: "hug"` em todo texto, o problema do texto 100×100 não apareceu desta vez (o #65 continua valendo para o padrão).

## 2026-11-22: segunda leva do backlog (rótulos nas setas, remover membro e trocar chave)

Tarefa: desenhar via MCP as telas de rótulo nas setas e do time antes de implementar (design-first), primeiro num servidor no container da nuvem, depois no Paprika do próprio usuário.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 73 | Pôr um rótulo no meio de uma seta (antes de existir `label`) | Precisei ler o `d` derivado do connector, achar o meio do primeiro subcaminho à mão e pôr um `text` ali; ele fica para trás quando a seta se move | Feito (2026-11-22): `label` no `connector` e nas arestas do `draw_diagram`, desenhado no meio com halo | — |
| 74 | Distinguir o rótulo de histórico do diagrama do rótulo de uma aresta | `draw_diagram` já aceita um `label` no topo (a entrada do histórico); agora as arestas também aceitam `label`, então a mesma palavra quer dizer duas coisas na mesma chamada | Renomear o do topo para `historyLabel` numa próxima versão do contrato (mantendo `label` como alias), ou dizer isso nas duas descrições | P3 |
| 75 | Copiar um quadro para o Paprika do próprio usuário | Igual ao #72: a sessão na nuvem desenhou no próprio servidor; para levar ao Paprika do usuário, exportou o workspace, converteu em `create_nodes` aninhado (tirando `x/y/width/height/d` derivados dos connectors, que o `create_nodes` recusa) e rodou esse script na máquina do usuário via Remote Control. `create_workspace` + `open_workspace` também trocaram o workspace ativo do servidor do usuário, e devolver o anterior pelo id errou uma vez (o ativo mudou no meio) | Uma ferramenta MCP `import_document` (entra um `.paprika.json`, sai um workspace novo, sem trocar o ativo), e o `create_nodes` ignorar os campos derivados do connector em vez de recusar | P1 |

- #69 e #70 voltaram no painel do time: o `lint_design` acusou os rótulos de 11 px do próprio app (22 avisos) e não pegou um botão "Remover" que estourava a linha.
- O #71 foi resolvido pela mesma mudança do #29 (raízes `hug` são medidas no navegador antes do screenshot).

## 2026-11-22: ilustração plana de pimentão (paths bezier)

Tarefa: desenhar um pimentão vermelho plano (três lóbulos, vãos brancos finos e curvos, cabo verde-oliva) numa página nova "Pimentão" do workspace "Paprika", primeiro a partir de uma descrição em texto e depois da imagem do usuário, com nós `path` compartilhando um `viewBox` 400×400, e salvar os PNGs em `design/`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 76 | Recortar vãos finos de uma forma | Sem operações booleanas nem máscaras, os vãos são traços brancos pintados sobre o corpo vermelho; só funciona em fundo claro e o export não tem furos de verdade | `combine_paths` (`subtract`/`union`/…) no MCP/`apply_ops` feito (PAP-A-003); comando no canvas e `mask` em group / `knockout` no traço ainda abertos | P2 |
| 77 | Mudar o estilo de um nó e mantê-lo por cima | Ao transformar dois lóbulos preenchidos em traços de vão, eles ficaram sob o corpo; foi preciso um `move_nodes` separado (sem `index` = fim) para corrigir a ordem | Aceitar `index` (ou `"front"`/`"back"`) nas props do `update_nodes` | P3 |
| 78 | Decalcar uma imagem de referência | A imagem do usuário chegou ao agente só como imagem; não havia jeito fácil de colocá-la sob o desenho, então cada ponto bezier foi estimado no olho e mapeado com uma escala calculada à mão, em três rodadas de screenshot | Opção `reference` no `create_nodes`/`import_svg` (ou nó `image` a partir de arquivo local) travada a 50% de opacidade, e `render_screenshot` com uma imagem `compare` lado a lado | P2 |
| 79 | Salvar o screenshot em arquivo | `render_screenshot` só devolve a imagem ao agente; gravar o PNG no repo exigiu copiar o blob em cache do cliente | Feito (2026-11-22, PAP-B-062): `path` opcional no diretório de screenshots, e `url` `/api/screenshot/<id>` | — |

- Um `viewBox` comum em todos os paths deixou a iteração trivial: cada camada usa as mesmas coordenadas 400×400, e redesenhar a silhueta foi um único `update_nodes`.
- `render_screenshot` com `scale: 2` bastou para avaliar a qualidade das curvas.

## 2026-11-22: folha de componentes shadcn na página Interfaces (PAP-B-030, design first)

Tarefa: desenhar, por MCP, a folha com cada primitivo shadcn e seus estados (hover, foco, desabilitado, aberto), em claro e escuro, na página `Interfaces` do workspace Paprika, antes de instalar qualquer dependência; depois implementar os primitivos em `apps/web`. Cinco frames raiz, ~570 nós, cinco chamadas `create_nodes`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 80 | Screenshot de uma subárvore que mantém o modo de tema | `render_screenshot { rootId: <frame dentro de um frame com mode: "light"> }` pintou a subárvore com os tokens base (escuro): o modo de um ancestral não viaja até a captura de uma subárvore. Dois close-ups que comparei lado a lado não eram comparáveis, e o contorno (capturar o frame raiz inteiro e recortar localmente) custa bytes e tempo | Feito (2026-11-22, PAP-B-062): a subárvore mantém o modo de tema que herda, e `mode` no `render_screenshot` o substitui | — |
| 81 | Saber que um frame de layout aninhado pegou a caixa padrão | Um frame sem `width`/`height` vira 100×100, e os filhos posicionados dentro dele somem do render: a primeira folha saiu com um único botão visível, sem erro e sem aviso, e o `lint_design` ficou calado. O guia documenta `hug`/`fill`, mas não esse padrão | Feito (2026-11-22, PAP-B-066): `hug-was-meant` num frame de layout 100×100 cujos filhos saem da caixa | — |
| 82 | Texto pequeno numa folha de componentes | O `lint_design` devolveu 31 avisos `small-text` pelas legendas de 10 e 11px de uma folha que espelha o app, cuja própria escala tipográfica (ADR 0003) é `text-2xs` 10px e `text-xs` 11px — o mesmo terreno dos #69 e #70 | Feito (2026-11-22, PAP-B-066): `minFontSize` no `lint_design` (e `scaledMock` no frame) | — |
| 83 | Tokens em todos os campos de estilo | `radius: "$radius.md"` foi recusado ("expected number, received string") enquanto `fill` e `color` aceitam `$token`. Todo raio da folha ficou como número literal, então os raios da folha não acompanham uma troca de token como as cores acompanham | Feito (2026-11-22, PAP-B-065): um campo de comprimento aceita um token numérico (`$radius.*`, `$space.*`, `$text.*` ou qualquer outro); um token de cor nesse campo é recusado; mudar o token relayouta todo frame que o usa | — |
| 84 | O mesmo formato de resultado nas ferramentas de leitura | `get_nodes` responde JSON (`{"nodes": […]}`) e `find_nodes` responde linhas de texto (`frame#id "nome" …`); um script que percorre a árvore por nome precisa tratar dois formatos, e foi exatamente aí que a primeira tentativa falhou | Manter o texto (boa leitura no chat) e aceitar `format: "json"`, ou devolver `structuredContent` em toda ferramenta, como o guia já promete para as de JSON | P3 |

- Os modos de tema fizeram exatamente o que esta folha pedia: `set_tokens {mode: "light"}` mais `mode: "light"` no frame deram um único desenho em dois temas, e os valores claros são agora os valores que `apps/web/src/styles.css` publica em `.ui-light` — board e código decididos uma vez, não duas.
- Depois da correção, o `lint_design` fica com 0 erros nos cinco frames; o único erro de `contrast` que ele pegou (um link em 4,24:1 sobre superfície clara) era um erro real na paleta, e hoje é outro token no código.
- Redesenhar saiu mais barato que remendar: `delete_nodes` nas cinco raízes e um `create_nodes` novo, tudo num `batch`, desfeito por um único `undo`.

## 2026-11-22: painel de time e roster de agentes, antes e depois (PAP-B-034, design first)

Tarefa: desenhar o painel de time e o roster de agentes como estão hoje e como ficam sobre os primitivos, nos dois
escopos de tema, e migrar `apps/web/src/Team.tsx` e o roster em `apps/web/src/AgentCursors.tsx`. Cinco frames raiz na
página `Interfaces`, ~560 nós, e depois o app real em modo `--team` capturado para o registro.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 85 | A captura do próprio app dentro do documento de design, como referência do "antes" | Os nós de imagem não se dimensionam como o quadro diz: o mesmo PNG 280×856 pintou certo num quadro 190×581 com `fit: "contain"` num frame e virou uma tira de ~60×12 noutro em que o quadro era do tamanho da fonte; uma fonte 1440×900 num quadro 560×350 não pintou nada. O `lint_design` ficou limpo e nenhum erro voltou — só descobri olhando o `render_screenshot`. As capturas acabaram commitadas ao lado do board, não dentro dele | Documentar o que `width`/`height` fazem num nó `image` (escalam, recortam, ou nada), e fazer uma fonte maior que o quadro escalar ou reportar | P2 |
| 86 | Um board cujos nomes de token são os nomes do código | Os tokens da folha são `ui.card` e `ui.mutedFg` (pontos, abreviações), enquanto `apps/web/src/styles.css` publica `--color-ui-card` e `--color-ui-muted-foreground`. Nada liga um ao outro, então "comparar board com código" é passo humano, e digitei os mesmos valores nos dois lados | Aceitar um alias ou `source` no token (ex.: `ui.card` → `--color-ui-card`), ou deixar o `set_tokens` ler os nomes de um arquivo CSS | P3 |
| 87 | Um token do documento para o vermelho que o app pinta | `--color-accent-strong: #c8401f` está no CSS, mas os tokens de marca do documento são `$accent` (#e04a2b) e `$accent.dark`. Todo botão primário da folha ficou literal, e o `lint_design` devolve infos `raw-color` neles | Adicionar `$accent.strong` (e o ink) aos tokens de marca do documento, para board e CSS chamarem a mesma cor pelo mesmo nome | P3 |

- Um construtor, dois modos: a mesma função do painel desenhou `antes` e `depois` e depois a folha clara, então as três folhas são a mesma geometria e só mudam os pares de tokens e o tamanho dos controles. Isso deixou a comparação legível.
- `lint_design` nos cinco frames: 0 erros, os mesmos avisos `small-text` da folha do PAP-B-030 (o tipo de 11 e 12px do próprio painel), mais os infos `raw-color` do item 87.
- As alturas dos frames tiveram que ser ajustadas na mão de novo (o item 81 continua valendo): uma coluna `hug` dentro de uma linha `hug` cortava o segundo painel até o frame externo ganhar altura explícita.

## 2026-11-22: alças de redimensionar nos quatro cantos (PAP-B-029, design first)

Tarefa: desenhar antes/depois das alças de seleção e um demo de arraste no NW na página `Interfaces`, depois
adicionar as alças NW/NE/SW/SE em `apps/web/src/Canvas.tsx`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 88 | Comprimentos com token no create_nodes sem segunda passada | `radius: "$radius.md"` e `fontSize: "$text.2xs"` foram recusados (`expected number`); a medida começou em 10px/`$select` sobre `$canvas` e falhou o contraste até um `update_nodes` | Feito (2026-11-22, PAP-B-065): igual ao #83; `radius` e `fontSize` aceitam `$token` na criação | — |

- Três frames raiz, uma chamada `create_nodes`; `lint_design` 0 depois de corrigir tamanhos da medida/nota; capturas em `docs/assets/boards/PAP-B-029`.

## 2026-11-22: campos numéricos do inspector (PAP-B-027, design first)

Tarefa: desenhar os estados do campo Opacidade (normal, focado, inválido com mensagem) em claro e escuro na página `Interfaces` do workspace Paprika antes de corrigir `Field`/`setNum`; seis frames raiz com altura fixa, uma chamada `create_nodes`, depois screenshots em `docs/assets/boards/PAP-B-027/`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 89 | `layout.padding` como `[0, 8]` (dois valores) | `create_nodes` respondeu `layout.padding: Invalid input`; só aceita escalar ou tupla de 4. Precisei trocar todo padding para um número só | Feito (2026-11-22, PAP-B-065): o guia diz que padding é um número ou `[topo, direita, baixo, esquerda]`, não dois valores. Cada valor pode ser um token de comprimento | — |
| 90 | `radius: "$radius.md"` numa folha que já usa fills `$ui.*` | Mesma recusa do #83 (`expected number, received string`); o board voltou a usar literais `6` / `8` | Feito (2026-11-22, PAP-B-065): igual ao #83 | — |
| 91 | Saber quais ids em `created` são as raízes | `create_nodes` devolve uma lista plana em DFS de todos os ids aninhados; as seis raízes do board não eram as seis primeiras, e a primeira passagem de screenshot pegou títulos e rótulos | Feito (2026-11-22, PAP-B-064): `create_nodes`, `duplicate_nodes` e as importações devolvem `{ids, roots, created}` (`roots` nomeia cada nó de topo e a caixa; `created` é `{id, name, type, parentId}`; `ids` guarda a lista antiga) e uma linha legível por raiz | — |

- Alturas fixas nas seis raízes evitaram o hang/pitfall de hug do ticket; `render_screenshot` com `scale: 2` bastou para julgar anel de foco e mensagem inválida.
- `find_nodes {name: "PAP-B-027 field", type: "frame"}` foi o jeito confiável de mapear nome do board → id depois da lista plana `created`.

## 2026-11-22: botão de perigo e diálogo de confirmação (PAP-B-026, design first)

Tarefa: desenhar o botão de perigo (estados, claro e escuro) e os diálogos de confirmação (excluir workspace com o nome digitado, vazio e preenchido; remover membro) na página `Interfaces`, depois criar o diálogo e os tokens de perigo em `apps/web`. Oito frames raiz de altura fixa, ~190 nós, uma chamada `create_nodes`. O workspace ativo no servidor do mantenedor não era o `Paprika`, então o board foi desenhado num `paprika serve` descartável (renomeado `Paprika`) e os PNGs foram para o PR.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 92 | Desenhar num workspace que não é o ativo | O ticket manda desenhar no `Paprika` sem chamar `open_workspace`, mas toda ferramenta age no workspace ativo; sobrou pedir ao humano para trocar ou subir um segundo servidor | Feito (2026-11-22, PAP-B-063): `workspaceId` opcional nas ferramentas de documento (leitura e escrita), para o agente desenhar num workspace nomeado sem mexer no canvas do humano | — |
| 93 | Um `fontFamily` que o renderizador não tem | `fontFamily: "Inter"` saiu em serifa no `render_screenshot` (o app cai na sans do sistema na pilha do CSS), então a primeira folha não parecia o app até a família virar `sans-serif` | Cair na sans-serif genérica quando a família não existe, ou aceitar uma pilha (`"Inter, sans-serif"`) em `fontFamily` | P3 |
| 94 | Um frame `mode: "dark"` num documento cujos tokens base já são os escuros | O `lint_design` respondeu `unknown-mode` para `dark` até os mesmos tokens serem gravados também com `set_tokens {mode: "dark"}`, duplicando os valores da base | Tratar um modo sem tokens como a base, sem aviso, quando o documento só define um outro modo, ou deixar o `set_tokens` apelidar um modo para a base | P3 |

- `lint_design` nos oito frames: 0 erros; os avisos `small-text` são o tipo de 11 px do próprio app (item 82).
- Um anel de foco desenhado como frame de embrulho com `layout` sem `mode` colapsou num ponto (`hug-without-layout`); o lint apontou, e `layout: {mode: "row", padding: 2}` resolveu.
- O contraste foi calculado antes de desenhar, então o vermelho acertou de primeira: branco sobre `#cc2f50` dá 5,13:1 e a tinta `#ff9fb2` dá 7,01:1 sobre `#272d45`.
## 2026-11-22: apagamento em dois passos e o log de operações (PAP-B-015, servidor)

Tarefa: `delete_workspace` em duas chamadas (resumo + token de curta duração) e um log legível das operações
de workspace. Sem folha de design: a mudança é no servidor; a metade de UI (o aviso no canvas) é o PAP-B-026.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 95 | Um lugar só para o guia do agente | O guia vive em dois lugares — `instructions` em `server-go/contract/mcp.json` (en) e `server-go/contract/guide.pt-BR.md` — e uma frase sobre uma ferramenta tem que ser editada nas duas à mão. Nada confere se elas batem, então uma ferramenta pode estar descrita num idioma e não no outro | Um teste conferindo que todo nome de ferramenta do contrato aparece nos dois guias (do jeito que `TestToolsMatchContract` amarra os nomes aos handlers) pegaria isso; a frase do `delete_workspace` foi editada duas vezes de propósito | P2 |
| 96 | Contrato e handler andarem juntos | Criar `list_workspace_ops` primeiro só falhou em `TestToolsMatchContract`, que é o mecanismo certo; mas a lista de nomes em `packages/e2e/test/api.test.ts` é uma terceira cópia, que falha separada e com um diff que não diz qual lado se moveu | Manter as duas checagens e, na falha do api, imprimir se quem mudou foi o servidor, o contrato ou a lista do teste | P3 |

- O `mu` do store não é reentrante, e `DeleteWorkspace` já chama `OpenWorkspace`: a entrada `open` do sucessor é logada antes da entrada `delete`, então ler o log do mais recente para o mais antigo dá o apagamento primeiro e a troca logo abaixo. Útil para quem escrever o aviso que ainda falta.
- O documento de design em `127.0.0.1:4777` sumiu quando aquele endpoint passou à pilha do compose com volume novo: a página `Interfaces`, com as folhas do PAP-B-030 e do PAP-B-034, não existe mais, e só os PNGs commitados em `docs/assets/boards/` sobraram. A folha do PAP-B-026 foi redesenhada num servidor local. O que quer que entre da proposta de guardar as folhas no repositório, um reset de servidor não deveria custar um redesenho.
## 2026-11-22: linguagem de perigo e o padrão de confirmação (PAP-B-026, design first)

Tarefa: desenhar o botão de perigo (antes e depois, nos dois escopos de tema) e o padrão de confirmação antes
de mexer em qualquer código, e aplicar depois em `apps/web`. Cinco frames raiz, ~330 nós, mais o overview real
capturado antes e depois.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 97 | As folhas de design sobreviverem a uma troca de servidor | `127.0.0.1:4777` saiu do servidor rodando no host e passou à pilha do compose com um volume novo: o documento `Paprika`, que guarda a página `Interfaces` — a folha do PAP-B-030, a do PAP-B-034 e os frames do PAP-B-026 que eu tinha desenhado minutos antes — sumiu do `list_workspaces`. Só os PNGs commitados em `docs/assets/boards/` sobraram, e a folha teve que ser desenhada de novo pelo script num `paprika serve` que subi eu mesmo | Exportar o documento das folhas para dentro do repositório (`design/boards.paprika.json`, como `design/landing.paprika.json` guarda a landing page) e atualizar a exportação conforme as folhas entram; um reset de servidor custaria um reload, não um redesenho | P1 |
| 98 | Um teste de contraste que não minta | A primeira medição do hover devolveu a cor de repouso porque o `transition-colors` ainda não tinha aterrissado, então a asserção passou sem nunca testar o hover; uma sonda manual com espera de 300 ms mostrou que a lavanda do hover é mais forte e que o texto claro tinha caído para 4,39:1 | Nada para a ferramenta mudar. Registrado porque é fácil repetir: espere a transição, leia depois, e assera os dois estados — como a suíte faz agora | P3 |

- O `lint_design` apontou o texto destrutivo claro em 4,05:1 já na primeira folha, antes de qualquer linha de código — o mesmo tipo de erro que pegou na folha do PAP-B-030, e os alfas dos tokens são os que são hoje por causa dele.

## 2026-11-22: duplo clique na seta para editar o rótulo (PAP-B-028, design first)

Tarefa: desenhar o rótulo da seta em três estados (sem rótulo, editando com cursor e halo, com rótulo), claro e
escuro, antes do editor no lugar no canvas. Seis frames raiz, ~40 nós.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 99 | Estado de campo de texto com contorno de foco tracejado | O editor desenha um contorno `select` tracejado, mas `stroke` em rect e frame só tem `color` e `width`, então a folha mostra o contorno contínuo; o cursor é um rect de 1,5 px sobre um nó de texto | Um campo `dash` em `stroke` de rect, ellipse e frame (conectores já têm `dashed`) deixaria a folha igual ao que o `nodeStyle` pinta | P3 |
| 100 | Exportar o documento das folhas de um servidor em container | `paprika export --db <db>` precisa do arquivo do banco, que fica no volume do compose; o documento só é alcançável por `GET /api/export` | Citar `curl http://127.0.0.1:4777/api/export` em `docs/design-boards.md` ao lado da forma pela CLI | P3 |
## 2026-11-22: renomear a única página (PAP-B-020, design first)

Tarefa: desenhar o painel de páginas antes, durante e depois de renomear o placeholder "Página 1" de um workspace
sem páginas, e ligar o renomear em `apps/web`. Seis frames raiz (três estados, claro e escuro), ~60 nós.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 99 | Uma página para desenhar num documento vazio | O workspace ativo não tinha nós, então a página `Interfaces` não existia e `create_page` teve de ser a primeira chamada; o documento de boards do repositório (`docs/design/boards.paprika.json`) guarda outra página, então não havia o que importar sem que o `--replace` apagasse as folhas que outros tickets desenham em paralelo | Feito (2026-11-22, PAP-B-064): `create_page` com `ensure: true` devolve a página que já tem esse nome, em vez de criar uma segunda | — |
| 100 | Screenshot como arquivo | `render_screenshot` devolve o PNG só em base64 dentro do resultado JSON-RPC, então salvar em `docs/assets/boards/` exige um script de decodificação a cada ticket | Feito (2026-11-22, PAP-B-062): `path` opcional dentro do diretório de screenshots grava o arquivo e devolve o local | — |

- O `lint_design` apontou a legenda de 11 px (`small-text`) nos seis frames; 12 px resolveu, então as legendas ficam no menor tamanho legível do app.
- O modo `light` no frame, mais os mesmos tokens `pg.*` sobrescritos em `set_tokens {mode: "light"}`, renderizou os dois temas a partir de um só conjunto de nós, sem editar cor por frame.

## 2026-11-22: aviso no canvas quando um agente apaga ou troca o workspace (PAP-B-037, design first)

Tarefa: desenhar o aviso sem bloquear (apagar com contagens, abrir, renomear; claro e escuro) antes de
ligar o `WorkspaceNotice` e o broadcast WebSocket `workspaceOp`. Seis frames raiz.

| # | Needed | What happened | Proposal | Pri. |
|---|--------|---------------|----------|------|
| 101 | Ouvir operações de workspace no canvas sem pollear HTTP | `list_workspace_ops` existe, mas o canvas ao vivo só via patches do documento; apagar o workspace ativo deixava o humano num editor morto até dar refresh | Broadcast de cada entrada nova do log como `{type:workspaceOp, op}` no hub WebSocket (ler o log; pular entradas anteriores ao subscriber) | P2 |

- Roots com altura fixa; PNGs em `docs/assets/boards/PAP-B-037/`.
- Aviso com `role=status` e sem roubar foco; na visão geral o mount cobre o delete depois que a rota do canvas some.

## 2026-11-22: painéis laterais recolhem num botão flutuante (PAP-B-024, design first)

Tarefa: desenhar os painéis recolhidos (só o da esquerda, os dois) ao lado do layout expandido, claro e escuro,
e conferir que os botões flutuantes não cobrem a toolbar nem a lista de agentes, antes de escrever a UI. Seis
frames raiz em `Interfaces`, desenhados por um script numa única chamada de `create_nodes`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 101 | Capturas de tela como arquivo | `render_screenshot` só devolve base64 dentro do JSON do resultado, então cada PNG teve que ser decodificado à mão num script antes de entrar em `docs/assets/boards/` | Feito (2026-11-22, PAP-B-062): `path` opcional grava o PNG no diretório de screenshots e devolve o local | — |
| 102 | Um mock em escala menor vira texto minúsculo no lint | As folhas são o layout real a dois terços do tamanho, então todo rótulo tem 8–9px e o `lint_design` devolve um aviso `small-text` por rótulo, o que enterra os achados que importam | Feito (2026-11-22, PAP-B-066): `scaledMock` no frame, ou `minFontSize` no `lint_design` | — |
| 103 | Espaço livre para um frame novo | Nada diz onde o próximo frame de topo cabe sem pisar no de um ticket paralelo: o outline teve que ser varrido atrás de coordenadas e as folhas foram para `x=2000` na mão | Feito (2026-11-22, PAP-B-061): `get_document_outline` e `get_bounds` (sem ids) devolvem a caixa do conteúdo e o próximo lugar livre; `create_nodes` usa `place: "free"` quando x e y faltam | — |
| 104 | Ícones pelo nome | Os botões flutuantes usam `PanelLeftOpen` e `PanelRightOpen` do lucide, e a folha teve que carregar o path deles digitado à mão, que é como um ícone da folha pode divergir do app | O `import_svg` já existe; um jeito de importar um ícone do lucide pelo nome fecharia o ciclo | P3 |

- O botão do painel direito recolhido cai onde está a lista de agentes (canto superior direito do canvas); a folha mostrou isso antes de qualquer código, e a lista desce para baixo do botão só enquanto aquele painel está recolhido.

## 2026-11-22: visão geral e diálogos no shadcn (PAP-B-031, design first)

Tarefa: desenhar a visão geral de workspaces (grade, formulário de novo workspace, confirmação de exclusão) nos
dois escopos de tema em `127.0.0.1:4777`, depois migrar `Overview.tsx` para `Card`, `Button` e `Input` e
adicionar `card.tsx`. Seis frames em `docs/assets/boards/PAP-B-031/`; o export de boards em
`docs/design/boards.paprika.json` já trazia as folhas PAP-B-031 de um desenho anterior (`/tmp/b031/draw.mjs`).

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 105 | Reaproveitar um desenho sem redesenhar | Os PNGs e os nós em `boards.paprika.json` já vinham de uma sessão anterior; o ticket só copiou os shots e aplicou o markup | Nada novo — o padrão de board no repositório (item 97) funcionou aqui | — |

- O `ConfirmDialog` já estava em `AlertDialog` com `variant: "destructive"` na ação de confirmar (PAP-B-026); a visão geral só consome.
- Os cards de workspace mantêm `outline` em vez de `border` para a capa não comer a borda ativa; o `Card` vem com `border-ui-border`, mas a visão geral sobrescreve com `border-0` e as classes de outline que já existiam.

## 2026-11-22: shell, toolbar, camadas e páginas no shadcn (PAP-B-033, design first)

Tarefa: desenhar o shell do editor (expandido, esquerdo recolhido, ambos recolhidos) nos dois escopos de
tema em `127.0.0.1:4777`, depois migrar `App` / toolbar / `Layers` / `Pages` / `InlineName` / `PanelResizer`
para os primitivos. Seis frames em `docs/assets/boards/PAP-B-033/`; o export em
`docs/design/boards.paprika.json` os carrega.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 108 | ToggleGroup que mantém `role=button` + `aria-pressed` | O Radix `type="single"` vira radiogroup (`role=radio`, `aria-checked`, `aria-pressed` limpo). O E2E da toolbar (`getByRole("button")` + `aria-pressed` + classe `is-active`) quebraria | Usar `type="multiple"` com valor controlado de um item e `rovingFocus={false}` para o Tab continuar andando em cada ferramenta; manter o `<nav aria-label="Ferramentas">` por fora | P2 |
| 109 | Rótulo de aba inativa na faixa night no claro | A faixa de abas do painel direito fica `bg-night` nos dois escopos; `$pg.muted` sob `mode=light` é `#5d6478` e o lint marca 2.99:1 sobre night | No board (e no app) usar o muted noturno (`$muted` / `text-muted`) nos rótulos que sentam na faixa night | P3 |

- Os hotspots de E2E (`is-active`, `layer-name`, `page`, `data-panel-toggle`, `treeitem`, `add-page`) ficaram como classes/ganchos plain.
- `ui.iconBtn` saiu de `ui.ts`; Inspector/Team/Overview ainda donos das entradas restantes.

## 2026-11-22: inspector compacto (PAP-B-022, design parcial)

Tarefa: redesenhar o inspector de cena em seções recolhíveis antes de implementar `apps/web/src/inspector/**`. Dois frames de design (`PAP-B-022 texto escuro` / `claro`) já estão em `docs/design/boards.paprika.json`; o redraw completo no MCP em `:4777` foi pulado com o servidor compartilhado lento, e os PNGs antes/depois em `docs/assets/boards/PAP-B-022/` carregam o caso de medição.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 106 | Altura do inspector que prova o layout compacto | O `aside.right.scrollHeight` ficou em 856 px antes e depois porque a área do grid força um container alto; a altura de `#right-tabpanel` caiu de 759 para 303 px (~60%) com o nó de texto do demo em 1440×900 (`packages/e2e/b022-measure.mjs`) | Usar `panel` / `panelScroll` no script de medição (e nas notas de aceite), não só `aside.scrollHeight` | P3 |
| 107 | Boards no servidor MCP compartilhado | O `:4777` respondeu devagar durante o ticket, então só os frames de design existentes mais screenshots da runtime foram commitados; nenhum frame novo de altura fixa foi desenhado no MCP nesta passagem | Igual ao #97: um documento de boards no git que os agentes possam `load` sem depender do volume montado na porta do mantenedor | P2 |

## 2026-11-22: fantasma do elemento enquanto desenha (PAP-B-043, design first)

Tarefa: desenhar o fantasma do nó real (preenchimento/contorno/padrões) dentro da área de rascunho ao
arrastar uma ferramenta de criação, claro e escuro, depois pintá-lo a partir de `nodeStyle` em
`Canvas.tsx` sem escrever no documento até soltar. Oito frames de altura fixa em `Interfaces`
(`docs/assets/boards/PAP-B-043/`).

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 108 | Capturas de tela como arquivo | Igual ao #100/#101: `render_screenshot` só devolve o PNG em base64 no conteúdo JSON-RPC, então um script cliente teve que decodificar cada shot em `docs/assets/boards/PAP-B-043/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` grava o arquivo | — |
| 109 | Espaço livre para boards novos | Frames de topo já ocupam y≈0…8320 e x≈0…3000; o outline com depth 1 bastou para escolher `y=9000`, mas tickets paralelos ainda disputam a mesma faixa | Feito (2026-11-22, PAP-B-061): igual ao #103 — caixa do conteúdo, próximo lugar livre e `place: "free"` | — |

- O workspace ativo já era `Paprika - UI` / página `Interfaces`; sem `open_workspace`.
- O fantasma é `aria-hidden` e `pointer-events: none` (`data-testid="draft-ghost"`); o fantasma da seta do conector ficou fora do escopo draft-only deste ticket.

## 2026-11-22: inspector no shadcn (PAP-B-032, design first)

Tarefa: desenhar o inspector (campos compactos, seções recolhíveis, selects, ações secundárias) nos dois
escopos de tema em `127.0.0.1:4777`, depois migrar `Inspector.tsx` + `inspector/*` para `Input`, `Textarea`,
`Label`, `Select`, `Button` e `Collapsible`. Quatro frames em `docs/assets/boards/PAP-B-032/`; export dos
boards atualizado.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|-----------------|----------|------|
| 110 | Capturas de tela como arquivo | Igual ao #108: `render_screenshot` só devolve PNG em base64; um script cliente decodificou em `docs/assets/boards/PAP-B-032/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` | — |
| 111 | Faixa livre sem disputar tickets paralelos | O outline depth 1 listava frames até y≈11820 (B-023/B-033/B-043); este ticket escolheu y=12400 / 13160 | Feito (2026-11-22, PAP-B-061): `place: "free"` em `create_nodes` (igual ao #103/#109) | — |

- `lint_design` com `rootIds` ainda conta o documento inteiro; os quatro frames nossos tinham 0 erros próprios.
- Mantida a casca compacta do campo (densidade B-022): os primitivos ficam dentro de `bg-ui-muted` sem borda própria; o `Select` Radix substituiu o `<select>` nativo (teste E2E de modo de tema atualizado para clicar a opção).
- Layers/Pages ficaram de fora (PAP-B-033 é dono desse chrome).
## 2026-11-22: forma triângulo (PAP-A-004, design first)

Tarefa: desenhar estados da toolbar / inspector / canvas para o `ShapeKind` `triangle` em `Interfaces` (claro+escuro, altura fixa), depois entregar schema, contorno, conectores, toolbar `G`, seletor do inspector e `draw_diagram`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 110 | Ferramenta da toolbar em `App.tsx` | Os paths do ticket listavam só `Canvas.tsx` para toolbar+atalho, mas `TOOLS[]` e o keydown estão em `App.tsx`; editei esse arquivo para a entrada `G` / Triangle e perguntei ao `agent:leonardo` | Manter o registro da toolbar junto dos botões, ou mover `TOOLS` para `Canvas.tsx` para os paths da raia baterem | P3 |
| 111 | Gate de `shapeDefaults` em `ops` | `ops.ts` / `ops.go` só aplicam padrões a uma lista fixa de kinds; `triangle` precisou da mesma linha (fora dos `paths` do ticket) | Derivar o gate de `ShapeKind` / `shapeDefaults` para kinds novos não tocarem em `ops` | P3 |

- Seis frames em `docs/assets/boards/PAP-A-004/`; boards reexportados via `GET /api/export` em `docs/design/boards.paprika.json` (sem `open_workspace`).
- `wasmPaintable` continua falso para nós `shape` (o DOM pinta o contorno do triângulo).
## 2026-11-22: color picker customizado (PAP-B-023, design first)

Tarefa: desenhar os estados fechado, aberto e alpha do campo de cor do inspector (claro e escuro) em
`Interfaces` antes de trocar o `input type=color` nativo por um popover. Seis frames raiz de altura fixa;
PNGs em `docs/assets/boards/PAP-B-023/`; export dos boards via `GET /api/export`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 110 | Y livre para frames de boards em paralelo | Vários tickets compartilham `Interfaces`; o outline é prosa, então colocar o PAP-B-023 exigiu exportar o documento e varrer os `y` de topo à mão (pousou em `y=11000`) | Feito (2026-11-22, PAP-B-061): caixa do conteúdo e `place: "free"`, igual ao #103 | — || 111 | Capturas como arquivo | O `render_screenshot` ainda devolve base64 no JSON; um script Node teve que decodificar cada PNG em `docs/assets/boards/PAP-B-023/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` (igual ao #100 / #101) | — || 112 | Escape que fecha um popover sem limpar a seleção | O `App.tsx` escuta Escape no `window` e troca a seleção; o primeiro Esc do color picker também desmontava o campo do inspector antes do foco voltar ao swatch | Ignorar Escape quando o alvo está dentro de `[data-slot="popover-content"]` / diálogo (feito neste ticket); popovers também devem dar `stopPropagation` | P2 |
- O workspace ativo já era `Paprika - UI`; sem `open_workspace`.
- O `lint_design` da página ainda aponta um erro de contraste antigo sem relação; os frames novos não acrescentaram erros.
## 2026-11-22: atalhos de proporção ao redimensionar (PAP-B-042, design first)

Tarefa: desenhar os estados livre / manter proporção / quadrado (claro e escuro) na página `Interfaces` do `Paprika - UI`, depois ligar as travas `Shift` e `Shift+Alt` e a dica no canvas em `apps/web/src/Canvas.tsx`. Seis frames raiz de altura fixa; capturas em `docs/assets/boards/PAP-B-042/`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 110 | `lint_design` limitado às raízes do ticket | Chamar `lint_design` com `rootIds` dos seis frames PAP-B-042 ainda devolveu centenas de avisos e um erro de contraste de folhas antigas na mesma página (`nodeId` fora das raízes pedidas) | Feito (2026-11-22, PAP-B-066): `rootIds` é filtro duro da subárvore (um id ausente é erro) | — || 111 | Screenshots como arquivo | Igual ao #100 / #101: `render_screenshot` só devolve base64; um script local teve que decodificar em `docs/assets/boards/PAP-B-042/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` | — |
- O workspace ativo já era `Paprika - UI`; `Interfaces` existia (`interfaces-pap020`); sem `open_workspace`.
- Alturas fixas de 360 px evitaram o problema de screenshot com hug; `render_screenshot` com `scale: 2` bastou para julgar as dicas.
## 2026-11-22: histórico de atividade (PAP-B-025, design first)

Tarefa: desenhar o feed de atividade (ator cor+nome, ação, tempo relativo, agrupamento de lote, marcador de desfazer/refazer) em claro e escuro antes de extrair `Activity.tsx` do Inspector. Quatro frames raiz em `Interfaces` (`PAP-B-025 feed|undo` × light/dark), altura fixa 320; PNGs em `docs/assets/boards/PAP-B-025/`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 110 | Cor do nome do agente que passe contraste no painel | Usar o azul do agente (`#3b82f6`) no ponto e no nome falhou WCAG AA em `$pg.panel2` (3.69:1); a folha manteve a cor só no ponto e `$pg.fg` no nome | Documentar que as cores de presença são para preenchimento/pontos, não para texto no painel, ou oferecer variantes seguras ao lado de `AGENT_COLORS` | P3 || 111 | `$pg.select` como tinta do marcador no modo claro | O rótulo "agora" em `$pg.select` no painel claro ficou em 3.91:1; trocar o rótulo para `$pg.fg` e deixar a linha em select corrigiu o lint sem token novo | Um `select-ink` (ou `$pg.select` mais escuro no modo claro) para texto em superfícies claras | P3 |
- `layout.padding: [6, 8]` (dois valores) é rejeitado; quatro valores ou um número só funcionam.
- A posição de desfazer/refazer vem no cliente dos rótulos iniciais `desfazer:` / `refazer:` no feed WS existente — sem mudança no servidor.

## 2026-11-22: Internacionalização en + pt-BR (PAP-B-052, design first)

Tarefa: UI web + nomes padrão seguem o idioma escolhido; detectar do navegador, trocar no app, lembrar; erros da API HTTP → inglês como o MCP. Seis frames (overview e troca de idioma × en/pt-BR × escuro/claro) desenhados via MCP; PNGs em `docs/assets/boards/PAP-B-052/`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 115 | Export das boards no volume Docker | Igual ao #113: o `:4777` guarda as pranchas; este agente commitou os PNGs do `render_screenshot` e deixou `docs/design/boards.paprika.json` para um export com DB montado no host | MCP `export_document` ou caminho de DB montado no host para agentes | P2 |
| 116 | Ligar o resto das strings do Inspector/Time | Shell, overview, páginas, camadas, zoom, ordem e multi-seleção estão no dicionário; muitos rótulos de campo do Inspector e textos do Time ainda são literais em português, embora as chaves já existam em `apps/web/src/i18n/messages.ts` | Terminar o passe campo a campo (ou gerar rótulos do catálogo) num follow-up | P2 |
| 117 | Nome padrão do `create_page` no guia pt-BR | O fallback sem nome no core/MCP agora é inglês (`Page 1`); `guide.pt-BR.md` ainda descreve `"Página 1"` | Alinhar o guia em português ao padrão inglês (ou dizer que a UI localiza quando passa `name`) | P3 |

- Dicionários leves (sem i18next): `LocaleProvider` fora do único `TooltipProvider` para a troca de idioma não remountar as dicas.
- E2E: `pinLocale(page, "pt-BR")` em a11y/canvas/drag; `i18n.e2e.test.ts` faz smoke nos dois idiomas e no seletor.
- Hotspots (`is-active`, `add-page`, `data-testid`, roles) continuam estáveis ao idioma.

## 2026-11-22: atributos `title` → tooltips acessíveis (PAP-B-051, design first)

Tarefa: trocar todo `title` HTML em `apps/web` pelo Tooltip shadcn (`Hint`: hover + foco, Esc fecha), mantendo `aria-label` nos botões de ícone. Três frames em `Interfaces` (`Paprika - UI`): antes/depois escuro, antes/depois claro, estados foco/Esc. PNGs em `docs/assets/boards/PAP-B-051/`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 112 | Tinta do texto vs `fill` nos boards | Preencher `fill` num nó de texto deixou `color` no padrão `#111111`; o lint comparou `color` com o próprio `fill` e marcou contraste ~1:1 na folha clara | Documentar que a tinta do texto é `color` (não `fill`) no guia / exemplos de `create_nodes` | P2 |
| 113 | Export do DB vivo dos boards | O store em `:4777` é volume Docker; este agente não teve caminho aprovado para `paprika export` no container, então só os PNGs entraram no commit | Continuar atualizando `docs/design/boards.paprika.json` a partir de um DB montado no host, ou MCP `export_document` | P2 |
| 114 | Controles desabilitados e Tooltip | O Radix não abre tooltip num botão `disabled` (sem ponteiro/foco); o excluir do overview com um só workspace e as pills de agente idle precisam de um `span` focável em volta | Anotar o padrão do span junto do `Hint` no ADR 0005 ou na galeria | P3 |

- `TooltipProvider` foi para `main.tsx` (Overview, Editor e `/ui` compartilham o delay); a toolbar flutuante deixou o provider local.
- Esc no App não limpa a seleção enquanto um tooltip está aberto (`[data-slot=tooltip-content]`).
- E2E a11y: zoom + Retângulo abrem no foco, Esc fecha, sem `title` nativo; roster de agentes asserta tooltip em vez de `title`.

## 2026-11-22: atalhos de ordem Z e seção Ordem (PAP-B-021, design first)

Tarefa: desenhar a seção **Ordem** do inspector e o mapa de atalhos de ordem Z (claro e escuro, altura fixa) na página `Interfaces` de `Paprika - UI` antes de ligar `Page Up`/`Page Down` (+ Ctrl/Cmd para frente/fundo) em `Canvas.tsx` e as quatro ações de ordem em `Inspector.tsx`. Quatro frames raiz, uma chamada `create_nodes`; PNGs em `docs/assets/boards/PAP-B-021/`; export dos boards atualizado em `docs/design/boards.paprika.json`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 110 | Desenhar em `Paprika - UI` sem `open_workspace` | O workspace já estava ativo (`list_workspaces`), então a prancha entrou sem trocar; se outro ticket tivesse deixado outro doc ativo, as opções ainda seriam pedir ao humano ou um segundo servidor (igual ao #92) | Feito (2026-11-22, PAP-B-063): `workspaceId` opcional nas ferramentas de documento | — |
- `lint_design` nos quatro frames: 0 erros; avisos `small-text` são os rótulos de 11 px da seção/chip, iguais ao app.
- Mapa de atalhos escolhido e documentado em `docs/pt-BR/canvas.md`: `Page Up`/`Page Down` = avançar/recuar, `Ctrl+Page Up`/`Ctrl+Page Down` (Cmd no macOS) = frente/fundo.

## 2026-11-22: três estilos de traçado de seta (PAP-B-045, design first)

Tarefa: desenhar cotovelo / arredondado / curva e o picker Traço do inspector em `Interfaces` antes de codar `route: "rounded"|"curve"`. Quatro frames numa página Interfaces nova; PNGs em `docs/assets/boards/PAP-B-045/`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 112 | Pré-visualizar `rounded` / `curve` no servidor `:4777` ao vivo | O binário do mantenedor ainda só aceita `straight`\|`elbow`, então o `draw_diagram` recusou as rotas novas; a folha usou mocks em `path` | Publicar o schema antes de pedir redesenho no production, ou subir um `paprika serve` local do ticket | P3 |
- O workspace ativo era `Paprika - UI`; uma segunda página `Interfaces` (`interfaces-pap045`) foi criada porque o outline era grande — preferir reutilizar `interfaces-pap020` quando existir.
## 2026-11-22: vários tipos de borda (PAP-B-044, design first)

Tarefa: estender `stroke` com `style` (`solid`|`dashed`|`dotted`) e `position` (`inside`|`center`|`outside`) em frame/rect/ellipse/path/shape, depois Estilo/Posição no inspector. Quatro frames de altura fixa em `Interfaces` (`docs/assets/boards/PAP-B-044/`); export dos boards atualizado.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 113 | Id estável da página `Interfaces` entre tickets em paralelo | O workspace ativo virou `Paprika - UI` no meio do ticket; a página `interfaces` antiga sumiu e foi preciso criar outra (`id: interfaces`) enquanto outros tickets usavam `interfaces-pap020` / `interfaces-pap045` | `create_page` que reaproveita página existente pelo nome (igual ao #99) | P2 |
| 114 | Screenshots como arquivos | Igual ao #100/#101: `render_screenshot` só devolve base64 | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` | — |
- `style`/`position` padrão ficam omitidos no documento (helpers tratam ausência como sólido / posição por tipo) para round-trips e goldens não ganharem `style: "solid"` em todo stroke.
- WASM não traça dash nem reposiciona: `wasmPaintable` devolve false e o DOM pinta (crates/render intacto).
- Fecha o atrito do #99 (traço tracejado em caixas) via `stroke.style`.## 2026-11-22: steppers numéricos no inspector (PAP-B-046, design first)

Tarefa: desenhar campos numéricos puros com `±` (opacidade / peso / espessura), hug/fill e `$token` sem stepper, anel de foco e estado no mínimo (claro e escuro) antes de ligar os steppers no `Field`; seis frames raiz de altura fixa; capturas em `docs/assets/boards/PAP-B-046/`; `paprika serve` local na `:4799` porque o workspace compartilhado na `:4777` estava lotado por tickets paralelos.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 113 | Nome do parâmetro em `render_screenshot` | Passar `id` captura o canvas inteiro em silêncio (PNGs idênticos para cada frame); o contrato espera `rootId` | Recusar `id` desconhecido ou alias `id` → `rootId` no schema / handler | P2 |
| 114 | Servidor local quieto para boards em paralelo | A `:4777` compartilhada tinha folhas de outros agentes e frames empilhados em `(0,0)`; um `paprika serve --port 4799` descartável foi o caminho confiável (mesma classe do #92) | Feito (2026-11-22, PAP-B-063): `workspaceId` opcional nas ferramentas de documento para os tickets não brigarem pelo doc ativo | — |

- Avisos `small-text` do `lint_design` nos rótulos de 12 px batem com a densidade do inspector; nenhum erro novo de contraste nas seis raízes.
- Passos escolhidos conforme o ticket: opacidade `0.05`, peso `100`, senão `1`, Shift×10; validação/clamp reutilizados do PAP-B-027.

## 2026-11-22: toolbar ancorável (PAP-B-048, design first)

Tarefa: desenhar a toolbar ancorada no topo/esquerda/direita/fundo (claro e escuro) em `Interfaces` do workspace ativo `Paprica · UI`, depois implementar arraste pela alça, localStorage, menu por teclado e folga para os botões dos painéis recolhidos (PAP-B-024). Oito frames raiz de altura fixa (720×420); PNGs em `docs/assets/boards/PAP-B-048/`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 112 | Nome do argumento de `render_screenshot` | Passar `id` é ignorado em silêncio (o schema só tem `rootId`); a ferramenta captura outra coisa (aqui um frame 280×220 sem relação) e todos os PNGs saem iguais | Recusar args desconhecidos, ou aceitar `id` como alias de `rootId`, e dizer isso na descrição | P2 |
| 113 | `mode` claro com tokens `$pg.*` | Frames com `mode: "light"` ainda pintavam a paleta escura de `$pg.*` porque `modes.light` neste servidor só tinha `$ui.*`; foi preciso redesenhar o claro com cores literais | Documentar quais prefixos entram nos modos de tema, ou semear `$pg.*` no `light` quando o workspace de boards é criado | P2 |
| 114 | Screenshots como arquivo | Igual ao #101: só base64; um script local gravou `docs/assets/boards/PAP-B-048/` | `path` opcional no `render_screenshot` | P3 |

- O workspace ativo já era `Paprica · UI`; usei o `page#interfaces` existente sem `open_workspace`.
- Os botões dos painéis recolhidos se afastam com `[&_[data-panel-toggle=left]]:left-14` a partir do `App.tsx` quando a toolbar compartilha a borda — sem mudar `PanelResizer.tsx` (fora dos paths do ticket).
## 2026-11-22: combobox de fontes do sistema (PAP-B-047, design first)

Tarefa: desenhar os estados fechado e aberto do FontPicker (claro e escuro) em `Interfaces`, depois trocar o `fontFamily` em texto livre nos nós de texto por um combobox shadcn. Quatro frames de altura fixa; PNGs em `docs/assets/boards/PAP-B-047/`; export dos boards atualizado.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 115 | Screenshots como arquivos | Igual ao #108: `render_screenshot` devolve só base64; `scripts/draw-pap-b-047.mjs` decodificou em `docs/assets/boards/PAP-B-047/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` | — |
| 116 | Faixa livre numa página Interfaces cheia | O outline depth 1 termina perto de y≈13580 (A-004 / B-032); este ticket usou y=13800 | `place: "free"` em `create_nodes` (igual a #103/#109/#111) | P3 |
- Local Font Access fica atrás de um botão explícito — abrir o popover nunca chama `queryLocalFonts`.
- `cmdk` 1.1.1 fixado para o primitivo Command (lista de dependências do ADR 0005).
## 2026-11-22: drag and drop reparent + soltar arquivo (PAP-B-049, design first)

Tarefa: desenhar estados de reparent / inserção em auto-layout / reordenação em Camadas / soltar arquivo (claro e escuro) em `Interfaces`, depois ligar o DnD do canvas + linhas de Camadas + importação de arquivo do SO em `apps/web`. Oito frames raiz de altura fixa; PNGs em `docs/assets/boards/PAP-B-049/`; export dos boards atualizado via `GET /api/export`.

| # | Necessidade | O que aconteceu | Proposta | Pri. |
|---|-------------|----------------|----------|------|
| 110 | Nome do workspace ativo | O ticket pedia `Paprika - UI`; o servidor vivo tinha `Paprica · UI` (typo/renome) com outros tickets já desenhando na página `interfaces` | Aceitar nomes próximos como o workspace de UI, ou fixar o id no payload da assign | P3 |
| 111 | Corrida de `create_page` em Interfaces | Chamar `create_page` enquanto outro agente também garantia `Interfaces` gerou páginas vazias duplicadas além de `page#interfaces` | `create_page` idempotente por nome (igual ao #99) | P2 |
| 112 | Y livre entre boards paralelos | Frames do PAP-B-051 já estavam em y≈40; PAP-B-049 precisou ser movido depois para y=1100+ | Bbox no outline / `place: "free"` (igual ao #103 / #110) | P3 |
| 113 | Screenshots como arquivos | `render_screenshot` ainda devolve base64 no conteúdo MCP; decode local para `docs/assets/boards/PAP-B-049/` | Feito (2026-11-22, PAP-B-062): `path` opcional no `render_screenshot` | — |
| 114 | Typecheck quebrado no main | `ui.ts` perdeu `activity*`/`actions` no merge `3f0bda1`; Inspector ainda citava `ActivityEntry`/`Bot`; ColorField tinha `hex` indefinido | Proteger merge de `ui.ts` / religar Activity; este PR restaurou o mínimo para o `pnpm check` rodar | P1 |

- Desenhou no ativo `Paprica · UI` / página `interfaces` sem `open_workspace` depois de consultar o mantenedor sobre o nome.
- DnD do canvas só em `Canvas.tsx`; DnD HTML5 das Camadas em `Layers.tsx`; E2E em `drag.e2e.test.ts`.

## 2026-11-23: design dos apontamentos (design first, thread na nuvem)

Tarefa: desenhar a proposta de "apontar um elemento ou área e dizer ao agente o que fazer" (5 quadros: canvas, compositor, painel, contrato MCP, fluxo), primeiro num `paprika serve` na nuvem e depois no Paprika local do mantenedor em `Paprica · UI` (página nova, `workspaceId` em toda escrita, workspace ativo intocado). PNGs em `docs/assets/boards/agent-pins/`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 118 | Saber que `lineHeight` é razão | Mandei `lineHeight: 18` (px); o `create_nodes` recusou com "Too big: expected number to be <=10". O guia só diz `lineHeight (n \| "$token")` | Dizer "multiplicador do fontSize (1.4)" no guia e no erro | P3 |
| 119 | Screenshot de um quadro | `render_screenshot {nodeId}` devolveu a página inteira: o nome certo é `rootId` e o argumento desconhecido foi ignorado em silêncio, então cinco fotos "do quadro" saíram iguais | Recusar argumentos desconhecidos (ou avisar), como as ferramentas de escrita | P2 |
| 120 | Usar o Chromium do ambiente | `PAPRIKA_CHROMIUM=/opt/pw-browsers/chromium-1243/.../chrome` ainda foi recusado ("build 1243 is installed, but Playwright expects build 1255"); um symlink sem a revisão no caminho funcionou | `PAPRIKA_CHROMIUM` explícito pula a checagem de revisão (só avisa) | P2 |
| 121 | Desenhar num workspace sem mexer nos tokens dele | Para gravar os quadros em `Paprica · UI` tive de escrever as cores literais, porque `set_tokens` ali poderia sobrescrever tokens do mantenedor com o mesmo nome | `set_tokens {onlyMissing: true}` ou aviso listando os tokens sobrescritos | P3 |

- `workspaceId` em `create_page`/`create_nodes` funcionou bem: os quadros foram para `Paprica · UI` com o canvas parado no workspace ativo do mantenedor.
- `create_page {ensure: true}` + `place: "free"` posicionou os cinco quadros sem sobreposição e sem coordenadas à mão.

## 2026-11-23: arquivar workspaces (PAP-B-071, design first)

Tarefa: desenhar a ação de arquivar na overview e o filtro Arquivados (inglês escuro, arquivados escuro, português claro) em `Interfaces` de `Paprica · UI` (`cmio9n368k`, página `interfaces`) antes de implementar archive/unarchive. Quatro frames de altura fixa em x=6400; PNGs em `docs/assets/boards/PAP-B-071/`.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|----------------|----------|------|
| 122 | O workspace de UI nomeado no ticket | O payload pedia `Paprika - UI`. O workspace vivo é `Paprica · UI`. A correção do supervisor chegou depois do claim | Fixar o id do workspace no payload da assign (igual ao #110) | P3 |
| 123 | Um lugar livre em `Interfaces` | `get_document_outline` de `page#interfaces` devolveu `content` 0×0 e `next` 0,0 mesmo com vários frames na página, então `place: "free"` não serviu | A caixa de conteúdo da página deveria incluir os frames filhos | P2 |
| 124 | MCP durante um restart | As primeiras chamadas voltaram corpo vazio enquanto a `:4777` reiniciava; uma nova tentativa curta listou os workspaces | Manter o aviso de restart no ticket; clientes devem repetir uma resposta vazia | P3 |

- Endereçou o board por `workspaceId` e não chamou `open_workspace`.
- `lint_design` apontou a fileira de ações em português saindo de um card de 300px (`layout-overflow`); alargar o card para 360 limpou o aviso.
