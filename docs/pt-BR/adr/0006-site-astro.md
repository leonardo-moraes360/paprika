[🇺🇸 English](../../en-US/adr/0006-astro-site.md) | 🇧🇷 Português

# ADR 0006: Astro (estático) para o site

- **Status:** Aceito
- **Data:** 2026-11-25
- **Código:** [`apps/site/`](../../../apps/site) (`astro.config.mjs`, `src/docs.config.ts`, `src/lib/`, `src/layouts/`)
- **Board:** [`docs/en-US/assets/boards/site`](../../en-US/assets/boards/site) (desenhado no Paprika antes do código, por `apps/site/scripts/draw-docs.mjs` e `draw-landing.mjs`)

## Contexto

O site em paprika.js.org era um script Node só (`apps/site/scripts/build.mjs`, 320 linhas) que renderizava a landing page a partir de um documento do Paprika e cada página das docs a partir de Markdown com o `marked`. Funcionava, mas cada necessidade nova caía nesse arquivo: uma lista plana de 15 páginas (faltavam 10 docs do repositório), sem busca, sem sumário, um tema só com cores fixas e sem realce de sintaxe. O desenho novo traz sidebar em grupos, busca, temas claro e escuro e uma home para as docs.

## Decisão

O site é um projeto [Astro](https://astro.build) com saída estática (`output: "static"`, SSG). Sem servidor e sem framework no cliente.

- **As docs continuam no Markdown do repositório, sem frontmatter.** `src/docs.config.ts` lista os grupos e as páginas nas duas línguas, nas mesmas posições; `src/lib/markdown.ts` renderiza com o `marked` (links entre docs apontam para as páginas geradas, outros links do repositório abrem no GitHub) e realça código com o Shiki, que o Astro já usa. Para adicionar uma página: o Markdown em `docs/en-US` e `docs/pt-BR` e uma linha no `docs.config.ts`.
- **A landing page continua sendo um documento do Paprika** (`design/landing.paprika.json`) renderizado com o `nodeStyle` do `@paprika/core`, agora dentro de um layout Astro (`src/lib/landing.ts`). O desenho segue como fonte da verdade: canvas, screenshot e site pintam do mesmo jeito.
- **A busca é o [Pagefind](https://pagefind.app)**, rodado depois do `astro build` sobre o `dist/`. Ele gera um índice estático por língua (pelo `<html lang>`), então a busca funciona no GitHub Pages sem serviço nem conta.
- **As URLs não mudam.** `build.format: "preserve"` mantém `/docs/canvas.html`, `/docs/pt-BR/…` e a landing em `/` e `/pt-BR/`. Os links são relativos, então o site funciona também num sub-caminho.
- **Não usamos o Starlight** (o tema de docs do Astro): ele traria busca, sidebar e i18n prontos, mas com visual próprio e um frontmatter em cada Markdown, e o desenho teria de se encaixar nele.

## Consequências

- `pnpm --filter @paprika/site site:build` roda `astro build && pagefind --site dist`; `pnpm --filter @paprika/site dev` serve o site com recarga automática.
- Dependências novas, fixadas: `astro` 7.4.13, `pagefind` 1.6.0, `shiki` 4.6.0. O `apps/site/scripts/build.mjs` saiu.
- O site continua fora do `pnpm build`; o workflow do Pages o gera depois que as mudanças chegam na `main`.
- A preferência de tema fica no `localStorage` (`paprika-theme`); sem ela, as docs seguem o sistema.
