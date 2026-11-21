# CI

> English: [docs/ci.md](../ci.md)

O CI do Paprika roda **apenas em pull requests** (`opened`, `synchronize`, `reopened`, `ready_for_review`). Nada roda em push nem depois do merge: a execução da PR é o gate. Um novo push na mesma PR cancela a execução que ainda está em andamento.

O único workflow que roda em push é o [`pages.yml`](../../.github/workflows/pages.yml): é um deploy, não uma verificação. Quando uma mudança no site ou nas docs chega na `main`, ele gera o `apps/site` e publica no GitHub Pages ([apps/site/README.pt-BR.md](../../apps/site/README.pt-BR.md)).

Tudo fica em um workflow, [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), mais o [`.github/dependabot.yml`](../../.github/dependabot.yml).

## Jobs

| Job | O que verifica | Roda quando a PR mexe em |
| --- | --- | --- |
| **Plan** | Lista os arquivos alterados e decide quais jobs abaixo rodam ([`ci-plan.mjs`](../../.github/scripts/ci-plan.mjs)). | sempre |
| **TS build + tscheck** | `pnpm build` (core, server, web e o renderizador WASM do canvas, de `crates/render`, com `PAPRIKA_REQUIRE_WASM=1`), `pnpm typecheck`, `pnpm go:build`. Publica `dist/`, `apps/web/src/wasm` e o binário Go como o artefato `build` para os jobs abaixo, então as suítes e2e também rodam os testes do renderizador WASM. | código TS, Go ou Rust |
| **Unit** `<pkg>` (shard n/2) | Vitest de `@paprika/core` e `@paprika/server`, dividido em 2 shards. | `packages/core`, `packages/server` |
| **e2e / parity vs ts / go server** | As suítes black-box (`test:e2e`, `test:parity`) contra o servidor TypeScript e contra o binário Go, 4 jobs em paralelo. | core, server, web, examples, `crates/render`, `server-go` |
| **Go fixtures up to date** | `pnpm go:golden` e depois `git diff --exit-code` em `server-go/internal/core/testdata` e `server-go/contract`. | core, server, `server-go` |
| **golangci-lint** | golangci-lint v2 ([`server-go/.golangci.yml`](../../server-go/.golangci.yml)) e `go vet`. | `server-go` |
| **govulncheck** | Vulnerabilidades conhecidas alcançáveis pelo código Go. | `server-go` |
| **Go test** (shard n/2) | `go test -shuffle=on` nos pacotes afetados, dividido em 2 shards. | `server-go` |
| **Rust lint / test** | `cargo fmt --check`, clippy (nativo e `wasm32-unknown-unknown`, `-D warnings`), `cargo test`. | `crates/render` |
| **CodeQL** `<linguagem>` | Consultas `security-and-quality` para `actions`, `javascript-typescript`, `go`, `rust`; os resultados vão para o code scanning da PR. | arquivos da linguagem |
| **Secret leak scan** | [gitleaks](https://github.com/gitleaks/gitleaks) em todo o histórico do git (release com checksum fixado, achados mascarados no log, relatório SARIF como artefato em caso de falha). | sempre |
| **CI OK** | Falha se algum job falhou ou foi cancelado. **É o único check a exigir** na proteção de branch: fica verde quando os jobs que rodaram passaram e os pulados foram pulados pelo plano. | sempre |

Uma mudança em `.github/workflows/`, `.github/scripts/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` ou `tsconfig.base.json` roda **tudo**. O label `ci:full` também (vale a partir do próximo push na PR). PRs só de documentação rodam apenas Plan e CI OK.

Os jobs Go instalam o patch mais recente da minor em `GO_VERSION` (no topo do `ci.yml`), e não a linha `go` exata do `server-go/go.mod`: essa linha é o mínimo que os módulos exigem (por exemplo `go 1.26.0`), e a biblioteca padrão dessa versão reprovaria no govulncheck. Atualize `GO_VERSION` quando o `go.mod` passar para uma nova minor.

## Rodar só o que mudou

A seleção acontece em três níveis:

1. **Por área** ([`ci-plan.mjs`](../../.github/scripts/ci-plan.mjs)): um job é pulado quando a área dele não mudou (tabela acima).
2. **Por arquivo de teste TS**: quando só um pacote mudou, o job de unit dele roda `vitest --changed <base-sha>`, que executa só os arquivos de teste cujo grafo de imports alcança um arquivo alterado. Quando uma *dependência* do pacote mudou (core → server), o dependente roda todos os testes, porque o vitest não enxerga a mudança através do `dist/` compilado da dependência.
3. **Por pacote Go** ([`go-affected.sh`](../../.github/scripts/go-affected.sh)): os pacotes cujos arquivos mudaram (um arquivo em `testdata/` pertence ao seu pacote) mais todos os pacotes que os importam, incluindo testes. Mudança em `go.mod`/`go.sum` seleciona todos.

Veja o que o CI rodaria para a sua branch:

```bash
node .github/scripts/ci-plan.mjs origin/main HEAD
.github/scripts/go-affected.sh origin/main          # todos os pacotes Go afetados
.github/scripts/go-affected.sh origin/main 1 2      # só o shard 1 de 2
```

## Paralelismo e sharding

- Jobs sem dependência entre si rodam ao mesmo tempo: depois do Plan, o build TS, o lint Go, o govulncheck, os testes Go, o Rust e o CodeQL começam juntos; unit, suítes black-box e a verificação de fixtures começam quando o artefato do build existe.
- O vitest usa `--shard=n/2` por pacote; o Go divide a lista ordenada de pacotes em round-robin entre 2 shards.
- As suítes e2e e parity rodam como 4 jobs separados (suíte × implementação do servidor).
- O Rust roda lint e test como 2 jobs paralelos.

Para aumentar os shards, troque `shard: [1, 2]` na matrix e o `/2` (vitest) ou o `2` passado ao `go-affected.sh` no mesmo job.

## Caches

| O quê | Como | Chave |
| --- | --- | --- |
| Store do pnpm | `actions/setup-node` com `cache: pnpm` (action composta [`setup-node-pnpm`](../../.github/actions/setup-node-pnpm/action.yml)) | `pnpm-lock.yaml` |
| Módulos Go + cache de build/teste | `actions/setup-go` | `server-go/go.sum` |
| golangci-lint | `golangci-lint-action` | chave própria |
| `target/` e registry do Rust | `Swatinem/rust-cache`, um por tarefa, mais um para o build WASM de release (action composta [`setup-rust-wasm`](../../.github/actions/setup-rust-wasm/action.yml), que também instala o CLI `wasm-bindgen` fixado por checksum) | `Cargo.lock` + toolchain |
| Chromium do Playwright (unit do server, e2e) | `actions/cache` em `~/.cache/ms-playwright` (action composta [`setup-playwright`](../../.github/actions/setup-playwright/action.yml)) | versão do Playwright |
| Saída do build | artefato `build` (`dist/` + binário Go), gerado uma vez e reutilizado por 7+ jobs | por execução |

## Segurança do workflow

- `permissions: contents: read` por padrão; só o CodeQL recebe `security-events: write`.
- Toda action de terceiros fica fixada por SHA de commit com a versão em comentário; o Dependabot atualiza os dois.
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

Atualizações de versão semanais (segunda-feira) para npm (workspace pnpm), módulos Go (`server-go`), Cargo (`crates/render`) e GitHub Actions, com bumps minor e patch agrupados por ecossistema. `wasm-bindgen` fica de fora porque está fixado com `=` para casar com o `wasm-bindgen-cli` do `crates/render/build.mjs` e do `setup-rust-wasm`. As PRs do Dependabot passam pelo mesmo CI.

Atualizações de segurança (PRs para dependências vulneráveis fora do calendário) são uma configuração do repositório: **Settings → Code security → Dependabot security updates**.

## Proteção de branch (passo manual)

Para bloquear merge com CI vermelho, crie uma regra (ou ruleset) para a `main` em **Settings → Rules** exigindo o status check **CI OK**. Os alertas do CodeQL também aparecem como o check `CodeQL` quando o code scanning está ativo.

Como o CodeQL só roda em PRs, não há análise da própria `main`: os alertas aparecem na PR, e não numa linha de base da branch padrão.
