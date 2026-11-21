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

## O que funcionou bem

- `create_nodes` aninhado montou uma proposta inteira (≈60 nós) numa chamada, de forma atômica.
- O contraste do `lint_design` guiou a escolha de tokens (`brand.dark` para texto branco em botões).
- `get_document_outline` com `depth: 0` bastou para confirmar o resultado gastando pouco.
- Um só motor de estilo: os screenshots que o agente conferiu saem do mesmo `nodeStyle` do canvas.
