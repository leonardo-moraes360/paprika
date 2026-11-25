# Agent sessions and `tb`

Every agent session on this repository must be able to run `tb` (toolbelt), because `AGENTS.md` asks for `tb mem list` before starting and `tb stack verify guard` before a pull request. Cloud sessions start from a fresh container, so the repository installs `tb` itself.

## How it works

`.claude/settings.json` registers a Claude Code `SessionStart` hook, `.claude/hooks/session-start.sh`. It runs on every session start, resume, clear and compact.

| Where | What the hook does |
| --- | --- |
| Cloud session (`CLAUDE_CODE_REMOTE=true`) | If the `tb` on `PATH` (or in `$(go env GOPATH)/bin`) is not exactly the pinned module, runs `go install github.com/leonardo-moraes360/toolbelt/cmd/tb@v1.0.0-rc.3`, puts it on `PATH` through `CLAUDE_ENV_FILE`, runs `pnpm install --frozen-lockfile` when the manifests changed, and sets `PAPRIKA_CHROMIUM=/opt/pw-browsers/chromium` when that browser exists. |
| Local session | Installs nothing. Accepts a `tb` whose module version is the pinned one (a build from a toolbelt checkout has no module hash); otherwise it tells the agent the install command. |

The first run in a new container takes about 30 s (Go downloads the toolchain the toolbelt's `go.mod` asks for, then builds `tb`); later runs check the binary and return in milliseconds. The hook is synchronous, so the session waits for it and `tb` is there from the first turn.

## Integrity

- The version is pinned (`TB_VERSION`) together with its module hash (`TB_SUM`, the `h1:` line from `sum.golang.org`).
- `go install` runs outside any module with checksum verification forced on: `GOSUMDB=sum.golang.org` and `GOFLAGS`, `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE` cleared, so the environment cannot turn it off. The Go toolchain it fetches (`GOTOOLCHAIN=auto`) is verified the same way.
- After installing, the hook reads the module line embedded in the binary (`go version -m`) and fails if it is not `v1.0.0-rc.3` with that exact hash.

`tb version` prints the version for a `go install` build but `commit: unknown` and `embed: unavailable (built without embednative)`: the cloud build has no native embedding engine, so `tb graph search --mode semantic|hybrid` is unavailable there (lexical search, verify, guard and mem work). Use `go version -m "$(command -v tb)"` to see the module version and hash.

## Bumping `tb`

1. Get the hash: `curl -s https://sum.golang.org/lookup/github.com/leonardo-moraes360/toolbelt@<version>` (the line without `/go.mod`).
2. Change `TB_VERSION` and `TB_SUM` together in `.claude/hooks/session-start.sh`, and the version in `AGENTS.md`.
3. Check locally: `CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE=/dev/null .claude/hooks/session-start.sh`.

## When `tb` still isn't available

If the hook fails (for example, the network policy blocks `proxy.golang.org` or `sum.golang.org`), do not skip the gate silently: run the same checks by hand (`pnpm check`, invariants from `.toolbelt/invariants.yaml`) and write in the pull request that `tb stack verify guard` did not run and why.
