[🇺🇸 English](../../adr/0005-shadcn-ui.md) | 🇧🇷 Português

# ADR 0005: componentes shadcn sobre o tema fechado do Paprika

- **Status:** Aceito
- **Data:** 2026-11-22
- **Emenda:** [ADR 0003: Tailwind CSS na interface do app do canvas](0003-tailwind-css.md) (as restrições continuam valendo; este ADR acrescenta como uma biblioteca de componentes vive dentro delas)
- **Código:** [`apps/web/src/components/ui/`](../../apps/web/src/components/ui) (primitivos), [`apps/web/src/styles.css`](../../apps/web/src/styles.css) (aliases semânticos), [`apps/web/src/lib/cn.ts`](../../apps/web/src/lib/cn.ts), [`apps/web/components.json`](../../apps/web/components.json), galeria em `/ui` ([`apps/web/src/UiGallery.tsx`](../../apps/web/src/UiGallery.tsx))
- **Board:** [`docs/assets/boards/PAP-B-030`](../assets/boards/PAP-B-030) (desenhado no Paprika antes de instalar qualquer dependência)

## Contexto

A linha "migrar para componentes shadcn" do backlog foi antecipada da leva 4 para a leva 3 (pedido de 2026-11-22). Nove tickets de UI já estavam na fila, e um ticket único que migrasse tudo bateria com todos eles, então a migração foi dividida em cinco: PAP-B-030 (este: a fundação), PAP-B-031 (overview e diálogos), PAP-B-032 (inspector), PAP-B-033 (shell, toolbar, camadas e páginas) e PAP-B-034 (painel de time e lista de agentes). Os tickets já em andamento continuam com `src/ui.ts` e migram para os primitivos depois que o 030 entrar.

Dois pontos do ADR 0003 fazem disso uma decisão, e não uma instalação de pacote:

