[🇺🇸 English](README.md) | 🇧🇷 Português

# Site (paprika.js.org)

A landing page e a documentação, um projeto [Astro](https://astro.build) com saída estática ([ADR 0006](../../docs/pt-BR/adr/0006-site-astro.md)), publicado no GitHub Pages pelo [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) depois que as mudanças chegam na `main`. PRs que mexem em `apps/site`, `scripts/brand` ou `packages/core` geram o site na CI (**Site build**).

```bash
pnpm --filter @paprika/core build
pnpm --filter @paprika/site dev          # http://localhost:4321, com recarga automática
pnpm --filter @paprika/site site:build   # astro build + índice do Pagefind em apps/site/dist
pnpm --filter @paprika/site site:preview
```

| Caminho | Origem |
|---|---|
| `/` e `/pt-BR/` | `design/landing.paprika.json`, um documento do Paprika desenhado pelo MCP com `scripts/draw-landing.mjs`, renderizado por `src/lib/landing.ts` |
| `/docs/` e `/docs/pt-BR/` | a home das docs em `src/components/DocPage.astro` |
| `/docs/*.html` e `/docs/pt-BR/*.html` | os Markdown listados em `src/docs.config.ts` (`docs/en-US`, `docs/pt-BR`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `server/README*.md`) |

## A landing page é um documento do Paprika

A página é desenhada no próprio Paprika: quatro frames raiz (desktop e mobile, em inglês e português). O `src/lib/landing.ts` renderiza esses frames com o `nodeStyle` do `@paprika/core`, o mesmo motor do canvas, do screenshot e do export, com estas mudanças só para a web:

- os frames raiz esticam até a largura da janela (o frame desktop aparece acima de 760 px, o mobile abaixo);
- um nó chamado `link:<href>` vira um `<a href>`, `anchor:<id>` define o `id` dele, e `copy:<id>` vira um botão que copia um texto.

Para mudar a página, edite no canvas ou rode de novo o script de desenho, e gere outra vez:

```bash
pnpm --filter @paprika/core build && pnpm go:build
server/bin/paprika import apps/site/design/landing.paprika.json --db /tmp/landing.db --replace
server/bin/paprika serve --db /tmp/landing.db --port 4790
# em outro terminal
PAPRIKA_MCP=http://127.0.0.1:4790/mcp pnpm --filter @paprika/site site:draw
# ao terminar, de volta ao arquivo versionado
server/bin/paprika export --db /tmp/landing.db -o apps/site/design/landing.paprika.json
```

`PAPRIKA_WORKSPACE` e `PAPRIKA_PAGE` desenham em outro workspace e página sem trocar o ativo. Não use `set_assets` nesses scripts: as imagens entram como data URI.

## Documentação

Cada página do `src/docs.config.ts` vira uma página HTML com a sidebar em grupos, sumário, links de anterior e próxima, troca de idioma e tema claro e escuro. Links entre esses arquivos apontam para as páginas geradas; links para qualquer outro arquivo do repositório abrem no GitHub; imagens são copiadas para `/assets/`. Para incluir uma página, escreva em `docs/en-US` e `docs/pt-BR` e adicione uma linha em `GROUPS` no `src/docs.config.ts`, na mesma posição nas duas línguas.

A busca é o [Pagefind](https://pagefind.app): o `site:build` indexa o `dist/` depois do `astro build`, um índice por língua. Ela precisa do site gerado, então não funciona no `dev` (use `site:build && site:preview`).

O layout das docs foi desenhado antes no Paprika pelo `scripts/draw-docs.mjs`; os frames estão em [`docs/en-US/assets/boards/site`](../../docs/en-US/assets/boards/site).

## Domínio próprio

O site fica em `paprika.js.org` (subdomínio do [js.org](https://js.org)). Como o deploy é feito por workflow, o domínio é configurado em Settings → Pages do repositório (um arquivo `CNAME` é ignorado em deploys por workflow). Defina `PAPRIKA_SITE_URL` para gerar links canônicos com outro endereço; os links entre páginas são relativos, então o site funciona também num sub-caminho.
