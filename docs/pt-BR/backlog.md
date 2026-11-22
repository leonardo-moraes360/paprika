[🇺🇸 English](../backlog.md) | 🇧🇷 Português

# Backlog de features

Importado em 2026-11-21 de uma lista de capacidades que o mantenedor reuniu de fontes públicas sobre ferramentas de design feitas para agentes de IA. O trabalho começa depois que o servidor em Go e a avaliação do canvas em WASM terminarem.

**Regra de originalidade.** A lista é referência de *capacidades*, não especificação para copiar. O Paprika mantém nome, marca, visual, formato de documento, nomes de ferramentas e mapa de atalhos próprios. Não copia fontes, assets nem nomes de produtos proprietários, e nada aqui vem de engenharia reversa (ver o invariante em `.toolbelt/invariants.yaml`).

Status: ✅ feito · 🟡 parcial · ⬜ falta. Prioridade: **P1** próxima leva · **P2** depois · **P3** mais tarde · **Fora** fora do escopo de uma ferramenta local.
`fb#N` aponta para um item do [registro de feedback de agentes](feedback-agentes.md).

## Primeira leva sugerida (depois do servidor Go e da avaliação WASM)

1. Seleção múltipla, `group` e páginas (A, B).
2. Componentes e instâncias (H).
3. Colar SVG e HTML como nós, exportar SVG (F, G, J).
4. Edição ponto a ponto de paths (F).
5. Modos de tema e tokens exportados como variáveis CSS (E).
6. Camada de agentes: `structuredContent`, guia em inglês, transações agrupadas, ator vindo do `clientInfo` (I).

## A. Modelo do documento e layout

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Frames com layout tipo flex (linha/coluna, gap, padding, align, wrap) | `frame.layout` | ✅ | — |
| Páginas dentro de um arquivo | Nós `page`, lista de páginas no canvas, `create_page` (2026-11-21) | ✅ | — |
| Agrupar / envolver a seleção num frame, desagrupar | Nó `group`, `Ctrl+G`/`Ctrl+Shift+G`, `group_nodes`/`ungroup_nodes` (2026-11-21); ainda sem "envolver num frame" | 🟡 | P2 |
| Filho absoluto dentro de frame com layout ("ignorar layout") | Filhos de linha/coluna sempre seguem o fluxo | ⬜ | P1 |
| Raio por canto | `radius` único | 🟡 | P1 |
| Ordem Z (avançar, recuar, frente, fundo) | `move_nodes` com `index`; sem atalhos no canvas | 🟡 | P1 |
| Ocultar, travar, destravar tudo | `visible`, `locked`; sem "destravar tudo" | 🟡 | P2 |
| Alinhar e distribuir a seleção | — | ⬜ | P2 |
| Constraints (comportamento quando o pai redimensiona) | — | ⬜ | P2 |
| Alças de gap e padding no canvas | Só no inspector | ⬜ | P2 |
| Tokens de container e breakpoint, frames responsivos | — | ⬜ | P3 |
| Layout CSS Grid | — | ⬜ | P3 |

## B. Seleção e navegação no canvas

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Seleção múltipla (shift-clique, laço), selecionar tudo, selecionar irmãos | Shift/Ctrl-clique, laço, `Ctrl+A` seleciona os irmãos (2026-11-21) | ✅ | — |
| Descer/subir na hierarquia, seleção profunda, ciclar irmãos | `Esc` seleciona o pai, duplo clique seleciona dentro do grupo; sem ciclar irmãos | 🟡 | P2 |
| Árvore de camadas sob o cursor (menu de contexto) | — | ⬜ | P2 |
| Hit test e alças que respeitam rotação | Pela caixa | ⬜ | P2 |
| Passo de nudge configurável | Setas 1px, Shift 10px | 🟡 | P3 |
| Conta-gotas (amostrar cor do canvas) | — | ⬜ | P2 |
| Duplicar arrastando com modificador | `Ctrl+D` duplica | 🟡 | P3 |
| Esconder a UI (modo foco), atalho de renomear, recolher a árvore | Duplo clique numa camada ou no título de um frame no canvas renomeia no lugar (`Enter` confirma, `Esc` cancela, dá para desfazer) (2026-11-21); a árvore de camadas recolhe; sem modo foco | 🟡 | P3 |

