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
| 1 | Todas as 41 ferramentas têm anotações; **20** com `destructiveHint`, outras com `readOnlyHint`/`consequentialHint` | Clientes usam essas flags para exigir aprovação; sem elas quem decide o que é perigoso é o chute do agente | 21 de 63 ferramentas anotadas (16 `readOnlyHint`, 2 `destructiveHint`, 1 `idempotentHint`); **42 sem nenhuma**, incluindo `create_nodes`, `update_nodes`, `import_document`, `undo` |
| 2 | As instruções do `initialize` embutem o fluxo inteiro: ler o guia, ver o resumo do documento, pedir o brief, consultar fontes, escrever um grupo visual por chamada, screenshot depois de cada seção | A orientação viaja com o servidor, então qualquer cliente se comporta igual | `get_design_guide` existe; o ciclo está em `AGENTS.md` e nos docs humanos, não nas instruções do servidor |
| 3 | As descrições dizem "escreva incrementalmente, o usuário vê você escrever em tempo real" e nomeiam os critérios de revisão (espaçamento, tipografia, contraste, alinhamento, ajuste ao frame, repetição) | Transforma "revise seu trabalho" em algo que o modelo executa | `lint_design` e a verificação visual cobrem a parte mecânica; a passada dos seis critérios não está escrita |
| 4 | Todo resultado de mutação devolve um `contentHash` por domínio (tokens, nós, …) | Mantém sessões longas dentro do orçamento de contexto | `get_document_outline` devolve versão; não há token de mudança por domínio |
| 5 | O payload vem em dois content blocks (metadados + payload) | Os clientes deles erram isso o tempo todo | O Paprika devolve um bloco só; manter simples e documentar |
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

## Limites deste estudo

Documenta um binário de terceiro em uma versão, a partir de uma conta autenticada, e a cota semanal de
MCP daquela conta esgotou antes das últimas telas — então os números daquelas telas são orçamento de
design, não medição. Nada aqui foi revalidado em versão posterior do Paper.
