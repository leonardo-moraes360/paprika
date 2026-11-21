#!/usr/bin/env bash
# SessionStart hook (Claude Code). Makes the toolbelt CLI (`tb`) available so `tb mem list`,
# `tb verify` and `tb guard` run in every session. See docs/agent-sessions.md.
#
# - Cloud sessions (CLAUDE_CODE_REMOTE=true): installs the pinned tb with `go install` when the
#   binary on PATH is missing or is not exactly the pinned module, then installs the pnpm
#   dependencies `tb verify` needs (only when the lockfile changed since the last install).
# - Local sessions: never installs anything; prints how to install tb if it is missing or stale.
#
# Integrity: `go install` checks the module against sum.golang.org (forced on below), and the
# installed binary must carry the pinned module hash (`go version -m`) or the hook fails.
# To bump tb: change TB_VERSION and TB_SUM together. TB_SUM is the `h1:` line from
#   curl -s https://sum.golang.org/lookup/github.com/leonardo-moraes360/toolbelt@<version>
set -euo pipefail

TB_MODULE=github.com/leonardo-moraes360/toolbelt
TB_VERSION=v0.0.10
TB_SUM=h1:q1ojb4SUqVyDLJgZwse+aRq3+/awVOPm/XKCs5nl3jU=

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$repo"

log() { echo "[session-start] $*" >&2; }

# True when $1 is a tb binary built from exactly the pinned module version and hash.
tb_pinned() {
  [[ -x "$1" ]] || return 1
  go version -m "$1" 2>/dev/null |
    awk -v m="$TB_MODULE" '$1 == "mod" && $2 == m { print $3, $4 }' |
    grep -qxF "$TB_VERSION $TB_SUM"
}

remote=false
[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] && remote=true

if ! command -v go >/dev/null 2>&1; then
  log "go is not installed: cannot check or install tb $TB_VERSION."
  echo "tb is unavailable in this session (no Go toolchain). Do not skip 'tb stack verify guard': report it as not run."
  exit 0
fi

gobin="$(go env GOBIN)"
[[ -n "$gobin" ]] || gobin="$(go env GOPATH)/bin"
on_path="$(command -v tb 2>/dev/null || true)"

if [[ -n "$on_path" ]] && tb_pinned "$on_path"; then
  tb_bin="$on_path"
elif tb_pinned "$gobin/tb"; then
  tb_bin="$gobin/tb"
elif $remote; then
  log "installing $TB_MODULE/cmd/tb@$TB_VERSION into $gobin"
  # Outside any module or workspace, with checksum verification forced on: no GOFLAGS,
  # GONOSUMDB, GOPRIVATE or GOINSECURE from the environment can turn it off. GOTOOLCHAIN=auto
  # fetches the Go version the toolbelt's go.mod asks for (also checksum-verified).
  (
    cd "$(mktemp -d)"
    env GOWORK=off GOFLAGS= GOTOOLCHAIN=auto GOSUMDB=sum.golang.org \
      GONOSUMDB= GONOSUMCHECK= GOPRIVATE= GOINSECURE= GONOPROXY= \
      go install "$TB_MODULE/cmd/tb@$TB_VERSION"
  )
  if ! tb_pinned "$gobin/tb"; then
    log "installed tb does not match $TB_VERSION $TB_SUM; refusing to use it"
    go version -m "$gobin/tb" >&2 || true
    exit 1
  fi
  tb_bin="$gobin/tb"
else
  if [[ -n "$on_path" ]]; then
    found="$(go version -m "$on_path" 2>/dev/null | awk '$1 == "mod" { print $3 }')"
    echo "tb on PATH ($on_path, module version ${found:-unknown}) is not the pinned $TB_VERSION."
  else
    echo "tb is not installed."
  fi
  echo "Install it with: go install $TB_MODULE/cmd/tb@$TB_VERSION (make sure \$(go env GOPATH)/bin is on PATH)."
  exit 0
fi

# Put the pinned tb first on PATH for the rest of the session.
tb_dir="$(dirname "$tb_bin")"
if [[ -n "${CLAUDE_ENV_FILE:-}" ]] && [[ "$(command -v tb 2>/dev/null || true)" != "$tb_bin" ]]; then
  echo "export PATH=\"$tb_dir:\$PATH\"" >>"$CLAUDE_ENV_FILE"
fi

if $remote; then
  # `tb verify` builds and tests the workspace, so it needs node_modules. Install only when
  # the manifests changed since the last successful install.
  hashes=node_modules/.session-start.sha256
  if command -v pnpm >/dev/null 2>&1 && ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    log "pnpm install"
    pnpm install --frozen-lockfile >&2
    sha256sum .claude/hooks/session-start.sh package.json pnpm-lock.yaml pnpm-workspace.yaml \
      packages/*/package.json apps/*/package.json >"$hashes" 2>/dev/null || rm -f "$hashes"
  fi

  # The cloud image ships one Chromium under /opt/pw-browsers whose revision may not match the
  # lockfile's Playwright; the E2E suites and screenshots honour PAPRIKA_CHROMIUM.
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]] && [[ -z "${PAPRIKA_CHROMIUM:-}" ]] && [[ -x /opt/pw-browsers/chromium ]]; then
    echo "export PAPRIKA_CHROMIUM=/opt/pw-browsers/chromium" >>"$CLAUDE_ENV_FILE"
  fi
fi

# Stdout of a SessionStart hook is added to the agent's context.
echo "tb $TB_VERSION is ready ($tb_bin). Run 'tb mem list' before starting and 'tb stack verify guard' before opening a PR (AGENTS.md)."
