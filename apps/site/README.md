🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# Site (paprika.js.org)

The landing page and the docs, an [Astro](https://astro.build) project with static output ([ADR 0006](../../docs/en-US/adr/0006-astro-site.md)), published to GitHub Pages by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) after changes reach `main`. Pull requests that touch `apps/site`, `scripts/brand` or `packages/core` build it in CI (**Site build**).

```bash
pnpm --filter @paprika/core build
pnpm --filter @paprika/site dev          # http://localhost:4321, with hot reload
pnpm --filter @paprika/site site:build   # astro build + Pagefind index into apps/site/dist
pnpm --filter @paprika/site site:preview
```

| Path | Source |
|---|---|
| `/` and `/pt-BR/` | `design/landing.paprika.json`, a Paprika document drawn over MCP by `scripts/draw-landing.mjs`, rendered by `src/lib/landing.ts` |
| `/docs/` and `/docs/pt-BR/` | the docs home in `src/components/DocPage.astro` |
| `/docs/*.html` and `/docs/pt-BR/*.html` | the Markdown files listed in `src/docs.config.ts` (`docs/en-US`, `docs/pt-BR`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `server/README*.md`) |

## The landing page is a Paprika document

The page is designed in Paprika itself: four root frames (desktop and mobile, English and Brazilian Portuguese). `src/lib/landing.ts` renders them with `nodeStyle` from `@paprika/core`, the same engine as the canvas, screenshots and export, with these web-only changes:

- root frames stretch to the viewport width (the desktop frame shows above 760 px, the mobile frame below);
- a node named `link:<href>` becomes an `<a href>`, `anchor:<id>` sets its `id`, and `copy:<id>` becomes a button that copies a text.

To change the page, edit it on the canvas or rerun the drawing script, then rebuild:

```bash
pnpm --filter @paprika/core build && pnpm go:build
server/bin/paprika import apps/site/design/landing.paprika.json --db /tmp/landing.db --replace
server/bin/paprika serve --db /tmp/landing.db --port 4790
# in another terminal
PAPRIKA_MCP=http://127.0.0.1:4790/mcp pnpm --filter @paprika/site site:draw
# when done, back to the versioned file
server/bin/paprika export --db /tmp/landing.db -o apps/site/design/landing.paprika.json
```

`PAPRIKA_WORKSPACE` and `PAPRIKA_PAGE` draw into another workspace and page without switching the active one. Don't use `set_assets` in these scripts: images are inlined as data URIs.

## Docs

Every page in `src/docs.config.ts` becomes an HTML page with the grouped sidebar, a table of contents, previous and next links, a language switch and a light and dark theme. Links between those files point at the generated pages; links to any other repository file open it on GitHub; images are copied under `/assets/`. To add a page, write it in `docs/en-US` and `docs/pt-BR` and add one line to `GROUPS` in `src/docs.config.ts`, at the same position in both languages.

Search is [Pagefind](https://pagefind.app): `site:build` indexes `dist/` after `astro build`, one index per language. It needs the built site, so it does not work under `dev` (use `site:build && site:preview`).

The docs layout was drawn first in Paprika by `scripts/draw-docs.mjs`; the frames are in [`docs/en-US/assets/boards/site`](../../docs/en-US/assets/boards/site).

## Custom domain

The site is served at `paprika.js.org` ([js.org](https://js.org) subdomain). Because it is deployed by a workflow, the domain is set in the repository's Settings → Pages (a `CNAME` file is ignored for workflow deployments). Set `PAPRIKA_SITE_URL` to build canonical links for another address; page links are relative, so the site also works under a sub-path.