## C. Estilo

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Fill, borda, sombra, opacidade, rotação | Campos base | ✅ | — |
| Várias sombras, sombra interna, outline | Uma `shadow`, sem outline | 🟡 | P2 |
| Filtros CSS (blur, saturate, grayscale, brightness, sepia, invert, hue-rotate) e backdrop filters | — | ⬜ | P2 |
| Gradientes estruturados (linear, radial, cônico) com alças e ângulo no canvas | Só string CSS; o lint ignora | 🟡 | P2 |
| Cor moderna: `oklch()`, `color-mix()`, Display P3, seletor OKLCH | As strings passam para o CSS, mas o lint não entende e o seletor é hex sRGB | 🟡 | P2 |
| Modos de mesclagem (blend modes) | — | ⬜ | P3 |
| Painel de cores da seleção (todas as cores usadas) | — | ⬜ | P3 |

## D. Tipografia

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Família, tamanho, peso, altura de linha, espaçamento, alinhamento | Nó `text` | ✅ | — |
| Rich text (estilo por caractere/palavra, editável por agentes) | Um estilo por nó | ⬜ | P2 |
| Tokens de fonte (família, peso, tamanho, altura de linha, espaçamento) | Só tokens de tamanho | 🟡 | P2 |
| Eixos de fontes variáveis e recursos OpenType | — | ⬜ | P3 |
| Atalhos de texto (negrito, itálico, passos de tamanho/peso), altura de linha automática | — | ⬜ | P3 |
| CJK sem quebra de palavra, diacríticos combinados, emoji com vários codepoints | Padrão do navegador | 🟡 | P3 |

## E. Tokens e temas

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Tokens globais (`$nome`) para cores e tamanhos, definidos por agentes | `set_tokens` | ✅ | — |
| Modos de tema (claro/escuro/compacto) e coleções de tokens | `document.modes` + `set_tokens` com `mode`, inspector (2026-11-21), persistidos no SQLite (2026-11-22); ainda sem coleções nomeadas | 🟡 | P2 |
| Override de tokens por frame | `mode` num frame ou página aplica um modo ao subtree (2026-11-21) | ✅ | — |
| Tokens exportados como variáveis CSS no export HTML/React | `export_code` com `cssVariables` (2026-11-21): `:root` mais regras `[data-paprika-mode]`; o React exporta `tokensCss` | ✅ | — |
| Tokens tipados (cor, raio, espaçamento, fonte…) com validação | String/número sem tipo | 🟡 | P2 |
| Desvincular um token de um nó | Edição manual | 🟡 | P2 |
| Gerar tokens a partir de uma codebase via MCP | — | ⬜ | P2 |
| Tokens com `calc()` / `color-mix()` | Só cadeias de tokens | ⬜ | P3 |
| Copiar tokens entre arquivos | — | ⬜ | P3 |

