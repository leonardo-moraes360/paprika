# CI

> English: [docs/en-US/ci.md](../en-US/ci.md)

O CI do Paprika roda **apenas em pull requests** (`opened`, `synchronize`, `reopened`, `ready_for_review`). Nada roda em push nem depois do merge: a execução da PR é o gate. Um novo push na mesma PR cancela a execução que ainda está em andamento.

O único workflow que roda em push é o [`pages.yml`](../../.github/workflows/pages.yml): é um deploy, não uma verificação. Quando uma mudança no site ou nas docs chega na `main`, ele gera o `apps/site` e publica no GitHub Pages ([apps/site/README.pt-BR.md](../../apps/site/README.pt-BR.md)). O [`docker-cache.yml`](../../.github/workflows/docker-cache.yml) também roda em push, só quando muda algo que a imagem Docker empacota: também não é verificação, só grava o cache de camadas do Docker que o job do PR lê (veja [Caches](#caches)).

Tudo fica em um workflow, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), mais o [`.github/dependabot.yml`](../../.github/dependabot.yml).

## Jobs

| Job | O que verifica | Roda quando a PR mexe em |
| --- | --- | --- |
| **Plan** | Roda os testes dos scripts do CI ([`.github/scripts/test/`](../../.github/scripts/test/)), confere que toda action de terceiros está fixada por SHA de commit ([`check-actions-pinned.mjs`](../../.github/scripts/check-actions-pinned.mjs)), lista os arquivos alterados e decide quais jobs abaixo rodam ([`ci-plan.mjs`](../../.github/scripts/ci-plan.mjs)). | sempre |
| **TS build + tscheck** | `pnpm build` (core, web, o renderizador WASM do canvas, de `crates/render`, com `PAPRIKA_REQUIRE_WASM=1`, e o binário do servidor Go), `pnpm typecheck` (incluindo as suítes de `packages/e2e`). Publica `dist/`, `web-legacy/src/wasm` e o binário Go como o artefato `build` para os jobs abaixo, então a suíte e2e também roda os testes do renderizador WASM. | código TS (incluindo `apps/web`), Go ou Rust |
| **Unit** `<pkg>` (shard n/2) | Vitest de `@paprika/core`, dividido em 2 shards. | `packages/core` |
| **e2e / api vs Go server** | As suítes black-box de `packages/e2e` contra o binário Go: `test:e2e` (canvas no Playwright) e `test:api` (MCP via HTTP e stdio, API HTTP, WebSocket), 2 jobs em paralelo. | e2e: core, `packages/e2e`, `web-legacy`, `crates/render`, `server`; api: core, `packages/e2e`, `server` |
| **Go fixtures up to date** | `pnpm go:golden` e depois `git diff --exit-code` em `server/internal/core/testdata` e `server/contract` (o script de medida). | core, `server` |
| **golangci-lint** | golangci-lint v2 ([`server/.golangci.yml`](../../server/.golangci.yml)) e `go vet`. | `server` |
| **govulncheck** | Vulnerabilidades conhecidas alcançáveis pelo código Go. | `server` |
| **Go test** (shard n/2) | `go test -shuffle=on` nos pacotes afetados, dividido em 2 shards. | `server` |
| **Rust lint / test** | `cargo fmt --check`, clippy (nativo e `wasm32-unknown-unknown`, `-D warnings`), `cargo test`. | `crates/render` |
| **Team sync** | `cargo fmt --check`, clippy (`-D warnings`) e `cargo test` em `crates/sync` (dois sidecars pelo loopback), depois `go test ./internal/team` com `PAPRIKA_SYNC` apontando para o sidecar compilado: duas instâncias reais (store + sidecar) se conectam e compartilham presença. Veja [sincronizacao-time.md](sincronizacao-time.md). | `crates/sync`, `server` |
| **CodeQL** `<linguagem>` | Consultas `security-and-quality` para `actions`, `javascript-typescript`, `go`, `rust`; os resultados vão para o code scanning da PR. | arquivos da linguagem |
| **Docker image** | Faz o build do `Dockerfile` (alvo padrão `runtime`, depois `slim`) com Buildx e cache de camadas no cache do GitHub Actions e roda o [`docker-smoke.sh`](../../.github/scripts/docker-smoke.sh) contra cada um: canvas e asset WASM, `Host` estranho recusado, MCP em `/mcp` (com `render_screenshot` no `runtime`), banco mantido após restart, modo time (sidecar no ar, chave mantida no volume); os dois arquivos do Compose passam pelo `docker compose config`. Veja [docker.md](docker.md). | `Dockerfile`, `.dockerignore`, `compose.yaml`, `compose.team.yaml`, core, `web-legacy`, `crates/render`, `crates/sync`, `server` |
| **Site build** | `astro build` e Pagefind sobre o `apps/site` ([ADR 0006](adr/0006-site-astro.md)): a landing page renderizada do documento do Paprika e todas as páginas das docs. Mudanças só de docs não rodam este job; o workflow do Pages as gera depois do merge. | `apps/site`, `scripts/brand`, core |
| **Secret leak scan** | [gitleaks](https://github.com/gitleaks/gitleaks) em todo o histórico do git (release com checksum fixado, achados mascarados no log, relatório SARIF como artefato em caso de falha). | sempre |
| **CI OK** | Falha se algum job falhou ou foi cancelado. **É o único check a exigir** na proteção de branch: fica verde quando os jobs que rodaram passaram e os pulados foram pulados pelo plano. | sempre |

Uma mudança em `.github/workflows/`, `.github/scripts/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` ou `tsconfig.base.json` roda **tudo**. O label `ci:full` também (vale a partir do próximo push na PR). PRs só de documentação rodam apenas Plan e CI OK.

Os jobs Go instalam o patch mais recente da minor em `GO_VERSION` (no topo do `ci.yml`), e não a linha `go` exata do `server/go.mod`: essa linha é o mínimo que os módulos exigem (por exemplo `go 1.26.0`), e a biblioteca padrão dessa versão reprovaria no govulncheck. Atualize `GO_VERSION` quando o `go.mod` passar para uma nova minor.

## Rodar só o que mudou

A seleção acontece em três níveis:

1. **Por área** ([`ci-plan.mjs`](../../.github/scripts/ci-plan.mjs)): um job é pulado quando a área dele não mudou (tabela acima).
2. **Por arquivo de teste TS**: quando só um pacote mudou, o job de unit dele roda `vitest --changed <base-sha>`, que executa só os arquivos de teste cujo grafo de imports alcança um arquivo alterado. Quando uma *dependência* do pacote mudou, o dependente roda todos os testes, porque o vitest não enxerga a mudança através do `dist/` compilado da dependência (hoje só o `@paprika/core` roda com `--changed`). O `@paprika/web` (`apps/web`) sempre roda todos os testes, porque o teste de arquitetura dele lê arquivos-fonte que nenhum teste importa.
3. **Por pacote Go** ([`go-affected.sh`](../../.github/scripts/go-affected.sh)): os pacotes cujos arquivos mudaram (um arquivo em `testdata/` pertence ao seu pacote) mais todos os pacotes que os importam, incluindo testes. Mudança em `go.mod`/`go.sum` seleciona todos.

Veja o que o CI rodaria para a sua branch:

```bash
node .github/scripts/ci-plan.mjs origin/main HEAD
.github/scripts/go-affected.sh origin/main          # todos os pacotes Go afetados
.github/scripts/go-affected.sh origin/main 1 2      # só o shard 1 de 2
```

### Testar os seletores

Essas regras são código, e uma regra errada significa uma PR que pula em silêncio um job que
ninguém vigiou. A lógica de decisão fica em
[`ci-plan-lib.mjs`](../../.github/scripts/ci-plan-lib.mjs) — função pura: entram os arquivos
alterados e `CI_FULL`, saem as linhas `key=value` — e o
[`ci-plan.mjs`](../../.github/scripts/ci-plan.mjs) é só o CLI em volta dela (o `git diff`, o
ambiente, o `GITHUB_OUTPUT` e o `GITHUB_STEP_SUMMARY`). Os testes em
[`.github/scripts/test/`](../../.github/scripts/test/) descrevem as regras, e o job **Plan** os
roda antes de planejar, sem instalar dependência nenhuma:

```bash
node --test .github/scripts/test/*.mjs
```

O glob, não o diretório: o `node --test` parou de aceitar um diretório como argumento no Node 24.

## Paralelismo e sharding

- Jobs sem dependência entre si rodam ao mesmo tempo: depois do Plan, o build TS, o lint Go, o govulncheck, os testes Go, o Rust e o CodeQL começam juntos; unit, suítes black-box e a verificação de fixtures começam quando o artefato do build existe.
- O vitest usa `--shard=n/2` por pacote; o Go divide a lista ordenada de pacotes em round-robin entre 2 shards.
- As suítes e2e e api rodam como 2 jobs separados, ambas contra o binário Go.
- O Rust roda lint e test como 2 jobs paralelos.

Para aumentar os shards, troque `shard: [1, 2]` na matrix e o `/2` (vitest) ou o `2` passado ao `go-affected.sh` no mesmo job.

## Caches

| O quê | Como | Chave |
| --- | --- | --- |
| Store do pnpm | `actions/setup-node` com `cache: pnpm` (action composta [`setup-node-pnpm`](../../.github/actions/setup-node-pnpm/action.yml)) | `pnpm-lock.yaml` |
| Módulos Go + cache de build/teste | `actions/setup-go` | `server/go.sum` |
| golangci-lint | `golangci-lint-action` | chave própria |
| `target/` e registry do Rust | `Swatinem/rust-cache`, um por tarefa, mais um para o build WASM de release (action composta [`setup-rust-wasm`](../../.github/actions/setup-rust-wasm/action.yml), que também instala o CLI `wasm-bindgen` fixado por checksum) | `Cargo.lock` + toolchain |
| Chromium do Playwright (suítes e2e e api) | `actions/cache` em `~/.cache/ms-playwright` (action composta [`setup-playwright`](../../.github/actions/setup-playwright/action.yml)) | versão do Playwright |
| Saída do build | artefato `build` (`dist/` + binário Go), gerado uma vez e reutilizado por 7+ jobs | por execução |
| Camadas do Docker | Gravado na `main` pelo [`docker-cache.yml`](../../.github/workflows/docker-cache.yml) (`cache-to: type=gha,scope=docker,mode=max`, `outputs: type=cacheonly`); o job do PR só lê (`cache-from`). Um estágio só é refeito quando as entradas dele mudam (o build release do `paprika-sync` sozinho leva ~340 s a frio) | entradas de cada camada |

O GitHub deixa um PR ler os caches da própria ref e da branch base, nunca os de outro PR. Por isso o cache do Docker é gravado a partir da `main`, onde todo PR consegue ler; gravá-lo no PR custava ~210 s por run para entradas que nenhum outro PR usaria.

## Segurança do workflow

- `permissions: contents: read` por padrão; só o CodeQL recebe `security-events: write`.
- Toda action de terceiros fica fixada por SHA de commit com a versão em comentário; o Dependabot atualiza os dois. O job **Plan** cobra isso com o [`check-actions-pinned.mjs`](../../.github/scripts/check-actions-pinned.mjs), que imprime um `file:line` para cada `uses:` que seja tag, branch, SHA curto ou SHA sem comentário de versão (actions locais `./…` e imagens `docker://…` são aceitas). Rode localmente:

  ```bash
  node .github/scripts/check-actions-pinned.mjs
  ```
- `actions/checkout` roda com `persist-credentials: false`.
- `pull_request` (e não `pull_request_target`): PRs de forks rodam sem secrets e com token somente leitura.

## Secrets

O job **Secret leak scan** falha a PR quando o gitleaks encontra uma credencial em qualquer commit alcançável por ela, inclusive uma que um commit posterior removeu: remover não basta, o secret precisa ser **revogado/rotacionado** e, se for o caso, o histórico reescrito.

Para um falso positivo, adicione `gitleaks:allow` num comentário nessa linha, ou o fingerprint do achado (impresso no log do job) num arquivo `.gitleaksignore` na raiz do repositório. Para rodar a mesma checagem localmente:

```bash
gitleaks git --redact -v .
```

O **secret scanning** e o **push protection** do próprio GitHub (gratuitos em repositórios públicos) complementam o job, bloqueando um push com token de provedor conhecido antes de chegar à PR: **Settings → Code security → Secret Protection**.

## Dependabot

Atualizações de versão semanais (segunda-feira) para npm (workspace pnpm), módulos Go (`server`), Cargo (`crates/render`), as imagens base do `Dockerfile` e GitHub Actions, com bumps minor e patch agrupados por ecossistema. `wasm-bindgen` fica de fora porque está fixado com `=` para casar com o `wasm-bindgen-cli` do `crates/render/build.mjs` e do `setup-rust-wasm`. As PRs do Dependabot passam pelo mesmo CI.

Atualizações de segurança (PRs para dependências vulneráveis fora do calendário) são uma configuração do repositório: **Settings → Code security → Dependabot security updates**.

## Proteção de branch (passo manual)

Para bloquear merge com CI vermelho, crie uma regra (ou ruleset) para a `main` em **Settings → Rules** exigindo o status check **CI OK**. Os alertas do CodeQL também aparecem como o check `CodeQL` quando o code scanning está ativo.

Como o CodeQL só roda em PRs, não há análise da própria `main`: os alertas aparecem na PR, e não numa linha de base da branch padrão.
