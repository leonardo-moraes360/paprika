[🇺🇸 English](../design-boards.md) | 🇧🇷 Português

# Folhas de design

Toda mudança que encosta em interface é desenhada antes de ser codada (regra 6 do `AGENTS.md`): o agente abre
um frame por estado num documento Paprika pelo MCP, confere com `lint_design` e anexa os PNGs do
`render_screenshot` ao PR. Disso saem dois artefatos, com papéis diferentes:

- **Os PNGs** em `docs/assets/boards/<TICKET>/` são o artefato de revisão: o que o revisor e o maintenedor
  leem no PR. Vão commitados com a change.
- **O documento** é a fonte editável: frames, tokens, overrides de modo. Ele mora no servidor Paprika, que é
  um banco — e banco se muda.

## O ciclo de desenho


A sessão que desenha uma folha segue sempre o mesmo formato, e é ele que mantém a folha revisável enquanto
ela é construída:

1. Leia o estado primeiro: `get_document_outline`, depois `find_nodes` do que existe, então os ids que
   importam com `get_nodes`. Nunca despeje a árvore.
2. Feche o sistema antes de desenhar: tokens do tema, escala de espaçamento e a escada tipográfica (`set_tokens`).
3. Escreva um grupo visual por chamada de `create_nodes` — um cabeçalho, uma linha, um card — para que o
   humano veja a tela chegar e um erro custe um grupo, não a folha inteira.
4. Depois de cada grupo: `render_screenshot`, depois `lint_design`, e uma linha de veredito contra
   espaçamento, tipografia, contraste, alinhamento, ajuste ao frame e repetição. Corrija antes de seguir.
5. Reuse em vez de refazer: `duplicate_nodes` para repetições, componentes e instâncias para estados,
   `align_nodes`/`distribute_nodes` em vez de coordenadas na mão.
6. Feche o trabalho: nomeie os frames, exporte o documento (abaixo) e, quando a mudança mexer em uma
   interface que o usuário vai julgar, deixe os PNGs em `docs/assets/boards/<TICKET>/`.

Esses passos vêm de operar de ponta a ponta o MCP de agente de um concorrente; a comparação e o que o
Paprika deveria adotar estão no [estudo de MCP de agente](research/paper-mcp-0.5.19.md).

## Guardar o documento no repositório

O documento das folhas é exportado para `docs/design/boards.paprika.json` do mesmo jeito que a landing page
guarda `apps/site/design/landing.paprika.json`:

```bash
# depois de desenhar as folhas (o servidor as tem em <db>)
server-go/bin/paprika export --db <db> -o docs/design/boards.paprika.json

# depois de um reset: traz de volta para um servidor limpo e refaz os screenshots a partir dele
server-go/bin/paprika import docs/design/boards.paprika.json --db <db> --replace
```

Commite a exportação na própria change que desenhou as folhas, ou num `chore:` logo depois — de qualquer
jeito, um commit por refresh, para o `git log` mostrar a tela evoluindo como a pilha de desfazer mostra.

## Por que isso existe

Em 2026-11-22 o servidor em `127.0.0.1:4777` saiu do `paprika serve` rodando no host e passou à pilha do
compose com volume novo. O documento com a página `Interfaces` — a folha de componentes do PAP-B-030 e a do
painel de time do PAP-B-034, mais uma do PAP-B-026 desenhada minutos antes — simplesmente sumiu do
`list_workspaces`, e as folhas tiveram que ser redesenhadas pelos scripts. Os PNGs sobraram; a fonte editável,
não.

A cópia commitada é **cópia de recuperação**, não o documento de trabalho: os agentes seguem desenhando no
Paprika que o ticket apontar, e o export é o que faz perder aquele servidor custar um reload, não um
redesenho. A cópia no repositório hoje tem a folha de ações destrutivas do PAP-B-026, a única que ainda
existia; as que se perderam ficam registradas nos PNGs e nos ADRs que saíram delas.
