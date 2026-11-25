🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# Site (paprika.js.org)

The landing page and the docs, a static site built with [Astro](https://astro.build) and published to GitHub Pages by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) after changes reach `main`.

| Path | Source |
|---|---|
| `/` and `/pt-BR/` | `src/components/Landing.astro`, copy in `src/i18n.ts` |
| `/docs/` and `/pt-BR/docs/` | the repository's Markdown: `README*.md`, `docs/`, `server/README*.md`, `CONTRIBUTING*`, `SECURITY*`, `CODE_OF_CONDUCT*` |

```bash
pnpm --filter @paprika/site dev          # http://localhost:4321, reloads on save (search needs a build)
pnpm --filter @paprika/site site:build   # writes apps/site/dist and its Pagefind search index
pnpm --filter @paprika/site preview      # serves dist
```

## Design first

The pages are drawn in Paprika before they are coded. `scripts/draw-landing.mjs` (landing page, desktop and mobile, both languages) and `scripts/draw-docs.mjs` (docs home and page, light and dark, desktop and mobile) draw the frames over MCP; `design/site.paprika.json` is the exported document. To change the look, change the drawing first, check it with `render_screenshot`, then the Astro code:

```bash
pnpm go:build
server/bin/paprika import apps/site/design/site.paprika.json --db /tmp/site.db --replace
server/bin/paprika serve --db /tmp/site.db --port 4790
# in another terminal; PAPRIKA_PAGE is the id of the "Landing" or "Docs" page (get_document_outline)
PAPRIKA_MCP=http://127.0.0.1:4790/mcp PAPRIKA_PAGE=<page id> node apps/site/scripts/draw-landing.mjs
PAPRIKA_MCP=http://127.0.0.1:4790/mcp PAPRIKA_PAGE=<page id> node apps/site/scripts/draw-docs.mjs
# when done, back to the versioned file
server/bin/paprika export --db /tmp/site.db -o apps/site/design/site.paprika.json
```

The landing page text lives in both `src/i18n.ts` and `scripts/draw-landing.mjs`; change them together. The setup prompt is read from the `text` block of `README.md` and `docs/pt-BR/README.md`, so it never drifts from the README.

## Docs

`src/docs.ts` is the sidebar: groups, and for each page its slug and its file and label in each language. Both languages share the slug, so `/docs/mcp/` and `/pt-BR/docs/mcp/` are the same page. To add a page, add its entry there with both files. The Markdown is rendered as it is in the repository (`src/markdown.ts`):

- everything above the first `# ` heading (language banner, README art) and the `Português: …` / `English: …` lines are dropped;
- links to another docs file point at its page, links to any other repository file open it on GitHub;
- images are served from `/doc-assets/<repository path>` and copied into the build;
- code blocks get a frame with the language and a Copy button.

Search is [Pagefind](https://pagefind.app), indexed after `astro build` (only the docs pages, `data-pagefind-body`). The docs follow the reader's light or dark preference, with a switch in the top bar; the landing page is always dark.

## Custom domain

The site is served at `paprika.js.org` ([js.org](https://js.org) subdomain). Because it is deployed by a workflow, the domain is set in the repository's Settings → Pages (a `CNAME` file is ignored for workflow deployments). Set `PAPRIKA_SITE_URL` to build canonical links for another address.
