# Estudo de MCP de agente: Paper Desktop 0.5.19

Notas do estudo da superfície de agente de uma ferramenta fechada de design, guardadas como insumo para
o MCP do Paprika e para o ciclo de desenho das [folhas de design](../folhas-de-design.md). O runbook de
operação completo (61 KB, detalhe chamada a chamada) fica com o mantenedor em `paper-mcp-runbook-guia.md`.

**O que foi estudado.** `paper-desktop-0.5.19x86_64.AppImage` (sha256 `60a65462…`, Electron 44.9.3,
`app.asar` sha256 `ceadcb0d…`), sem assinatura. Método: desmontagem estática do pacote e depois execução
com conta logada, dirigindo o MCP local (`http://127.0.0.1:29979/mcp`) para construir telas reais — uma
folha de sistema de design, uma landing page e um login (604 nós, 27 tokens). Os números vêm daquela
sessão (2026-11-24), medidos ou citados, não inferidos.

## O que eles fazem bem e o Paprika deveria copiar

| # | Observação no Paper | Por que importa | Paprika hoje |
|---|---------------------|-----------------|--------------|
| 1 | Todas as 41 ferramentas têm anotações: **21** `readOnlyHint`, **19** `destructiveHint` e `delete_nodes` com `destructiveHint` e `consequentialHint` | Clientes usam essas flags para exigir aprovação; sem elas quem decide o que é perigoso é o chute do agente | 21 de 63 ferramentas anotadas (16 `readOnlyHint`, 2 `destructiveHint`, 1 `idempotentHint`); **42 sem nenhuma**, incluindo `create_nodes`, `update_nodes`, `import_document`, `undo` |
| 2 | As instruções do `initialize` embutem o fluxo inteiro: ler o guia, ver o resumo do documento, pedir o brief, consultar fontes, escrever um grupo visual por chamada, screenshot depois de cada seção | A orientação viaja com o servidor, então qualquer cliente se comporta igual | `get_design_guide` existe; o ciclo está em `AGENTS.md` e nos docs humanos, não nas instruções do servidor |
| 3 | As descrições dizem "escreva incrementalmente, o usuário vê você escrever em tempo real" e nomeiam os critérios de revisão (espaçamento, tipografia, contraste, alinhamento, ajuste ao frame, repetição) | Transforma "revise seu trabalho" em algo que o modelo executa | `lint_design` e a verificação visual cobrem a parte mecânica; a passada dos seis critérios não está escrita |
| 4 | Todo resultado de mutação devolve um `contentHash` por domínio (tokens, nós, …) | Mantém sessões longas dentro do orçamento de contexto | `get_document_outline` devolve versão; não há token de mudança por domínio |
| 5 | Todo resultado vem em dois content blocks (metadados de estado, depois o payload), e alguns payloads são texto cru (CSS, JSX), não JSON | Um cliente que lê só o primeiro bloco, ou que trata todo payload como JSON, perde o resultado sem perceber | O Paprika devolve um bloco só; manter simples e documentar |
| 6 | A cota aparece como erro na resposta: `Weekly MCP limit reached. It resets in 3 days.` — e alcança screenshot, export e leitura de código, não só escrita | Quem não orça chamadas perde trabalho no meio da tela | O Paprika não tem cota hoje; se aparecer, dizer quais ferramentas contam |
| 7 | Estado assíncrono no nó (`imageGeneration.status`: `processing` → `ready`/`error`) com aviso explícito de que screenshot e export não esperam | Evita o bug "o render saiu em branco" | `import_image` e `place_reference` são síncronos hoje; manter, mas dizer |
| 8 | Criação de tokens tem ordem (semânticos antes da paleta; menores primeiro nos tipos numéricos) | Gera sistemas consistentes em vez de cores avulsas | `set_tokens` aceita qualquer coisa; o guia poderia trazer a mesma ordem |

## Onde o Paprika já está à frente

A mesma sessão esbarrou em limites que o Paprika não tem:

- **Sem componente nem instância no MCP do Paper** (41 ferramentas, nenhuma de símbolo, variante ou
  biblioteca): reuso é token + clone (`duplicate_nodes`, `<x-paper-clone>`), e estados como hover viram
  frames separados. O Paprika tem `create_component`, `create_instance`, `detach_instance` e
  `detach_tokens` com overrides por instância.
- **Sem undo no MCP do Paper.** O Paprika expõe `undo`, `redo`, `get_history`, e cada mutação é um passo.
- **Sem importação de documento no MCP do Paper** (HTML é a única entrada). O Paprika tem `import_html`,
  `import_document` (`.paprika.json`), `import_svg`, `import_image`.
- **Vetor e layout**: `path_info`, `edit_path`, `combine_paths`, `convert_to_path`,
  `round_path_corners`, `create_shape_path`, `align_nodes`, `distribute_nodes`, `wrap_nodes`,
  `layout.wrap` não têm par no Paper.
