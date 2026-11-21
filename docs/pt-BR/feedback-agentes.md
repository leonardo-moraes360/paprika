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
| 4 | 5 temas lado a lado | Tokens são globais; foi preciso prefixar à mão (`p1.brand` … `p5.brand`) e reescrever em cada nó | Coleções/modos de tokens e override de tokens por frame | P2 |
| 5 | Conferir o resultado na máquina do usuário | `render_screenshot` falhou: o Playwright 1.63 exige o Chromium 1243 e só havia o 1228 | Detectar o browser ausente ao iniciar, devolver o comando exato de correção no erro e cair para renderização via aba do canvas aberta | P1 |
| 6 | Pegar erro visual sem screenshot | `lint_design` passou com o cálice solto da vagem | Lint geométrico: filhos que não tocam nenhum irmão, quase-encostos (< 4px), formas totalmente encobertas | P2 |
| 7 | Ler resultados estruturados | As ferramentas devolvem JSON como texto; o agente precisa parsear string | Declarar `outputSchema` e devolver `structuredContent` | P2 |
| 8 | Wrappers de layout sem recorte | Todo frame wrapper precisou de `clip: false` e `fill: "transparent"` | Nó `group`, ou `clip: false` por padrão em frame com layout automático | P3 |
| 9 | Lint menos ruidoso | 21 infos de `raw-color` para literais intencionais (alças brancas, texto preto em botões) | `lintIgnore: ["raw-color"]` por nó e parâmetro `minSeverity` | P3 |
| 10 | Saber quem fez o quê | O nome do ator vem do User-Agent HTTP (`node`, `brand-agent`), não do cliente MCP | Usar `clientInfo.name` do MCP como ator | P3 |
| 11 | Um desfazer para "desenhar proposta 3" | 7 entradas no histórico para uma execução do script (nome, tokens, 5 criações) | `begin_transaction`/`commit` ou um rótulo de grupo para mesclar entradas | P3 |
| 12 | Idioma para agentes | Guia e erros em português; prompts em inglês misturam idiomas | Guia e erros em inglês, com pt-BR como opção | P2 |
| 13 | Vários quadros | Tudo divide um canvas só; as propostas foram empilhadas à mão com `y` fixo | Páginas e `layout` na raiz do canvas (empilhar frames de topo) | P3 |
| 14 | Ver o agente desenhar depois que o servidor trocou de arquivo | A aba aberta reconectou no documento novo mas manteve zoom/pan antigos; os quadros novos podiam ficar fora da tela (corrigido: o canvas reenquadra quando o id do documento muda) | Feito nesta mudança | — |

## 2026-11-21: curvas bezier (nó `path`, caneta, `path_info`)

Tarefa: adicionar curvas bezier para agentes e humanos desenharem formas orgânicas e redesenhar a páprica só com paths (`packages/server/scripts/bezier-demo.mjs`).

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 15 | Caixa do nó igual ao desenho | Sem `width`/`height`, a caixa vai da origem do nó até a borda da curva; um `d` que começa em (40,30) deixa espaço vazio no canto e o lint de overflow mede essa caixa | `normalize: true` no create (leva o desenho para 0,0 e ajusta `x`/`y`), ou informar a folga no `path_info` | P2 |
| 16 | Camadas de vários paths como uma forma (corpo, sombra, brilho, cálice) | Cada parte repete o mesmo `x`/`y`; mover a pimenta é mover 5 nós | Nó `group` (ver #8) ou lista `paths: []` num nó só | P2 |
| 17 | Editar um ponto de controle | Mudar uma curva exige reescrever a string `d` inteira | `update_path_points` (mover âncora/alça por índice) e edição de alças no canvas | P3 |
| 18 | Saber o tamanho desenhado antes de posicionar uma parte | `path_info` com `canvasBounds` respondeu numa chamada só; também pegou um erro de digitação (`d inválido: número esperado na posição 12`) | Manter: erros de parse com posição em todo campo string | — |

## 2026-11-21: servidor em Go com SQLite (`server-go/`)

Tarefa: reimplementar o servidor em Go com o mesmo contrato, guardando os dados em SQLite.

| # | Precisava | O que aconteceu | Proposta | Pri. |
|---|-----------|-----------------|----------|------|
| 19 | Saber o que o servidor promete aos agentes | A lista de ferramentas e as instruções só existiam como código TypeScript; uma segunda implementação divergiria | Feito: `server-go/scripts/gen-contract.mjs` extrai `tools/list` e as instruções para `server-go/contract/mcp.json`, e a suíte de paridade confere que os dois servidores devolvem o mesmo contrato | — |
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

## O que funcionou bem

- `create_nodes` aninhado montou uma proposta inteira (≈60 nós) numa chamada, de forma atômica.
- O contraste do `lint_design` guiou a escolha de tokens (`brand.dark` para texto branco em botões).
- `get_document_outline` com `depth: 0` bastou para confirmar o resultado gastando pouco.
- O `lint_design` pegou toda cor literal da landing page (`raw-color`), o que gerou o token `on.brand`.
- Um só motor de estilo: os screenshots que o agente conferiu saem do mesmo `nodeStyle` do canvas.
