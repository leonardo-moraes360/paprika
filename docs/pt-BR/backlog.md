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
| Modos de tema (claro/escuro/compacto) e coleções de tokens | `document.modes` + `set_tokens` com `mode`, inspector (2026-11-21); ainda sem coleções nomeadas | 🟡 | P2 |
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
| Presença do agente no canvas (cursor, o que está editando) | Destaque + lista de atividade | 🟡 | P2 |
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
| Workspace com vários arquivos, pastas, miniaturas | Um arquivo por `serve` | ⬜ | P2 |
| Abas para arquivos abertos | — | ⬜ | P3 |
| Dados ao vivo no design (buscar de uma API ou planilha) | — | ⬜ | P3 |
| Edição multiusuário em tempo real (CRDT) | Um escritor + watcher | ⬜ | P3 |
| Painel de scripts / plugins | — | ⬜ | P3 |
| Configurações de compartilhamento, SSO, organizações, CDN de assets, planos e cotas | — | — | Fora |
