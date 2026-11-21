[🇺🇸 English](README.md) | 🇧🇷 Português

# Site (paprika.js.org)

A landing page e a documentação, publicadas no GitHub Pages por [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) quando as mudanças chegam na `main`.

| Caminho | Origem |
|---|---|
| `/` e `/pt-BR/` | `design/landing.paprika.json`, um documento do Paprika desenhado pelo MCP com `scripts/draw-landing.mjs` |
| `/docs/` e `/docs/pt-BR/` | `README*.md`, `docs/`, `server-go/README*.md`, `CONTRIBUTING*`, `SECURITY*`, `CODE_OF_CONDUCT*` |

## A landing page é um documento do Paprika

A página é desenhada no próprio Paprika: quatro frames raiz (desktop e mobile, em inglês e português). O `scripts/build.mjs` renderiza esses frames com o `nodeStyle` do `@paprika/core`, o mesmo motor do canvas, do screenshot e do export, com duas mudanças só para a web:

- os frames raiz ocupam a largura da janela (o frame desktop aparece acima de 760 px e o mobile abaixo);
- um nó chamado `link:<href>` vira um `<a href>`.

Para mudar a página, edite no canvas ou rode de novo o script de desenho e depois gere o site:

```bash
pnpm --filter @paprika/core build && pnpm go:build
server-go/bin/paprika import apps/site/design/landing.paprika.json --db /tmp/landing.db --replace
server-go/bin/paprika serve --db /tmp/landing.db --port 4790
# em outro terminal
PAPRIKA_MCP=http://127.0.0.1:4790/mcp pnpm --filter @paprika/site site:draw
# no fim, de volta ao arquivo versionado
server-go/bin/paprika export --db /tmp/landing.db -o apps/site/design/landing.paprika.json
pnpm --filter @paprika/site site:build   # gera apps/site/dist
```

Abra `apps/site/dist/index.html` no navegador para conferir.

## Documentação

Cada arquivo da tabela acima vira uma página HTML com menu lateral e troca de idioma. Links entre esses arquivos apontam para as páginas geradas; links para qualquer outro arquivo do repositório abrem no GitHub. Para incluir uma página, adicione-a em `DOCS` no `scripts/build.mjs` nas duas línguas, na mesma posição.

## Domínio customizado

O site responde em `paprika.js.org` (subdomínio do [js.org](https://js.org)). Como o deploy é feito por workflow, o domínio é configurado em Settings → Pages do repositório (um arquivo `CNAME` é ignorado nesse modo). Defina `PAPRIKA_SITE_URL` para gerar os links canônicos com outro endereço.
