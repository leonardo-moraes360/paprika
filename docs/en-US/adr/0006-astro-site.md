🇺🇸 English | [🇧🇷 Português](../../pt-BR/adr/0006-site-astro.md)

# ADR 0006: Astro (static) for the site

- **Status:** Accepted
- **Date:** 2026-11-25
- **Code:** [`apps/site/`](../../../apps/site) (`astro.config.mjs`, `src/docs.config.ts`, `src/lib/`, `src/layouts/`)
- **Board:** [`docs/en-US/assets/boards/site`](../assets/boards/site) (drawn in Paprika before the code, by `apps/site/scripts/draw-docs.mjs` and `draw-landing.mjs`)

## Context

The site at paprika.js.org was one Node script (`apps/site/scripts/build.mjs`, 320 lines) that rendered the landing page from a Paprika document and every doc page from Markdown with `marked`. It worked, but each new need landed in that one file: a flat list of 15 pages (10 docs in the repository were missing), no search, no table of contents, one theme with hard-coded colors, and no syntax highlighting. The new design adds a grouped sidebar, search, light and dark themes and a home page for the docs.

## Decision

The site is an [Astro](https://astro.build) project with static output (`output: "static"`, SSG). No server, no client framework.

- **Docs stay in the repository's Markdown, with no frontmatter.** `src/docs.config.ts` lists the groups and pages in both languages, at the same positions; `src/lib/markdown.ts` renders them with `marked` (links between docs point at the generated pages, other repository links open GitHub) and highlights code with Shiki, which Astro already depends on. A page is added by adding its Markdown in `docs/en-US` and `docs/pt-BR` and one line in `docs.config.ts`.
- **The landing page is still a Paprika document** (`design/landing.paprika.json`) rendered with `nodeStyle` from `@paprika/core`, now inside an Astro layout (`src/lib/landing.ts`). The design stays the source of truth: canvas, screenshot and site paint it the same way.
- **Search is [Pagefind](https://pagefind.app)**, run after `astro build` over `dist/`. It builds a static index per language (from `<html lang>`), so search works on GitHub Pages without a service or an account.
- **URLs do not change.** `build.format: "preserve"` keeps `/docs/canvas.html`, `/docs/pt-BR/…` and the landing page at `/` and `/pt-BR/`. Links are relative, so the site also works under a sub-path.
- **We do not use Starlight** (Astro's docs theme): it would bring search, sidebar and i18n ready-made, but with its own look and a frontmatter in every Markdown file, and the drawn design would have to be fitted into it.

## Consequences

- `pnpm --filter @paprika/site site:build` runs `astro build && pagefind --site dist`; `pnpm --filter @paprika/site dev` serves the site with hot reload.
- New dependencies, pinned: `astro` 7.4.13, `pagefind` 1.6.0, `shiki` 4.6.0. `apps/site/scripts/build.mjs` is gone.
- The site is still not part of `pnpm build`; the Pages workflow builds it after changes reach `main`.
- Theme preference is kept in `localStorage` (`paprika-theme`); without it, the docs follow the system setting.