1. **Sem Preflight.** Os componentes do shadcn são escritos contra o Preflight, que zera margens, põe `border: 0 solid` em tudo, deixa o fundo de `button` transparente e `svg` como bloco. No Paprika isso não pode existir: o documento sob `.world` precisa renderizar com os padrões do navegador, exatamente como o export HTML e o `render_screenshot`.
2. **Tema fechado.** Os nomes da marca em `styles.css` já têm o significado do Paprika: `text-muted` é uma cor de *texto* (#a6acc4) e `bg-accent` é o vermelho da marca. O shadcn usa `muted` para uma *superfície* e `accent` para a superfície de hover. Sobrescrever esses nomes repintaria o app inteiro.

## Decisão

1. **Copiar o código, manter o tema.** Os componentes são copiados para `apps/web/src/components/ui/` (o modelo de código aberto do shadcn, estilo `new-york`, MIT). Além das primitivas do Radix, nada renderiza por biblioteca de componentes em tempo de execução: nenhum componente vem de `node_modules`, nenhum registry roda no build. Cada arquivo copiado diz de onde veio, e `apps/web/components.json` registra o estilo de origem dos que ainda vêm.
2. **Nomes semânticos, com o namespace `ui-`.** Os nomes do shadcn — `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring` — são definidos no bloco `@theme static` de `styles.css` como `--color-ui-*`, cada um apontando para um token da marca que já existe:

   | nome shadcn | variável Paprika | escuro (Estúdio noturno) | espelho claro (`.ui-light`) |
   |---|---|---|---|
   | background / foreground | `--color-ui-background` / `-foreground` | `night` #141827 / `fg` #eef0f7 | #f2f3f8 / #141827 |
   | card / card-foreground | `--color-ui-card` / `-foreground` | `panel` #1e2336 / `fg` | #ffffff / #141827 |
   | popover / popover-foreground | `--color-ui-popover` / `-foreground` | `panel-2` #272d45 / `fg` | #ffffff / #141827 |
   | primary / -foreground / -hover | `--color-ui-primary*` | `accent-strong` #c8401f / branco / `accent-dark` #a93220 | igual |
   | secondary / -foreground / -hover | `--color-ui-secondary*` | `panel-2` / `fg` / #313a5c | `canvas` #e7e9f0 / #141827 / #d9deea |
   | muted / muted-foreground | `--color-ui-muted*` | `panel-2` / `muted` #a6acc4 | `canvas` / #5d6478 |
   | accent / accent-foreground | `--color-ui-accent*` | `panel-2` / `fg` | `canvas` / #141827 |
   | destructive / -foreground / -hover | `--color-ui-destructive*` | `danger` #cc2f50 / branco / `danger-dark` #a31d3d — matiz própria, não o acento, ver *Cor de perigo* | mesmo preenchimento e hover; o token de texto vira #a8173a |
   | destructive como texto | `--color-ui-destructive-text` | `danger-ink` #ff9fb2 (7,01:1 em `panel-2`) | #a8173a (7,37:1 no branco) |
   | border / input | `--color-ui-border` / `-input` | `line` #2c3350 | #d3d7e3 / #c6cbd9 |
   | ring (foco) / link | `--color-ui-ring` / `-link` | `select` #4cc7d8 | #0b7183 |
   | overlay atrás de diálogos | `--color-ui-overlay` | rgb(9 12 22 / .66) | rgb(20 24 39 / .42) |

   O prefixo `ui-` é o que preserva o ADR 0003: `text-muted` e `bg-accent` continuam significando o que sempre significaram, e nenhum primitivo os lê. Um token não tem equivalente no upstream: **vermelho como texto precisa do seu próprio token**. O vermelho de preenchimento #c8401f sustenta texto branco em 4,99:1, mas escrito como texto sobre `panel-2` fica em 2,72:1; por isso item de menu, mensagem de validação e o ícone do alerta usam `--color-ui-destructive-text` (7,97:1 no escuro, 6,28:1 no claro).
3. **O que os primitivos tomariam do Preflight fica escrito nos primitivos, não numa regra global.** A camada base de `styles.css` mantém exatamente as regras listadas no ADR 0003. Nada global foi acrescentado por causa do shadcn, porque um `button { background: transparent }` ou `* { border-color: … }` global repintaria os painéis de hoje e alcançaria o canvas. Cada primitivo nomeia o próprio fundo e a própria cor de borda e, onde o upstream depende do reset do Preflight, o próprio `m-0`: `DialogTitle`, `DialogDescription`, `AlertDialogTitle` e os outros são `h2`/`p` e, sem Preflight, carregam as margens do navegador.
4. **Foco é outline, não ring.** O app já sinaliza foco com `focus-visible:outline-2 focus-visible:outline-offset-2`. Os primitivos usam o mesmo, com `outline-ui-ring`. As utilidades de ring existem no tema (`--color-ui-ring`) para o futuro, mas os componentes copiados foram mudados: no tema noturno um ring de 1px dentro de um botão vermelho não aparece, e os controles do próprio Paprika já usam outline.
5. **A densidade é a do Paprika, não a do shadcn.** Fonte raiz 13px, `--spacing: 4px` (ADR 0003), então os tamanhos de `Button` são 24/28/32/36px (`xs/sm/default/lg`, mais `icon`) e os campos têm 28px de altura — os números desenhados no board e as alturas que os painéis de hoje usam. O `h-9` do upstream deixaria o inspector um terço mais alto. Os ajustes responsivos `sm:`/`md:` dos arquivos originais foram descartados: o tema fechado tem um único ponto de quebra (`wide`, 901px), e uma variante desconhecida gera uma classe que não compila para nada.
6. **Escuro é o tema que vai para a rua; claro é um escopo de tokens.** `.ui-light` redefine apenas as variáveis `--color-ui-*`, então um painel claro pode ficar ao lado de um escuro, e a linha futura "modos de tema (claro/escuro/compacto)" do backlog tem de onde crescer. O app em si não troca de tema neste ticket. O Radix renderiza sobreposições em um portal no `<body>`, então a galeria passa a classe do escopo para o próprio conteúdo (`<DialogContent className="ui-light">`) — o tema viaja com o portal.
7. **As animações vêm do `tw-animate-css`.** Importá-lo acrescenta as utilidades de entrada/saída (`animate-in`, `animate-out`, `fade-in-0`, `slide-in-from-top-2`, `animate-collapsible-down`) usadas por dialog, popover, menu, tooltip, select e collapsible, o que também cobre parte da linha "animações na tela com tailwind-animate" do backlog. A versão 1.4.0 não traz proteção para movimento reduzido, então `styles.css` acrescenta uma, com escopo `:not(.world, .world *)` como as regras de barra de rolagem: sob `prefers-reduced-motion: reduce` a animação ainda roda, em 0,01ms, para que o Radix — que desmonta no `animationend` — continue fechando. O recolhível do inspector é a exceção (PAP-B-088): `animate-collapsible-down`/`-up` definem `height` a partir de `--radix-collapsible-content-height`, e essa altura medida pulava e cortava a última linha. O `CollapsibleContent` anima `grid-template-rows` entre `0fr` e `1fr`, então nenhum quadro fica mais alto que o corpo assentado; a mesma guarda de 0,01ms mantém o movimento reduzido num passo só, e o corpo desmonta no `animationend`.
8. **`cn()` é `clsx` + `tailwind-merge` configurados para o tema fechado** (`src/lib/cn.ts`): `text-2xs/xs/sm/md/lg/xl/tile` são declarados como tamanhos de fonte, para que `text-md` não seja lido como cor, e `shadow-float`/`shadow-tag` como sombras, para que substituam `shadow-md`/`shadow-lg` do upstream em vez de ficarem ao lado delas.
9. **Dependências, fixas e com licença** (`apps/web/package.json`, versões exatas, sem faixa): `radix-ui` 1.8.1 (MIT, um pacote só, importado por namespace: `import { Dialog as DialogPrimitive } from "radix-ui"`), `class-variance-authority` 0.7.1 (Apache-2.0), `clsx` 2.1.1 (MIT) e `tailwind-merge` 3.7.1 (MIT) como dependências de execução; `tw-animate-css` 1.4.0 (MIT) como devDependency ao lado de `tailwindcss`, porque é CSS consumido no build. PAP-B-047 acrescenta `cmdk` 1.1.1 (MIT) para o primitivo Command usado pelo combobox do FontPicker.
10. **`components.json` registra o layout, sem alias `@/`.** O repo importa com caminhos relativos, e adicionar `paths` no TS mais um alias no Vite não estava neste ticket. Consequência: `npx shadcn add <nome>` gera imports `@/lib/utils` que não resolvem aqui, então um add futuro é uma cópia manual com as duas mesmas reescritas que fizemos à mão — `@/…` → relativo, e os nomes de cor → `ui-*`.
11. **A superfície de prova é `ConnectionStatus`, e a galeria é o instrumento de comparação.** Só `apps/web/src/ConnectionStatus.tsx` migra neste ticket: ela renderiza pelo primitivo `components/ui/status.tsx` (`StatusLiveRegion`, `statusDotVariants`) com `cn()` e os tokens `ui-*`, mantendo o mesmo DOM e o mesmo texto, então a asserção de acessibilidade já existente sobre a região viva continua cobrindo. O ponto visível da barra superior fica onde está porque `App.tsx` é do PAP-B-033; `statusDotVariants` é onde ele vai parar. `/ui` renderiza cada primitivo nos dois escopos, sem link no app e carregada sob demanda, para que o chunk do app não pague pelos primitivos antes de as telas migrarem.

## O que mudou em relação ao upstream

| upstream (new-york, 2026-11) | aqui | por quê |
|---|---|---|
| `bg-primary`, `text-muted-foreground`, `border-input` | `bg-ui-primary`, … | os nomes da marca do ADR 0003 estão tomados, com outro sentido |
| `focus-visible:ring-1 ring-ring` | `focus-visible:outline-2 outline-offset-2 outline-ui-ring` | igual ao foco do app; um ring de 1px some num controle preenchido |
| controles `h-9`, `px-4` | campos de 28px, botões de 24/28/32/36px | densidade da escala 13px raiz / 4px de espaçamento, como no board |
| scrim `bg-black/80` do diálogo | `bg-ui-overlay` | a marca noturna, e o mesmo valor que o board carrega |
| `shadow-md`/`shadow-lg` | `shadow-float` | o tema define duas sombras; o board usa a flutuante |
| `text-destructive` para texto vermelho | `text-ui-destructive-text` | 2,72:1 como texto no noturno, 7,97:1 com o ink |
| `AlertDialogAction` é sempre o botão primário | o `ConfirmDialog` troca para as classes destrutivas via `className` | confirmar um apagamento não pode parecer o chamado principal do app |
| variantes `sm:`/`md:` | removidas | o tema fechado tem um ponto de quebra (`wide`) |
| `React.forwardRef` + `displayName` | componentes de função, `ref` como prop (React 19), `data-slot` | é o estilo atual do upstream; `data-slot` é também o que a suíte E2E seleciona |
| `import { X } from "@radix-ui/react-x"` | `import { X as XPrimitive } from "radix-ui"` | um pacote MIT em vez de treze |
| rótulo `Close` no diálogo | "Fechar", `aria-label` no botão | a UI do app é pt-BR, e um botão só de ícone mantém o nome acessível |

### Cor de perigo e o padrão de confirmação (PAP-B-026)

O acento do Paprika é vermelho, então o mapeamento padrão do primitivo — `destructive` = `accent-strong` — fazia
do botão de apagar e do chamado principal **o mesmo botão**. A resposta, desenhada antes e entrada pelo PR #95, é
uma matiz própria: o token da marca `--color-danger` #cc2f50, `--color-danger-dark` #a31d3d no hover e
`--color-danger-ink` #ff9fb2 como texto (#a8173a em `.ui-light`), para onde apontam os apelidos
`--color-ui-destructive*`. Perigo continua um botão vermelho preenchido; o que separa do primário é a matiz, não
o tratamento.

Medido pela suíte de acessibilidade, nos dois escopos de tema: branco sobre o preenchimento dá **5,13:1** em
repouso e **7,50:1** no hover; como texto, o ink fica em 7,01:1 no noturno e 7,37:1 no branco. O teste também
asser que o preenchimento de perigo não é a cor do primário.

A outra candidata, desenhada na mesma folha antes do #95 e rejeitada, pegava emprestada a linguagem de aviso que
o app já tinha: o acento como lavanda translúcida com `accent-ink` como texto. Perdeu nos dois pontos — uma
lavanda do acento lê como um primário discreto, não como perigo, e no claro o alpha do hover precisou ser limitado
a 14% para o texto não cair abaixo de 4,5:1. Com matiz própria o botão pode ficar preenchido e o hover pode ficar
**mais escuro**, que é o que se espera de uma ação de perigo.

Duas regras dizem o que recebe o tratamento:

1. **Perigo marca o que o Ctrl+Z não traz de volta.** Excluir um workspace e remover uma pessoa do time. Apagar
   um nó, uma página ou uma seleção é desfazível e fica neutro — pintar todo apagamento de vermelho faria o
   vermelho não significar nada. Trocar a chave desta instância e revogar links de convite também são
   irreversíveis, mas ficaram como estavam: o ticket limitou `Team.tsx` ao botão de remover.
2. **Ação irreversível tem confirmação com o verbo** — e o apagamento de workspace ainda pede o nome digitado. O
   `ConfirmDialog` (`apps/web/src/ConfirmDialog.tsx`) compõe o primitivo AlertDialog: verbo no título, o que se
   perde na descrição, `Cancelar` primeiro, a ação destrutiva por último e o erro dentro do diálogo, porque o
   aviso da página fica atrás da scrim. O Radix abre o AlertDialog com o foco no **cancelar**, que é o padrão
   seguro.

Ainda falta, e está registrado no backlog: o aviso (toast) no canvas dizendo o que um agente apagou ou para qual
workspace ele mudou. Ele lê o resumo que `delete_workspace` devolve, que é o PAP-B-015 (PR #97); o aviso em si
ainda não tem ticket.

## Verificação

- `pnpm check` (build com o renderizador WASM, typecheck, fixtures, testes de TS e Go, suítes de API e E2E contra o servidor em Go).
- `packages/e2e/test/e2e/a11y.e2e.test.ts`, PAP-B-026: a confirmação de apagar workspace é asserida como `alertdialog` com os botões na ordem `Cancelar` e depois `Excluir`, com a ação carregando as classes destrutivas, com o foco começando dentro e voltando ao gatilho no Esc, e com o Esc deixando o workspace na lista; o botão destrutivo é medido em 4,5:1 ou mais nos dois escopos de tema, em repouso e no hover (a lavanda é translúcida, então o teste a compõe sobre o painel de antes de medir).
- `packages/e2e/test/e2e/canvas.e2e.test.ts`: o fluxo do overview lê essa confirmação pelo papel `alertdialog` em vez de `dialog` e digita o nome do workspace onde antes clicava direto; as asserções em si (Cancelar mantém, Excluir apaga, apagar o ativo move o canvas e os agentes) continuam as mesmas.
- `packages/e2e/test/e2e/a11y.e2e.test.ts`, bloco novo "galeria de primitivas (/ui)": o diálogo prende o foco e oito Tabs continuam dentro dele, Esc devolve o foco ao gatilho; o alert-dialog abre com o foco dentro e o escopo `ui-light` viaja com o portal; a tooltip abre pelo teclado, não só no hover; o menu abre com Enter, nomeia os itens (`menuitem`, inclusive o destrutivo), anda com as setas e fecha no Esc; o botão primário passa de 4,5:1 nos dois escopos; e sob `prefers-reduced-motion: reduce` as animações do chrome são neutralizadas enquanto um nó dentro de `.world` mantém `transition-duration: 0s` e o container `.world` mantém `line-height: normal`.
- Isolamento do canvas: a suíte E2E do canvas e a suíte WASM (que compara o renderizador do DOM com o de Rust, pixel a pixel) estão inalteradas e passam. Além disso, a mesma página do canvas (`/w/<id>` no servidor em Go, 1440×900, Chromium) foi capturada no `origin/main` e neste branch: **0 de 1.296.000 pixels diferem**. Nada neste ticket toca o DOM sob `.world` — cada regra nova é uma classe utilitária num primitivo ou um escopo `:not(.world, .world *)`.
- Bundle, `vite build` no `origin/main` e neste branch: CSS 29,02 kB → 45,94 kB (6,59 kB → 9,12 kB gzip); o JS de entrada do app 554,31 kB → 585,85 kB (170,30 kB → 181,03 kB gzip), que é `cn()` mais o `ConnectionStatus` migrado; os primitivos e o Radix ficam no chunk lazy da galeria, 179,69 kB (52,46 kB gzip), carregado só em `/ui`. Eles passam para o chunk do app quando PAP-B-031…034 migrarem cada tela.
- Board antes do código: cinco frames na página `Interfaces` do workspace Paprika (controles e sobreposições, claro e escuro, mais o mapa de tokens), desenhados por MCP em `127.0.0.1:4777` antes do `pnpm add`, com `lint_design` em 0 erros, exportados para [`docs/assets/boards/PAP-B-030`](../assets/boards/PAP-B-030).

## Consequências

- O tema continua fechado e o Preflight continua de fora; os primitivos carregam os próprios resets.
- Dois nomes coexistem por um tempo: `ui.ts` (até PAP-B-031…034 apagarem cada entrada que ficar sem uso) e `components/ui/`. O `AGENTS.md` diz qual deles o código novo de UI usa. O PAP-B-033 liberou `ui.iconBtn` e moveu o shell, a toolbar (`ToggleGroup`+`Tooltip`), camadas, páginas, `InlineName`, `PanelResizer` e o ponto de status da barra superior para os primitivos; o Inspector (PAP-B-032) ainda lê `ui.ts`.
- PAP-B-051: os atributos HTML `title` em `apps/web` sumiram; use `Hint` (ou `Tooltip`+`TooltipTrigger`+`TooltipContent`) de `components/ui/tooltip.tsx`. O `TooltipProvider` fica uma vez em `main.tsx`. Botões só de ícone mantêm `aria-label`; um controle `disabled` que ainda precise de dica vai dentro de um `span` focável.
- Um tema claro existe agora só no nível dos tokens; o app ainda não o oferece.
- `tw-animate-css` é a fonte das animações, então a linha "tailwind-animate" do backlog fica parcialmente coberta; a linha continua aberta até as animações do próprio app usarem isso.
- Acrescentar um componente depois é copiar e fazer duas reescritas mecânicas (caminhos e nomes de cor), porque não há alias `@/`; isso fica registrado aqui em vez de ser pago com uma superfície nova de configuração.

</parameter>
<<504>>
</invoke>
