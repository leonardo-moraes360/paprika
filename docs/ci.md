# CI

> Português: [docs/pt-BR/ci.md](pt-BR/ci.md)

Paprika's CI runs **only on pull requests** (`opened`, `synchronize`, `reopened`, `ready_for_review`). Nothing runs on push or after a merge: the PR run is the gate. A new push to the same PR cancels the run still in progress.

The one workflow that runs on push is [`pages.yml`](../.github/workflows/pages.yml): it is a deployment, not a check. When a change to the site or the docs reaches `main`, it builds `apps/site` and publishes it to GitHub Pages ([apps/site/README.md](../apps/site/README.md)).

Everything lives in one workflow, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), plus [`.github/dependabot.yml`](../.github/dependabot.yml).

## Jobs

| Job | What it checks | Runs when the PR touches |
| --- | --- | --- |
| **Plan** | Runs the tests of the CI scripts ([`.github/scripts/test/`](../.github/scripts/test/)), checks that every third-party action is pinned to a commit SHA ([`check-actions-pinned.mjs`](../.github/scripts/check-actions-pinned.mjs)), lists the changed files and decides which jobs below run ([`ci-plan.mjs`](../.github/scripts/ci-plan.mjs)). | always |
| **TS build + tscheck** | `pnpm build` (core, web, the WASM canvas renderer from `crates/render` with `PAPRIKA_REQUIRE_WASM=1`, and the Go server binary), `pnpm typecheck` (including the `packages/e2e` suites). Uploads `dist/`, `apps/web/src/wasm` and the Go binary as the `build` artifact for the jobs below, so the e2e suite also runs the WASM renderer tests. | TS, Go or Rust code |
| **Unit** `<pkg>` (shard n/2) | Vitest for `@paprika/core`, split in 2 shards. | `packages/core` |
| **e2e / api vs Go server** | The black-box suites of `packages/e2e` against the Go binary: `test:e2e` (canvas in Playwright) and `test:api` (MCP over HTTP and stdio, HTTP API, WebSocket), 2 jobs in parallel. | e2e: core, `packages/e2e`, web, `crates/render`, `server`; api: core, `packages/e2e`, `server` |
| **Go fixtures up to date** | `pnpm go:golden` then `git diff --exit-code` on `server/internal/core/testdata` and `server/contract` (the measure script). | core, `server` |
| **golangci-lint** | golangci-lint v2 ([`server/.golangci.yml`](../server/.golangci.yml)) and `go vet`. | `server` |
| **govulncheck** | Known vulnerabilities reachable from the Go code. | `server` |
| **Go test** (shard n/2) | `go test -shuffle=on` on the affected packages, split in 2 shards. | `server` |
| **Rust lint / test** | `cargo fmt --check`, clippy (native and `wasm32-unknown-unknown`, `-D warnings`), `cargo test`. | `crates/render` |
| **Team sync** | `cargo fmt --check`, clippy (`-D warnings`) and `cargo test` in `crates/sync` (two sidecars over loopback), then `go test ./internal/team` with `PAPRIKA_SYNC` pointing at the built sidecar: two real instances (store + sidecar) connect and share presence. See [team-sync.md](team-sync.md). | `crates/sync`, `server` |
| **CodeQL** `<language>` | `security-and-quality` queries for `actions`, `javascript-typescript`, `go`, `rust`; results go to the PR's code scanning. | the language's files |
| **Docker image** | Builds the `Dockerfile` (default `runtime` target, then `slim`) with Buildx and a layer cache in the GitHub Actions cache, and runs [`docker-smoke.sh`](../.github/scripts/docker-smoke.sh) against each: canvas and WASM asset, foreign `Host` refused, MCP over `/mcp` (with `render_screenshot` on `runtime`), database kept across a restart, team mode (sidecar up, key kept on the volume); both Compose files are checked with `docker compose config`. See [docker.md](docker.md). | `Dockerfile`, `.dockerignore`, `compose.yaml`, `compose.team.yaml`, core, web, `crates/render`, `crates/sync`, `server` |
| **Secret leak scan** | [gitleaks](https://github.com/gitleaks/gitleaks) over the whole git history (checksum-pinned release, findings redacted in the log, SARIF report as an artifact on failure). | always |
| **CI OK** | Fails if any job failed or was cancelled. **This is the one check to require** in branch protection: it is green when the jobs that ran passed and the ones skipped were skipped by the plan. | always |

A change to `.github/workflows/`, `.github/scripts/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `tsconfig.base.json` runs **everything**. So does the `ci:full` label (applied on the next push to the PR). Docs-only PRs run only Plan and CI OK.

Go jobs install the latest patch of the minor in `GO_VERSION` (top of `ci.yml`), not the exact `go` line of `server/go.mod`: that line is the minimum the modules need (for example `go 1.26.0`), and its standard library would fail govulncheck. Bump `GO_VERSION` when `go.mod` moves to a new minor.

## Running only what changed

Selection works at three levels:

1. **Per area** ([`ci-plan.mjs`](../.github/scripts/ci-plan.mjs)): a job is skipped when its area did not change (table above).
2. **Per TS test file**: when only one package changed, its unit job runs `vitest --changed <base-sha>`, which runs just the test files whose import graph reaches a changed file. When a package's *dependency* changed, the dependent runs all of its tests, because vitest cannot follow a change through the dependency's built `dist/` (today only `@paprika/core` has unit tests).
3. **Per Go package** ([`go-affected.sh`](../.github/scripts/go-affected.sh)): the packages whose files changed (a `testdata/` file belongs to its package) plus every package that imports them, tests included. A change to `go.mod`/`go.sum` selects all packages.

See what CI would run for your branch:

```bash
node .github/scripts/ci-plan.mjs origin/main HEAD
.github/scripts/go-affected.sh origin/main          # all affected Go packages
.github/scripts/go-affected.sh origin/main 1 2      # only shard 1 of 2
```

### Testing the selectors

These rules are code, and a wrong rule means a PR that quietly skips a job nobody watched. The
decision logic lives in [`ci-plan-lib.mjs`](../.github/scripts/ci-plan-lib.mjs) — a pure function:
changed files plus `CI_FULL` in, the `key=value` outputs out — and
[`ci-plan.mjs`](../.github/scripts/ci-plan.mjs) is only the CLI around it (the `git diff`, the
environment, `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY`). The tests in
[`.github/scripts/test/`](../.github/scripts/test/) describe the rules, and the **Plan** job runs
them before planning, with no dependencies to install:

```bash
node --test .github/scripts/test/*.mjs
```

The glob, not the directory: `node --test` stopped accepting a bare directory argument in Node 24.

## Parallelism and sharding

- Jobs without dependencies between them run at the same time: after Plan, the TS build, Go lint, govulncheck, Go tests, Rust and CodeQL start together; unit tests, the black-box suites and the fixture check start once the build artifact exists.
- Vitest uses `--shard=n/2` per package; Go splits the sorted package list round-robin across 2 shards.
- The e2e and api suites run as 2 separate jobs, both against the Go binary.
- Rust runs lint and test as 2 parallel jobs.

To add shards, change `shard: [1, 2]` in the matrix and the `/2` (vitest) or the `2` passed to `go-affected.sh` in the same job.

## Caches

| What | How | Key |
| --- | --- | --- |
| pnpm store | `actions/setup-node` with `cache: pnpm` (composite action [`setup-node-pnpm`](../.github/actions/setup-node-pnpm/action.yml)) | `pnpm-lock.yaml` |
| Go modules + build/test cache | `actions/setup-go` | `server/go.sum` |
| golangci-lint | `golangci-lint-action` | its own key |
| Rust `target/` and registry | `Swatinem/rust-cache`, one per task, plus one for the release WASM build (composite action [`setup-rust-wasm`](../.github/actions/setup-rust-wasm/action.yml), which also installs the checksum-pinned `wasm-bindgen` CLI) | `Cargo.lock` + toolchain |
| Playwright Chromium (e2e and api suites) | `actions/cache` on `~/.cache/ms-playwright` (composite action [`setup-playwright`](../.github/actions/setup-playwright/action.yml)) | Playwright version |
| Build output | `build` artifact (`dist/` + Go binary), built once and reused by 7+ jobs | per run |
| Docker layers | `docker/build-push-action` with `cache-from`/`cache-to: type=gha,scope=docker,mode=max`: a stage is rebuilt only when its inputs change (the cold release build of `paprika-sync` alone is ~340 s) | each layer's inputs |

GitHub keeps a cache entry made by a PR for that PR (plus caches of its base branch), and nothing runs on `main`, so the **first run of each PR starts cold** and the next pushes to it hit.

## Security of the workflow

- `permissions: contents: read` by default; only CodeQL gets `security-events: write`.
- Every third-party action is pinned by commit SHA with the version in a comment; Dependabot updates both. The **Plan** job enforces it with [`check-actions-pinned.mjs`](../.github/scripts/check-actions-pinned.mjs), which prints one `file:line` per `uses:` that is a tag, a branch, a short SHA or a SHA without its version comment (local `./…` actions and `docker://…` images are fine). Run it locally:

  ```bash
  node .github/scripts/check-actions-pinned.mjs
  ```
- `actions/checkout` runs with `persist-credentials: false`.
- `pull_request` (not `pull_request_target`): PRs from forks run without secrets and with a read-only token.

## Secrets

The **Secret leak scan** job fails the PR when gitleaks finds a credential in any commit reachable from it, including one that a later commit removed: removing it is not enough, the secret must be **revoked/rotated**, and then the history rewritten if needed.

For a false positive, add `gitleaks:allow` in a comment on that line, or add the finding's fingerprint (printed in the job log) to a `.gitleaksignore` file at the repository root. Run the same check locally:

```bash
gitleaks git --redact -v .
```

GitHub's own **secret scanning** and **push protection** (free on public repositories) complement it by blocking a push that contains a known provider's token before it reaches a PR: **Settings → Code security → Secret Protection**.

## Dependabot

Weekly (Monday) version updates for npm (pnpm workspace), Go modules (`server`), Cargo (`crates/render`), the `Dockerfile` base images and GitHub Actions, with minor and patch bumps grouped per ecosystem. `wasm-bindgen` is excluded because it is pinned with `=` to match `wasm-bindgen-cli` in `crates/render/build.mjs` and `setup-rust-wasm`. Dependabot PRs go through the same CI.

Security updates (PRs for vulnerable dependencies outside the schedule) are a repository setting: **Settings → Code security → Dependabot security updates**.

## Branch protection (manual step)

To block merges on a red CI, add a rule (or ruleset) for `main` in **Settings → Rules** that requires the **CI OK** status check. CodeQL alerts also appear as the `CodeQL` check when code scanning is on.

Because CodeQL only runs on PRs, `main` itself is never analyzed: alerts are listed on the PR rather than in a baseline for the default branch.
