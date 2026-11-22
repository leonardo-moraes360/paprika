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
| Ordem Z (avançar, recuar, frente, fundo) | `update_nodes`/`move_nodes` aceitam `index`: número a partir de 0, ou `front`/`back`/`forward`/`backward`, num único passo de desfazer (2026-11-22); sem atalhos no canvas (PAP-B-021) | 🟡 | P1 |
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
| Operações booleanas (união, subtração, interseção, exclusão) | — (fb#1, fb#76; ver Q) | ⬜ | P1 |
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
| Internacionalização (i18n) | Leitura registrada em 2026-11-22 (o pedido diz só "adicionar i18n"): traduzir a interface do app web, pelo menos inglês e pt-BR para acompanhar a documentação bilíngue, com um jeito de escolher o idioma. Hoje a interface do canvas, as mensagens da API HTTP e os nomes padrão ("Página 1") só existem em pt-BR (I, "Guia e erros em inglês"); o texto voltado a agentes é em inglês, com `get_design_guide {language: "pt-BR"}`, e o site já tem páginas em en e pt-BR. Em aberto no planejamento: se nomes padrão e mensagens da API seguem o idioma da interface, e quais outros idiomas vêm depois | ⬜ | a definir |
| Aviso de versão nova no app | Primeiro passo menor do pedido de OTA (combinado com o mantenedor em 2026-11-22). O app consulta as releases do GitHub e mostra "há uma versão nova" com o comando para atualizar (`git pull` + `docker compose up -d --build`). Precisa antes de releases publicadas: o repositório ainda não tem tags nem releases; `paprika --version` já informa `server.Version` | ⬜ | a definir |
| Checagem de versão entre peers do time | O risco real hoje: duas instâncias em versões diferentes podem divergir no CRDT ou nas operações assinadas. Os ALPNs do sidecar têm versão (`paprika/sync/1`, `paprika/join/1`), mas os peers não comparam a versão do app nem do formato do documento; a checagem deve avisar ou recusar a sincronização com um peer incompatível (M, "Edição multiusuário em tempo real", ADR 0004) | ⬜ | a definir |
| OTA update completo (download assinado, rollback) | Futuro, só quando existir binário standalone ou app desktop. No Docker, atualizar é trocar a imagem: um binário que se substitui dentro do container briga com isso e se perde no próximo `up --build`. Depende das duas linhas acima e de releases publicadas | ⬜ | a definir |
| Três estilos de traçado de seta: reto, arredondado, curva livre | Leitura registrada em 2026-11-22 (o screenshot do mantenedor mostra a seta em cotovelo de hoje): (1) reto, com cantos vivos, o que `route: "elbow"` desenha hoje (`route: "straight"` também existe); (2) arredondado, a mesma rota em cotovelo com cantos arredondados; (3) curva livre, uma bezier cuja alça se arrasta no canvas para dar forma. Também pelo MCP e no inspector. Detalha O "Setas curvas" e relaciona com O "Prender ou soltar a ponta de uma seta arrastando" e com a edição de pontos de F | ⬜ | a definir |
| Duplo clique na seta adiciona, edita ou remove o rótulo | Edição no lugar, no canvas, como o texto das formas (O). Hoje o `label` só é editado no inspector (O "Rótulos nas setas", PR #75); apagar o texto remove o rótulo | ⬜ | a definir |
| Arrastar a toolbar e ancorar na esquerda, no topo, na direita ou no fundo | Hoje a toolbar flutuante é fixa, centralizada no topo do canvas (`apps/web/src/App.tsx`). Nas laterais ela fica vertical; o lado escolhido é lembrado. Planejar junto com a linha dos menus laterais acima (colapsar num botão flutuante), para a toolbar e os painéis não disputarem a mesma borda | ⬜ | a definir |
| Alças de redimensionar nos quatro cantos | Hoje o nó selecionado tem uma só alça, no canto inferior direito (`apps/web/src/Canvas.tsx`, screenshot do mantenedor). Arrastar um canto mantém o canto oposto no lugar. Relaciona com B "Hit test e alças que respeitam rotação" | ⬜ | a definir |
| Atalhos para travar a proporção ao redimensionar, com indicação visual | Três travas: quadrada (1:1); retangular pelo comprimento; retangular pela altura. Teclas modificadoras como `Shift` ou `Ctrl` (o mapeamento exato fica para o planejamento); uma indicação no canvas mostra qual trava está ativa. Hoje o redimensionamento não aceita modificador nem trava proporção. "Pelo comprimento/pela altura" (mantenedor, 2026-11-22): manter a proporção atual com esse lado comandando e o outro acompanhando | ⬜ | a definir |
| Vários tipos de borda nos elementos | Hoje `stroke` é só `{color, width}` (`packages/core/src/schema.ts`) e o inspector mostra cor e espessura; só conectores têm `dashed`. Falta: estilos sólido, tracejado, pontilhado e parecidos (e, a decidir no planejamento, posição interna/centro/externa e borda por lado). Relaciona com C "Várias sombras, sombra interna, outline" | ⬜ | a definir |
| Triângulo como forma simples | Novo `ShapeKind` ao lado de `rect`, `ellipse`, `diamond`, `note` (O), com ferramenta na toolbar, no seletor de forma do inspector e pelo MCP (`draw_diagram` também) | ⬜ | a definir |
| Botões `+` e `−` em todos os campos puramente numéricos | Um stepper no inspector para campos como opacidade, peso, espessura de borda e posição; campos que aceitam tokens (`$nome`) ou texto continuam com input simples. Relaciona com B "Passo de nudge configurável" | ⬜ | a definir |
| Bug: campos numéricos aceitam texto não numérico | Screenshot do mantenedor: "Opacidade" mostra `1aaaaa`. Causa: `Field` com `type="number"` renderiza um `<input>` de texto só com `inputMode="decimal"` (`apps/web/src/Inspector.tsx`), e `setNum` descarta em silêncio o valor que não converte. Campos numéricos devem recusar o que não é número (e dizer por quê quando um valor colado é rejeitado) | ⬜ | a definir |
| Fontes do sistema em qualquer elemento com texto | Um seletor de fonte que lista as fontes instaladas na máquina (ex.: Local Font Access API, com lista de reserva) para `text`, `shape` e todo nó com `fontFamily`. Hoje `fontFamily` é um campo de texto livre. Relaciona com D "Tokens de fonte" | ⬜ | a definir |
| Importar e exportar fontes em vários formatos | Ex.: TTF, OTF, WOFF, WOFF2: fontes guardadas no workspace (como assets) e levadas nos exports (`@font-face` em HTML/CSS, embutidas em SVG/PDF). Também pelo MCP. Respeitar a licença de cada fonte ao embutir. Relaciona com J e com as linhas de export acima | ⬜ | a definir |

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
- adicionar i18n
- implementação de ota update? (registrado como aviso de versão nova + checagem de versão entre peers; OTA completo fica para depois)
- Adicionar 3 tipos de contorno de seta: reto (já existe), arredondado, arredondado livre (posso arrastar a curva, como se fosse uma bezier).
- Dois cliques na seta permite adicionar/editar/remover sua label.
- Permitir arrastar a toolbar e ancorar na esquerda, topo, direita e fundo.
- Quatro pontos no dragger de elemento.
- Atalhos de proporção: travar proporção quadrada; travar proporção retangular, no comprimento; travar proporção retangular, na altura; normalmente se usa ctrl ou shift para este tipo de atalho; incluir tip visual de qual proporção foi travada.
- Permitir múltiplos tipos de bordas para os elementos.
- Adicionar mais uma forma simples: triângulo.
- Adicionar + e - para todos os campos puramente númericos.
- Não permitir inserir nada que não sejam números em campos numéricos.
- Permitir usar fontes do sistema em qualquer elemento que contenha texto.
- Permitir importar ou exporta fontes em múltiplos formatos.

</details>

## Q. Do log de feedback dos agentes (2026-11-22)

Todo item ainda aberto no [log de feedback dos agentes](feedback-agentes.md) (fb#1 a fb#79), agrupado em trabalho de implementação. Cada linha diz qual feedback fecha; quando a linha for entregue, marque esses itens `fb#` como "Feito" no log. As prioridades vêm do log, elevadas onde vários agentes bateram no mesmo muro.

| Item de trabalho | O que construir | Feedback | Status | Pri. |
|---|---|---|---|---|
| Levar um quadro de um servidor Paprika para outro | `import_document` (entra um `.paprika.json`, sai um workspace novo, sem trocar o ativo); `paprika export --root <id>` de um frame; `create_nodes` ignora os campos derivados do connector em vez de recusar | fb#72, fb#75 | ⬜ | P1 |
| Geometria no core: caixas absolutas para agentes | Um `layout(doc)` no core que devolve caixas absolutas (port em Go preso às fixtures), uma ferramenta `get_bounds` com os cantos rotacionados, um campo `origin` e `normalize` ao criar path (ou o deslocamento no `path_info`); o export do core usa as mesmas caixas, então o SVG de nós com auto layout dispensa navegador | fb#2, fb#15, fb#26, fb#41 | ⬜ | P1 |
| Operações booleanas e recortes | `union`/`subtract`/`intersect`/`exclude` gerando um novo `path` (op no MCP + comando no canvas), ou `mask` em `group`; mesmo item de F "Operações booleanas" | fb#1, fb#76 | ⬜ | P1 |
| Decalcar uma imagem de referência | Colocar uma imagem (arquivo local ou data URL) como referência travada e semitransparente sob um frame; `render_screenshot` com uma imagem `compare` lado a lado | fb#78 | ⬜ | P2 |
| Lint que aponta o que importa | Agrupar o resultado do `lint_design` por regra (contagem + primeiros N ids), `minSeverity`, `lintIgnore` por nó; regras novas: filhos de row/column mais largos que o frame, geometria (irmãos que não se tocam, vãos abaixo de 4 px, formas totalmente escondidas) | fb#6, fb#9, fb#69, fb#70 | 🟡 | P2 |
| Agentes editam pontos de path | `edit_path` (índice da âncora + nova posição, alças) sobre os helpers do canvas, e âncoras listadas no `path_info` | fb#17, fb#43 | 🟡 | P2 |
| Duplicar com alterações | `duplicate_nodes` com `scale` e overrides (por exemplo `mode: "dark"` para um par claro/escuro) | fb#3, fb#45 | ⬜ | P2 |
| Trabalhar em outro workspace sem mover o humano | `workspace` opcional nas ferramentas de leitura (outline, nodes, screenshot); o id do workspace ativo na primeira linha do outline e nos resultados de escrita; um `History` por workspace durante a vida do processo | fb#52, fb#53, fb#54 | ⬜ | P2 |
| Ordem de camadas sem chamada extra | `index` ou `"front"`/`"back"` nas props do `update_nodes`; casa com P "Ordem das camadas" (atalhos no canvas) | fb#77 | ⬜ | P2 |
| Screenshots confiáveis para agentes | Detectar navegador ausente na inicialização e devolver o comando de correção; `path` opcional ou URL de download no `render_screenshot`; informar o renderizador ativo no hello do WebSocket e no outline (o screenshot continua no caminho HTML) | fb#5, fb#24, fb#27, fb#28, fb#79 | 🟡 | P2 |
| Exclusões mais seguras | `delete_workspace` em dois passos (a primeira chamada devolve o que seria perdido e um token); lixeira ou log de atividade para operações de workspace; aviso no canvas quando um agente apaga ou troca o workspace | fb#59, fb#60, fb#61 | ⬜ | P2 |
| Componentes aninhados | Instâncias dentro de componentes, overrides endereçados por caminho (`instancia/copia`) | fb#39 | ⬜ | P2 |
| Fidelidade de importação | `import_svg`: sprites `<use>`/`<symbol>` e `<text>` como nós `text`; `import_html`: opção que renderiza no Chromium do servidor e importa os estilos computados | fb#40, fb#42 | ⬜ | P2 |
| Semântica web no documento | `href` em frames e textos (exportado como `<a>`), raízes responsivas (`minWidth`/`maxWidth` ou variantes por breakpoint), imagens `decorative`, assets de imagem no nível do documento | fb#30, fb#31, fb#32, fb#33 | ⬜ | P2 |
| Roteamento de diagramas contornando formas | Rotas em cotovelo que evitam obstáculos, ou `relayout` no `draw_diagram` para ids existentes | fb#58 | ⬜ | P2 |
| Limpezas de contrato para a próxima versão incompatível | Texto e `structuredContent` como o mesmo objeto; `historyLabel` com `label` como alias; ids de sessão desconhecidos respondem 404 para o cliente reinicializar; um só nome de ator nos dois transportes | fb#22, fb#48, fb#50, fb#74 | 🟡 | P3 |
| Pequenas conveniências | `pageId` padrão no `create_nodes` (a página que o humano vê); tokens de tamanho tipados multiplicados por `scale`; `resolve` no `get_nodes`; `sql_query` somente leitura; batch aberto visível na lista de atividade; uma só língua na UI (ou configuração); capa ao vivo e capa no export; exemplos normalizados; paths editados como filhos "ignorar layout" (A) | fb#21, fb#23, fb#36, fb#38, fb#44, fb#46, fb#49, fb#51, fb#63, fb#64 | ⬜ | P3 |

Já cobertos por trabalho entregue, para marcar "Feito" no log: fb#8 e fb#16 (nó `group`), fb#13 (páginas; empilhar frames de topo automaticamente continua aberto, ver A).
