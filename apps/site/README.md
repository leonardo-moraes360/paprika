🇺🇸 English | [🇧🇷 Português](README.pt-BR.md)

# Site (paprika.js.org)

The landing page and the docs, published to GitHub Pages by [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) after changes reach `main`.

| Path | Source |
|---|---|
| `/` and `/pt-BR/` | `design/landing.paprika.json`, a Paprika document drawn over MCP by `scripts/draw-landing.mjs` |
| `/docs/` and `/docs/pt-BR/` | `README*.md`, `docs/`, `server/README*.md`, `CONTRIBUTING*`, `SECURITY*`, `CODE_OF_CONDUCT*` |

## The landing page is a Paprika document

The page is designed in Paprika itself: four root frames (desktop and mobile, English and Brazilian Portuguese). `scripts/build.mjs` renders them with `nodeStyle` from `@paprika/core`, the same engine as the canvas, screenshots and export, with two web-only changes:

- root frames stretch to the viewport width (the desktop frame shows above 760 px, the mobile frame below);
- a node named `link:<href>` becomes an `<a href>`.

To change the page, edit it on the canvas or rerun the drawing script, then rebuild:

```bash
pnpm --filter @paprika/core build && pnpm go:build
server/bin/paprika import apps/site/design/landing.paprika.json --db /tmp/landing.db --replace
server/bin/paprika serve --db /tmp/landing.db --port 4790
# in another terminal
PAPRIKA_MCP=http://127.0.0.1:4790/mcp pnpm --filter @paprika/site site:draw
# when done, back to the versioned file
server/bin/paprika export --db /tmp/landing.db -o apps/site/design/landing.paprika.json
pnpm --filter @paprika/site site:build   # writes apps/site/dist
```

Open `apps/site/dist/index.html` in a browser to check it.

## Docs

Every page in the table above becomes an HTML page with a sidebar and a language switch. Links between those files point at the generated pages; links to any other repository file open it on GitHub. To add a page, add it to `DOCS` in `scripts/build.mjs` in both languages, at the same position.

## Custom domain

The site is served at `paprika.js.org` ([js.org](https://js.org) subdomain). Because it is deployed by a workflow, the domain is set in the repository's Settings → Pages (a `CNAME` file is ignored for workflow deployments). Set `PAPRIKA_SITE_URL` to build canonical links for another address.