## F. Vetor

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Nó vetorial a partir de dados de caminho SVG (retas, bezier, arcos) | Nó `path`, `path_info` | ✅ | — |
| Caneta para criar paths | `P`, alças bezier, fecha no primeiro vértice | ✅ | — |
| Editar pontos e alças de um path existente | Duplo clique no vetor: arrastar pontos e alças, adicionar, remover, canto/suave (2026-11-21); `d` no inspector | ✅ | — |
| Importar/colar SVG como camadas `path` editáveis | `import_svg`, `Ctrl+V` no canvas (2026-11-21): paths, formas (rect/ellipse alinhados aos eixos ficam nativos), grupos, transforms, pintura herdada; sem texto, imagens, gradientes ou CSS de `<style>` | ✅ | — |
| Operações booleanas (união, subtração, interseção, exclusão) | — (fb#1) | ⬜ | P2 |
| Converter rect/ellipse em path | — | ⬜ | P2 |
| Snapping e guias para pontos, snapping a meio pixel | — | ⬜ | P3 |
| Espelhar, repetir, shape builder, vector networks | — | ⬜ | P3 |

## G. Colar e importar

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Colar HTML com estilos inline como nós (inverso do `nodeStyle`) | `import_html`, `Ctrl+V` (2026-11-21): o HTML do próprio Paprika volta igual; outro HTML é aproximado (flex → row/column, blocos → column); classes e folhas de estilo não são aplicadas | ✅ | — |
| Colar SVG | `Ctrl+V` com marcação SVG (ver F) | ✅ | — |
| Colar ou soltar imagens (guardadas como data URI ou asset local) | Nó `image` só pelo MCP | 🟡 | P2 |
| Capturar um elemento de qualquer página web como nós (extensão de navegador) | — | ⬜ | P3 |
| Importar da área de transferência de outras ferramentas de design | — | ⬜ | Fora |

## H. Componentes e reuso

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Componentes e instâncias com overrides e `scale` | `component`/`instanceOf`/`scale`/`overrides` em frames, `create_component`, `create_instance`, `detach_instance` (2026-11-21); ainda sem instâncias aninhadas | ✅ | — |
| Props e slots de componentes | — | ⬜ | P2 |
| Componentes de código (renderizar componentes reais do repositório do usuário) | — | ⬜ | P3 |
| Pacotes de ícones / kits de UI iniciais | — | ⬜ | P3 |

## I. Camada de agentes (MCP e CLI)

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Servidor MCP embutido (stdio + HTTP), leitura e escrita, CLI | `paprika serve`/`mcp`, 23 ferramentas | ✅ | — |
| Leituras econômicas em tokens | `get_document_outline` | ✅ | — |
| Resultados estruturados (`outputSchema` + `structuredContent`) | Toda ferramenta que responde JSON declara `outputSchema` e devolve `structuredContent` (2026-11-21) | ✅ | — |
| Guia e erros em inglês (pt-BR opcional) | Guia, descrições das ferramentas, erros, avisos e lint em inglês; `get_design_guide {language: "pt-BR"}` (2026-11-21). A interface do canvas segue em pt-BR | ✅ | — |
| Agrupar várias escritas num só passo de desfazer | `batch` em toda ferramenta de escrita (2026-11-21) | ✅ | — |
| Nome do ator vindo do `clientInfo` do MCP | `agent:<clientInfo.name>` no stdio e no HTTP (o id de sessão guarda o nome) (2026-11-21) | ✅ | — |
| Presença do agente no canvas (cursor, o que está editando) | Cursor, contorno, nome e cor próprios por sessão de agente, lista de presentes; implícita em toda chamada de ferramenta (2026-11-21) | ✅ | — |
| Comentários para humanos e agentes (criar, resolver, filtrar) | Só o campo `notes` | 🟡 | P2 |
| Gerenciar arquivos pelo MCP (listar, criar, abrir, renomear, arquivar), vários ao mesmo tempo | Um arquivo por processo | ⬜ | P2 |
| Painel "conectar seu agente" com configs prontas por cliente | Trechos no README | 🟡 | P2 |
| Ajuda geométrica para agentes (bounds rotacionados, origem, lint geométrico) | Só `path_info` (fb#2, fb#6) | 🟡 | P2 |
| Diff visual entre versões (para CI) | — | ⬜ | P3 |
| MCP remoto (servidor fora da máquina do usuário) | Local por decisão | ⬜ | Fora |

## J. Export e handoff

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| HTML autocontido, React (estilos inline), PNG | `export_code`, `render_screenshot` | ✅ | — |
| Export SVG (frame ou seleção) | `export_code` formato `svg`, `⇩` na barra, `GET /api/svg` (2026-11-21): layout e linhas de texto medidos num Chromium headless; gradientes e imagens de fundo ficam de fora | ✅ | — |
| Export com classes Tailwind | — | ⬜ | P2 |
| WebP/AVIF, PDF (frames individuais ou combinados) | — | ⬜ | P2 |
| React + CSS module / variáveis CSS | — (ver E) | ⬜ | P2 |
| Export em vídeo de frames animados | — | ⬜ | P3 |

## K. Recursos generativos no canvas

Posição do Paprika: quem gera é o agente conectado, pelo MCP. Assim a ferramenta não depende de modelo nem precisa de chaves de API.

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Gerar SVG/vetor a partir de um prompt | O agente escreve nós `path` | 🟡 | P3 |
| Gerar ou editar imagens a partir de um prompt | — | ⬜ | P3 |
| "Remix" de uma seleção (variações, paletas, pares de fontes) | — | ⬜ | P3 |
| Embeds (Lottie, Rive, vídeo) | — | ⬜ | P3 |

## L. Efeitos e shaders

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Camadas de efeito procedurais (mesh gradient, ruído, grão, dithering, halftone, warp) | — | ⬜ | P3 |
| Filtros de imagem (textura, vidro, distorção) | — | ⬜ | P3 |

Decisão pendente: escrever efeitos próprios (WebGL/WebGPU, ligado à avaliação WASM) em vez de embutir pacotes de shaders de terceiros, para manter a regra de originalidade simples. Só reaproveitar um pacote open source depois de checar a licença e com o nome dele.

## M. Arquivos e colaboração

| Capacidade | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Workspace com vários arquivos, pastas, miniaturas | Página de workspaces em `/` (2026-11-21): listar, criar, abrir, renomear, excluir; um workspace ativo compartilhado por canvas e agentes (`list_workspaces`, `open_workspace`, `create_workspace`, `rename_workspace`, `delete_workspace`), imagem de capa por card (upload ou `set_workspace_cover` a partir de um frame). Ainda sem pastas | 🟡 | P2 |
| Abas para arquivos abertos | — | ⬜ | P3 |
| Dados ao vivo no design (buscar de uma API ou planilha) | — | ⬜ | P3 |
| Edição multiusuário em tempo real (CRDT) | Sincronização de time peer to peer: sidecar Iroh + Loro, `paprika serve --team`, operações assinadas, convites que expiram (ADR 0004, PRs #61–#69); remover membro e trocar chave (2026-11-22); modo time no Compose (`compose.team.yaml`). Falta: sair por conta própria, papéis de aprovação | 🟡 | P2 |
| Painel de scripts / plugins | — | ⬜ | P3 |
| Configurações de compartilhamento, SSO, organizações, CDN de assets, planos e cotas | — | — | Fora |

## N. Saúde do código (SonarCloud)

Issues abertas do SonarCloud importadas em 2026-11-21 (projeto `leonardo-moraes360_paprika`; filtro: Segurança + Confiabilidade, impacto Blocker/High/Medium, status Open/Confirmed; código em `main` 21841f7). 40 issues, nenhuma Blocker. Corrigir no código; não mudar o status das issues à mão no SonarCloud.

Atualização 2026-11-22: todas as issues abaixo estão corrigidas no código (commits `fix(sonar)` na `main`, mais S7773 em `packages/core` e S2077 em `store.go` na segunda leva do backlog). O SonarCloud as fecha na próxima análise da `main`.


| Regra | Impacto | Onde | Correção | Status | Pri. |
|---|---|---|---|---|---|
| S8707 path traversal por argumento de CLI (3) | Segurança High | `bench/tasks/lib.mjs:17` (`packages/server/scripts/bezier-demo.mjs:8, 31` saiu junto com o servidor TypeScript) | Resolver o caminho e exigir que fique dentro de `process.cwd()` antes de ler, `rm` ou gravar | ✅ | — |
| S6506 HTTPS não forçado em redirect (2) | Segurança Medium | `.github/workflows/ci.yml:377`; `.github/actions/setup-rust-wasm/action.yml:23` | `curl --proto '=https' --proto-redir '=https'` (o sha256 continua) | ✅ | — |
| S2077 SQL montado dinamicamente (1) | Segurança Medium | `server-go/internal/server/store.go:332` | Nomes de tabela vêm de lista fixa (provável falso positivo); escrever os três `DELETE` literais | ✅ | — |
| S7688 `[` em vez de `[[` (10) | Confiabilidade High | `.claude/hooks/session-start.sh:27, 34, 43, 46, 68, 80 (×2), 98 (×3)` | Usar `[[ … ]]` (o script é bash) | ✅ | — |
| S2871 `sort()` sem comparador (1) | Confiabilidade High | `.github/scripts/check-actions-pinned.mjs:105` | Comparador explícito por code point, mantendo a ordem atual | ✅ | — |
| S8786 regex com backtracking super-linear (3) | Confiabilidade Medium | `apps/site/scripts/build.mjs:287`; `apps/web/src/Inspector.tsx:380`; `.github/scripts/check-actions-pinned.mjs:27` | Remover quantificadores adjacentes ambíguos (ex.: `/^# +(\S.*)$/m`) e cobrir com teste | ✅ | — |
| S7773 `parseInt`/`parseFloat`/`isNaN` globais (10) | Confiabilidade Medium | `bench/tasks/lib.mjs:126 (×4)`; `packages/core/src/lint.ts:26, 31 (×2), 121`; `apps/web/src/Inspector.tsx:373, 383` | `Number.parseInt` / `Number.parseFloat` / `Number.isNaN` | ✅ | — |
| S9383 promises sem tratamento (5) | Confiabilidade Medium | `experiments/canvas-wasm/bench/webgpu-canvas-probe.cjs:4, 11`; `main.ts:177`; `run.cjs:12`; `gpu-readback-check.cjs:7` | `.catch()` que loga e sai com 1 (ou excluir `experiments/` da análise) | ✅ | — |
| S6848 elemento interativo não nativo (1) | Confiabilidade Medium | `apps/web/src/Layers.tsx:32` | `role`, `tabIndex={0}` e Enter/Espaço no `onKeyDown`, ou um `<button>` | ✅ | — |
| S9379 `autoFocus` (1) | Confiabilidade Medium | `apps/web/src/Pages.tsx:54` | Focar via `ref` + `useEffect` ao entrar em edição | ✅ | — |
| S3923 ternário com ramos iguais (1) | Confiabilidade Medium | `apps/site/scripts/draw-landing.mjs:161` | Usar `"link:./"` direto | ✅ | — |
| Input sem label (2) | Confiabilidade Medium | `experiments/canvas-wasm/bench/index.html:16, 17` | `<label for>` ou `aria-label` | ✅ | — |

## O. Diagramas

Diagramas simples (fluxogramas, esboços de arquitetura, mapas mentais) desenhados pela pessoa no canvas ou por um agente via MCP. Excalidraw e Whimsical servem só de referência do tipo de recurso; a aparência segue o tema do próprio Paprika.

| Recurso | Paprika hoje | Status | Pri. |
|---|---|---|---|
| Formas com texto dentro (caixa, elipse, losango) e notas adesivas | Nó `shape`, ferramentas `S`/`D`/`N`, texto editado no lugar (2026-11-21) | ✅ | — |
| Setas que prendem nas formas e as acompanham, retas ou em cotovelo | Nó `connector`, ferramenta `A`, geometria derivada das pontas (2026-11-21) | ✅ | — |
| Agente desenha um diagrama inteiro numa chamada, com layout automático | `draw_diagram` (2026-11-21) | ✅ | — |
| Rótulos nas setas | `label` no `connector` e nas arestas do `draw_diagram`, desenhado no meio da linha com halo, editável no inspector (2026-11-22, fb#57) | ✅ | — |
| Setas que desviam de outras formas | A rota em cotovelo ignora obstáculos | ⬜ | P2 |
| Setas curvas e mais formas (cilindro, paralelogramo, nuvem) | — | ⬜ | P2 |
| Prender ou soltar a ponta de uma seta arrastando no canvas | Só pelo inspector | ⬜ | P2 |
| Estilo desenhado à mão | — | ⬜ | P3 |

## P. Pedidos do mantenedor (2026-11-22)

Adicionados pelo mantenedor em 2026-11-22, para planejar depois (não iniciados). As restrições de cada linha fazem parte do pedido.

| Capacidade | Restrições e notas | Status | Pri. |
|---|---|---|---|
| Exportar em PDF, HTML, CSS (Tailwind ou CSS Modules), React, Angular ou Svelte | Incluir nas ferramentas de MCP. Amplia J (hoje: HTML, React com estilos inline, SVG) | ⬜ | a definir |
| Exportar SVG, PNG, JPEG, AVIF, WebP | Incluir nas ferramentas de MCP. **Não utilizar Chromium headless**: incluir no canvas (TS) ou no servidor Go. Hoje SVG e PNG passam pelo Chromium headless (J) | ⬜ | a definir |
| Redimensionar imagens para semi HD, HD, 2K, 4K | Incluir nas ferramentas de MCP. **Não utilizar Chromium headless**: incluir no canvas (TS) ou no servidor Go | ⬜ | a definir |
| Transformar o uso do atributo `title` em tooltips acessíveis | Continua a revisão de acessibilidade ([thread "Revisar acessibilidade do Paprika"](https://claude.ai/code/project/chan_01QGCFibNVKw2MsxBcqe4Jmi?thread=cmsg_01QGCFibNVKw2MsxBcqe4Jmi1MtFJYQ4HiNMD17jXKGUrG), PR #70) | ⬜ | a definir |
| Menus laterais colapsam num botão flutuante ao passar do mínimo de compressão | Canto superior esquerdo ou direito; para expandir o menu, clicar no botão correspondente | ⬜ | a definir |
| Migrar para componentes shadcn | Manter o tema próprio do Paprika (ADR 0003, Tailwind sem Preflight) | ⬜ | a definir |
| Melhorar as animações dos elementos em tela com tailwind-animate | — | ⬜ | a definir |
| Color picker customizado | Hoje o inspector usa o seletor de cor nativo | ⬜ | a definir |
| Comprimir melhor a informação do inspector | Hoje é uma área de rolagem gigantesca com muita informação | ⬜ | a definir |
| Melhorar visualmente o histórico de atividade | Hoje é um aglomerado de informação mal formatada | ⬜ | a definir |
| Controle de ordem das camadas: enviar ao fundo ou trazer à frente de forma arbitrária | Atalhos como Page Up / Page Down, e também via MCP. Hoje só `move_nodes` com `index`, sem atalho no canvas (ver A, "Ordem Z") | ⬜ | a definir |
| Componentes reutilizáveis entre páginas e entre workspaces | Hoje `component`/`instanceOf` só funcionam dentro de um documento (H); falta: biblioteca compartilhada entre workspaces, instância que aponta para outro workspace e como as atualizações chegam até ela | ⬜ | a definir |
| Chat de LLM multiplayer no canvas | Flutuante, centralizado na parte inferior do canvas; compartilhado pelas pessoas (e agentes) do workspace | ⬜ | a definir |
| Bug: não dá para renomear a primeira página de um workspace quando ela é a única | Causa encontrada: workspace sem páginas mostra uma linha "Página 1" de placeholder (`apps/web/src/Pages.tsx`) que não é um nó de página de verdade, então o duplo clique não faz nada; renomear deveria criar a página e dar o nome | ⬜ | a definir |
| Ações destrutivas | Variante de botão danger (e padrão de confirmação) para excluir/remover; hoje tudo usa o botão primário da marca | ⬜ | a definir |
| Design system como conceito no canvas | Um lugar para tokens, componentes e regras do workspace, de onde agentes e pessoas desenham (relaciona com E e H) | ⬜ | a definir |
| Verificação adversarial assistida no canvas | Portar para Rust ou Go. Provar com números que cada tela da app bate com o board aprovado, claro e escuro: um gerador ajusta a app até a semelhança de pixels chegar a ≥ 95 % por tela e modo, e um discriminador independente refaz build, referências, capturas e comparação e reprova por nota, trapaça (referência alterada, máscara sem razão, comparador mexido), regressão ou contraste; no máximo 3 rodadas, depois decide um humano. Peças a portar: comparador (pixelmatch, threshold 0.1, preenchimento magenta quando o tamanho difere, máscaras com razão), referências renderizadas dos boards, captura, gate de contraste, guarda contra trapaça. Especificação enviada pelo mantenedor (harness TS/Playwright de outro projeto) | ⬜ | a definir |
| Importar PNG, JPEG, WebP, AVIF, GIF, `.fig` e outros formatos, além de SVG e HTML | Incluir nas ferramentas de MCP. Amplia G: hoje só SVG e HTML são importados (`import_svg`/`import_html`, `Ctrl+V`) e o nó `image` só é criado pelo MCP (G, "Colar ou soltar imagens"). Arquivos raster viram nós `image` (data URI ou asset local; decidir se GIF animado continua animado). Soltar arquivos no canvas está na próxima linha. **`.fig` precisa de decisão**: é um formato proprietário sem documentação, e lê-lo direto seria engenharia reversa, que a regra de originalidade proíbe; as opções são um caminho documentado (a API pública do fornecedor ou os exports SVG/PDF dele) ou deixar de fora, como G já faz com a área de transferência de outras ferramentas. O "etc." do pedido: outros formatos (ex.: PDF) a listar no planejamento | ⬜ | a definir |
| Drag and drop dos elementos no canvas | Leitura registrada em 2026-11-22 (o pedido diz só "drag and drop dos elementos dentro do canvas"): (1) arrastar um nó para movê-lo **e trocar o pai**: soltar dentro de um frame ou grupo, ou sobre outra camada, faz dele o novo pai, e dentro de um frame com auto layout o ponto de soltura escolhe a posição entre os filhos; (2) soltar arquivos externos (imagens, SVG, HTML) do sistema no canvas, usando a linha de importação acima. Hoje arrastar só move nós com posição absoluta dentro do pai atual (`update` de x/y); filhos de frame com auto layout não arrastam, nada troca de pai, o painel de camadas não tem arraste e só a capa do workspace aceita arquivo solto (página de workspaces). O MCP já troca o pai com `move_nodes` (`parentId`, `index`). Relaciona com A "Ordem Z", B "Duplicar arrastando com modificador", O "Prender ou soltar a ponta de uma seta arrastando" e a linha de ordem das camadas acima | ⬜ | a definir |

<details><summary>Pedido original (texto do mantenedor)</summary>

- Adicionar suporte para exportar em pdf, html, css (tailwind ou css modules), react, angular ou svelt. Incluir nas ferramentas de mcp.
- permitir exportar svg, png, jpeg, avif, webp. Incluir nas ferramentas de mcp. Não utilizar chromium headless, incluir no canvas (ts) ou no servidor go.
- Permitir redimensionar imagens para semi hd, hd 2k, 4k. Incluir nas ferramentas de mcp. Não utilizar chromium headless, incluir no canvas (ts) ou no servidor go.
- transforma uso do atributo tittle em tooltips acessíveis.
- fazer com que ao ir além do mínimo de compressão dos menus laterais no canvas, eles colapsem em um botão flutuante (canto superior esquerdo ou direito). Para expandir o menu em questão deve-se clicar no botão correspondente.
- migrar para componentes shadcn.
- melhorar animações dos elementos em tela com tailwind-animate.
- adicionar color picker customizado.
- comprimir melhor informação do `inspector`, hoje ele é uma scroll área gigantesca com muita informação.
- melhorar visualmente histórico de atividade, hoje ele é um aglomerado de informaçao mal formatada.
- adicionar controle de background e foreground nas camadas, permitindo enviar uma camada para background ou trazer para foreground de forma arbitrária. Utilizando por exemplo page up ou page down.
- capacidade de criar componentes reutilizáveis entre páginas ou workspaces no canvas.
- introduzir no canvas o conceito de chat de llm multiplayer, parte inferior, centralizado e flutuante
- não consigo renomear primeira página criada em um workspace, que não tem segunda página
- adicionar conceito de destructive actions, hoje tudo usa o botão brand primary
- introduzir no canvas o conceito de design system
- embutir no canvas conceito de verificação adversarial assistida, portar o código para rust ou go.
- Tornar possível importar, além de svg e html, outros formatos como png, jpeg, webp, avif, gif, fig, etc.
- Permitir fazer drag and drop dos elementos dentro do canvas.

</details>
