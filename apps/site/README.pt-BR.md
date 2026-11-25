[🇺🇸 English](README.md) | 🇧🇷 Português

# Site (paprika.js.org)

A landing page e a documentação, um site estático feito com [Astro](https://astro.build) e publicado no GitHub Pages por [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) quando as mudanças chegam na `main`.

| Caminho | Origem |
|---|---|
| `/` e `/pt-BR/` | `src/components/Landing.astro`, textos em `src/i18n.ts` |
| `/docs/` e `/pt-BR/docs/` | o Markdown do repositório: `README*.md`, `docs/`, `server/README*.md`, `CONTRIBUTING*`, `SECURITY*`, `CODE_OF_CONDUCT*` |

```bash
pnpm --filter @paprika/site dev          # http://localhost:4321, recarrega ao salvar (a busca precisa de build)
pnpm --filter @paprika/site site:build   # gera apps/site/dist e o índice de busca do Pagefind
pnpm --filter @paprika/site preview      # serve o dist
```

## Desenho primeiro

As páginas são desenhadas no Paprika antes de virarem código. O `scripts/draw-landing.mjs` (landing page, desktop e mobile, nas duas línguas) e o `scripts/draw-docs.mjs` (home e página da documentação, claro e escuro, desktop e mobile) desenham os frames pelo MCP; `design/site.paprika.json` é o documento exportado. Para mudar o visual, mude primeiro o desenho, confira com `render_screenshot`, e depois o código Astro:

```bash
pnpm go:build
server/bin/paprika import apps/site/design/site.paprika.json --db /tmp/site.db --replace
server/bin/paprika serve --db /tmp/site.db --port 4790
# em outro terminal; PAPRIKA_PAGE é o id da página "Landing" ou "Docs" (get_document_outline)
PAPRIKA_MCP=http://127.0.0.1:4790/mcp PAPRIKA_PAGE=<id da página> node apps/site/scripts/draw-landing.mjs
PAPRIKA_MCP=http://127.0.0.1:4790/mcp PAPRIKA_PAGE=<id da página> node apps/site/scripts/draw-docs.mjs
# ao terminar, de volta para o arquivo versionado
server/bin/paprika export --db /tmp/site.db -o apps/site/design/site.paprika.json
```

O texto da landing page fica em `src/i18n.ts` e em `scripts/draw-landing.mjs`; mude os dois juntos. O prompt de configuração é lido do bloco `text` do `README.md` e do `docs/pt-BR/README.md`, então nunca se afasta do README.

## Documentação

O `src/docs.ts` é o menu lateral: grupos e, para cada página, o slug e o arquivo e o rótulo em cada língua. As duas línguas usam o mesmo slug, então `/docs/mcp/` e `/pt-BR/docs/mcp/` são a mesma página. Para incluir uma página, adicione a entrada ali com os dois arquivos. O Markdown é renderizado como está no repositório (`src/markdown.ts`):

- tudo acima do primeiro título `# ` (faixa de idioma, arte do README) e as linhas `Português: …` / `English: …` são descartados;
- links para outro arquivo da documentação apontam para a página dele; links para qualquer outro arquivo do repositório abrem no GitHub;
- imagens são servidas em `/doc-assets/<caminho no repositório>` e copiadas para o build;
- blocos de código ganham uma moldura com a linguagem e um botão Copiar.

A busca é o [Pagefind](https://pagefind.app), indexado depois do `astro build` (só as páginas da documentação, `data-pagefind-body`). A documentação segue a preferência de tema claro ou escuro de quem lê, com um botão na barra do topo; a landing page é sempre escura.

## Domínio customizado

O site responde em `paprika.js.org` (subdomínio do [js.org](https://js.org)). Como o deploy é feito por workflow, o domínio é configurado em Settings → Pages do repositório (um arquivo `CNAME` é ignorado nesse modo). Defina `PAPRIKA_SITE_URL` para gerar os links canônicos com outro endereço.
