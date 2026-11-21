# CI

> Português: [docs/pt-BR/ci.md](pt-BR/ci.md)

Paprika's CI runs **only on pull requests** (`opened`, `synchronize`, `reopened`, `ready_for_review`). Nothing runs on push or after a merge: the PR run is the gate. A new push to the same PR cancels the run still in progress.

Everything lives in one workflow, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), plus [`.github/dependabot.yml`](../.github/dependabot.yml).

## Jobs

| Job | What it checks | Runs when the PR touches |
| --- | --- | --- |
| **Plan** | Lists the changed files and decides which jobs below run ([`ci-plan.mjs`](../.github/scripts/ci-plan.mjs)). | always |
| **TS build + tscheck** | `pnpm build` (core, server, web), `pnpm typecheck`, `pnpm go:build`. Uploads `dist/` and the Go binary as the `build` artifact for the jobs below. | TS or Go code |
| **Unit** `<pkg>` (shard n/2) | Vitest for `@paprika/core` and `@paprika/server`, split in 2 shards. | `packages/core`, `packages/server` |
| **e2e / parity vs ts / go server** | The black-box suites (`test:e2e`, `test:parity`) against the TypeScript server and against the Go binary, 4 jobs in parallel. | core, server, web, examples, `server-go` |
| **Go fixtures up to date** | `pnpm go:golden` then `git diff --exit-code` on `server-go/internal/core/testdata` and `server-go/contract`. | core, server, `server-go` |
| **golangci-lint** | golangci-lint v2 ([`server-go/.golangci.yml`](../server-go/.golangci.yml)) and `go vet`. | `server-go` |
| **govulncheck** | Known vulnerabilities reachable from the Go code. | `server-go` |
| **Go test** (shard n/2) | `go test -shuffle=on` on the affected packages, split in 2 shards. | `server-go` |
| **Rust lint / test** | `cargo fmt --check`, clippy (native and `wasm32-unknown-unknown`, `-D warnings`), `cargo test`. | `experiments/canvas-wasm` (src, Cargo files, build.sh) |
| **CodeQL** `<language>` | `security-and-quality` queries for `actions`, `javascript-typescript`, `go`, `rust`; results go to the PR's code scanning. | the language's files |
| **CI OK** | Fails if any job failed or was cancelled. **This is the one check to require** in branch protection: it is green when the jobs that ran passed and the ones skipped were skipped by the plan. | always |

A change to `.github/workflows/`, `.github/scripts/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `tsconfig.base.json` runs **everything**. So does the `ci:full` label (applied on the next push to the PR). Docs-only PRs run only Plan and CI OK.

## Running only what changed

Selection works at three levels:

1. **Per area** ([`ci-plan.mjs`](../.github/scripts/ci-plan.mjs)): a job is skipped when its area did not change (table above).
2. **Per TS test file**: when only one package changed, its unit job runs `vitest --changed <base-sha>`, which runs just the test files whose import graph reaches a changed file. When a package's *dependency* changed (core → server), the dependent runs all of its tests, because vitest cannot follow a change through the dependency's built `dist/`.
3. **Per Go package** ([`go-affected.sh`](../.github/scripts/go-affected.sh)): the packages whose files changed (a `testdata/` file belongs to its package) plus every package that imports them, tests included. A change to `go.mod`/`go.sum` selects all packages.

See what CI would run for your branch:

```bash
node .github/scripts/ci-plan.mjs origin/main HEAD
.github/scripts/go-affected.sh origin/main          # all affected Go packages
.github/scripts/go-affected.sh origin/main 1 2      # only shard 1 of 2
```

## Parallelism and sharding

- Jobs without dependencies between them run at the same time: after Plan, the TS build, Go lint, govulncheck, Go tests, Rust and CodeQL start together; unit tests, the black-box suites and the fixture check start once the build artifact exists.
- Vitest uses `--shard=n/2` per package; Go splits the sorted package list round-robin across 2 shards.
- The e2e and parity suites run as 4 separate jobs (suite × server implementation).
- Rust runs lint and test as 2 parallel jobs.

To add shards, change `shard: [1, 2]` in the matrix and the `/2` (vitest) or the `2` passed to `go-affected.sh` in the same job.

## Caches

| What | How | Key |
| --- | --- | --- |
| pnpm store | `actions/setup-node` with `cache: pnpm` (composite action [`setup-node-pnpm`](../.github/actions/setup-node-pnpm/action.yml)) | `pnpm-lock.yaml` |
| Go modules + build/test cache | `actions/setup-go` | `server-go/go.sum` |
| golangci-lint | `golangci-lint-action` | its own key |
| Rust `target/` and registry | `Swatinem/rust-cache`, one per task | `Cargo.lock` + toolchain |
| Playwright Chromium | `actions/cache` on `~/.cache/ms-playwright` | Playwright version |
| Build output | `build` artifact (`dist/` + Go binary), built once and reused by 7+ jobs | per run |

## Security of the workflow

- `permissions: contents: read` by default; only CodeQL gets `security-events: write`.
- Every third-party action is pinned by commit SHA with the version in a comment; Dependabot updates both.
- `actions/checkout` runs with `persist-credentials: false`.
- `pull_request` (not `pull_request_target`): PRs from forks run without secrets and with a read-only token.

## Dependabot

Weekly (Monday) version updates for npm (pnpm workspace), Go modules (`server-go`), Cargo (`experiments/canvas-wasm`) and GitHub Actions, with minor and patch bumps grouped per ecosystem. `wasm-bindgen` is excluded because it is pinned with `=` to match `wasm-bindgen-cli` in `build.sh`. Dependabot PRs go through the same CI.

Security updates (PRs for vulnerable dependencies outside the schedule) are a repository setting: **Settings → Code security → Dependabot security updates**.

## Branch protection (manual step)

To block merges on a red CI, add a rule (or ruleset) for `main` in **Settings → Rules** that requires the **CI OK** status check. CodeQL alerts also appear as the `CodeQL` check when code scanning is on.

Because CodeQL only runs on PRs, `main` itself is never analyzed: alerts are listed on the PR rather than in a baseline for the default branch.