- **Mão humana e agente no mesmo canvas**: pinos com `claim_pin`, `reply_pin`, `resolve_pin`,
  `wait_for_pins` não existem no Paper.
- **Sem cota de uso** em servidor próprio, e screenshot/export são gratuitos.

## Padrões dos relatórios que a tabela acima deixou de fora

| # | Observação no Paper | Paprika hoje | Onde entra |
|---|---------------------|--------------|------------|
| 9 | Ferramentas de escrita marcam os frames tocados como "em edição" e uma chamada própria libera, com a recomendação de passar ids explícitos para vários agentes dividirem o arquivo | A presença (`internal/server/presence.go`) mostra a última ferramenta e os nós de cada agente e expira depois de um TTL; não há liberação explícita | Nova proposta 5 abaixo; estende o trabalho de presença viva, não a seção T |
| 10 | Mutações respondem com o que mudou, para o agente não reler: duplicar devolve o mapa origem → cópia de cada descendente, mover devolve a nova ordem de filhos de cada pai afetado | `duplicate_nodes` devolve `copies` e `map`; toda escrita devolve `version`; `move_nodes` não devolve a nova ordem dos pais | Nova proposta 6 abaixo |
| 11 | Estilo sem efeito não some calado: o resultado da escrita lista o que foi ignorado | Argumentos desconhecidos são ignorados sem aviso | Já está na seção T como PAP-A-007 (entradas estritas); sem item novo |
| 12 | Erros trazem um passo de recuperação ("tente mais uma vez, depois peça ao usuário para reiniciar a conexão MCP"), e uma rota errada responde com o endpoint certo | Erros são mensagens simples | Juntar ao PAP-A-007: cada erro nomeia o formato válido e o próximo passo |
| 13 | O MCP local valida `Host` contra DNS rebinding mas não tem credencial por cliente, então qualquer processo local chama ferramentas destrutivas | Mesma classe: `AllowedRequest` (`internal/server/http.go`) valida `Host` e `Origin`, e não há token | Nova proposta 7 abaixo (opcional, para o fluxo local sem configuração continuar funcionando) |
| 14 | O guia manda nunca mostrar ids crus de nó ao usuário, e ler valores do export de código em vez de screenshots | Não está escrito no guia | Juntar ao PAP-A-013 (guia aponta as ferramentas que os agentes perderam) |

## Propostas para o backlog

1. Anotar as 42 ferramentas que faltam em `server-go/contract/mcp.json` (`destructiveHint` em
   `delete_*`, `archive_workspace`, `move_workspace`, `import_document`; `idempotentHint` em `show_all`,
   `unlock_all`, `open_workspace`) e levar a coluna de anotações para as duas tabelas de ferramentas.
2. Colocar o ciclo de desenho nas instruções do `initialize` (ou no `get_design_guide`) em vez de só no
   `AGENTS.md`: um grupo visual por `create_nodes`, screenshot por tela, seis critérios nomeados, leitura
   estreita primeiro.
3. Devolver um token de mudança por domínio (`tokens`, `nodes`, `pages`) junto da versão do documento.
4. Escrever em `docs/mcp.md` a escada de leitura estreita (`get_document_outline` → `find_nodes` →
   `get_nodes` dos ids que interessam → `get_bounds`).

5. Deixar o agente liberar o que está editando: uma chamada opcional `release_nodes` (ou um `done: true` na última escrita) que limpa a presença naqueles ids na hora, sem esperar o TTL.
6. Devolver a nova ordem de filhos de cada pai afetado em `move_nodes`, `group_nodes` e `ungroup_nodes`, como `duplicate_nodes` já devolve o mapa de ids.
7. Oferecer um bearer token opcional para `/mcp` (`paprika serve --mcp-token`, ou um arquivo no diretório de dados), desligado por padrão em loopback e recomendado com `--host` ou `--team`.

Nada disso duplica a seção T do [backlog](../backlog.md) (PAP-A-005…020): as propostas 1–4 e 5–7 são novas, e os itens 11, 12 e 14 acima são notas para o PAP-A-007 e o PAP-A-013. As contagens de ferramentas são da `main` no momento da escrita; os PRs abertos que criam ferramentas (`analyze_image`, `trace_image`, `compare_reference`, `outline_stroke`, `repeat_nodes`) também chegam sem anotações, então a proposta 1 deve entrar depois deles ou anotá-los na mesma mudança.

## Limites deste estudo

Documenta um binário de terceiro em uma versão, a partir de uma conta autenticada, e a cota semanal de
MCP daquela conta esgotou antes das últimas telas — então os números daquelas telas são orçamento de
design, não medição. Nada aqui foi revalidado em versão posterior do Paper.
