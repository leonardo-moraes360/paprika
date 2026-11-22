[🇺🇸 English](../../adr/0003-tailwind-css.md) | 🇧🇷 Português

# ADR 0003: Tailwind CSS na interface do app do canvas

- **Status:** Aceito, emendado pelo ADR 0005
- **Data:** 2026-11-21 (emendado 2026-11-22)
- **Emendado por:** [ADR 0005: componentes shadcn sobre o tema fechado do Paprika](0005-shadcn-ui.md) — as restrições abaixo continuam valendo; aquele ADR acrescenta como uma biblioteca de componentes vive dentro delas.
- **Código:** [`apps/web/src/styles.css`](../../../apps/web/src/styles.css) (tema), [`apps/web/src/ui.ts`](../../../apps/web/src/ui.ts) (listas de classes compartilhadas), [`apps/web/vite.config.ts`](../../../apps/web/vite.config.ts)

## Contexto

A interface do app (`apps/web`: página de workspaces, barra do topo, toolbar, painéis de camadas e páginas,
inspector, painéis redimensionáveis, overlays de seleção, cursores de agentes) era estilizada por duas folhas
escritas à mão, `styles.css` (920 linhas) e `AgentCursors.css`, com nomes de classe globais. O mantenedor pediu
para trocar isso pelo Tailwind CSS na versão mais recente, mantendo o visual atual.

Uma restrição define a montagem: o canvas pinta o **documento do usuário** com os estilos inline do
`nodeStyle`, e ele precisa ficar igual ao export HTML e ao `render_screenshot`, que rodam sobre os padrões do
navegador (decisão 4 da arquitetura). O CSS do app não pode vazar para os nós dentro de `.world`.

## Decisão

1. **Tailwind CSS v4 (4.3.5) via `@tailwindcss/vite`.** Sem PostCSS nem `tailwind.config.js`: o tema fica no CSS
   (`@theme`), junto dos tokens da marca que ele representa.
2. **Sem Preflight.** O `styles.css` importa só `tailwindcss/theme.css` e `tailwindcss/utilities.css`, mais as
   poucas regras de base que o app sempre teve (fonte e cores da raiz, `box-sizing: border-box`, controles de
   formulário herdando a fonte). O Preflight mudaria os padrões do navegador dentro do canvas também
   (`line-height: 1.5` no `html`, `max-width: 100%` em imagens, `display: block` em SVG, margens zeradas em
   títulos e listas), e um documento ficaria diferente no canvas e no export ou no screenshot. Sem ele, os
   utilitários partem dos mesmos padrões em que a folha antiga foi escrita.
3. **Tema fechado.** `--color-*`, `--text-*`, `--radius-*` e `--breakpoint-*` são zerados e redefinidos a partir
   da marca "Estúdio noturno" (docs/brand): `bg-panel`, `text-muted`, `border-line`, `bg-accent-soft`,
   `text-select`… A paleta padrão do Tailwind não existe, então um `bg-blue-500` perdido não compila. A fonte da
   raiz continua 13px, por isso `--spacing` é `4px` em vez de `0.25rem` (a escala de sempre: `p-3` = 12px). O
   breakpoint `wide` (901px) substitui a antiga query `max-width: 900px` (`max-wide:hidden`). O tema é `static`,
   para os overlays SVG e as cores dos agentes lerem `var(--color-select)` e afins diretamente.
4. **Utilitários nos componentes; listas compartilhadas em `ui.ts`.** O que se repete (seção de painel,
   `h2`/`h3`, campo, botões secundários, barra do topo) são strings de classe exportadas, compostas com `cx()`.
   Valores por item (largura dos painéis, matiz do bloco de um workspace, cor de um agente) continuam como
   variáveis CSS ou estilo inline, lidos por valores arbitrários como `bg-(--agent)`.
5. **Ganchos de teste continuam como classes simples.** A suíte E2E seleciona `.workspace-card.is-active`,
   `.layer.is-selected`, `.page.is-active`, `.agent-pill`, `.world`, `aside.left`… Esses nomes ficam ao lado
   dos utilitários e não têm estilo.

## Verificação

18 screenshots da mesma sessão roteirizada (workspaces no desktop e no celular, hover no card, canvas, seleção,
seleção múltipla, hover na camada, hover e arraste do redimensionador, ferramenta ativa, agente desenhando um
diagrama com cursor e lista de agentes, problemas da revisão, renomear no lugar, edição de texto de forma,
páginas, formulário de novo workspace, canvas no celular, o exemplo bezier) foram tirados antes e depois da
mudança contra o servidor Go: os 18 são idênticos pixel a pixel. A suíte E2E do canvas (`packages/e2e`) passa contra o servidor Go.

## Consequências

- Os estilos ficam junto da marcação; não há folha global para manter em sincronia com nomes de classe.
- O CSS do bundle foi de 14,7 kB para 24,4 kB (5,6 kB com gzip), quase tudo variáveis do tema e regras `@property`.
- O Tailwind envolve os estilos de hover em `@media (hover: hover)`, então eles não ficam presos depois de um toque
  em telas sensíveis ao toque (a única mudança de comportamento intencional; no desktop a renderização é idêntica).
- Quem contribui usa os nomes do tema, não a paleta padrão do Tailwind nem as antigas variáveis `--bg`/`--panel`.
