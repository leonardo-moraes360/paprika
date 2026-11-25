#!/usr/bin/env bash
# Prints the Go packages (under server/) that a change can affect: the packages whose files
# changed plus every package that imports them, directly or not. Optionally keeps one shard.
#
# Usage: .github/scripts/go-affected.sh <base-sha> [shard-index total-shards]
#   CI_FULL=1, or a change to go.mod / go.sum, selects every package.
# Run from the repository root. Shards are 1-based and split the sorted list round-robin.
set -euo pipefail

base=${1:?usage: go-affected.sh <base-sha> [shard total]}
shard=${2:-1}
total=${3:-1}

cd server
module=$(go list -m)
all=$(go list ./...)

changed=$(git diff --name-only "$base" HEAD -- . | sed 's#^server/##')

if [[ "${CI_FULL:-0}" == "1" ]] || grep -qxE 'go\.(mod|sum)' <<<"$changed"; then
  selected=$all
else
  # Map each changed file to the package that owns it: the nearest directory, walking up, that
  # is a Go package (this sends testdata/ and embedded files to their package).
  declare -A seeds=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    dir=$(dirname "$f")
    while :; do
      pkg="$module"
      [[ "$dir" != "." ]] && pkg="$module/$dir"
      if grep -qxF "$pkg" <<<"$all"; then
        seeds[$pkg]=1
        break
      fi
      [[ "$dir" == "." ]] && break
      dir=$(dirname "$dir")
    done
  done <<<"$changed"

  selected=""
  if ((${#seeds[@]} > 0)); then
    # A package is affected when it is a seed or depends (transitively, tests included) on one.
    selected=$(go list -test -f '{{.ImportPath}} {{join .Deps " "}}' ./... |
      awk -v seeds="${!seeds[*]}" '
        BEGIN { n = split(seeds, s, " "); for (i = 1; i <= n; i++) want[s[i]] = 1 }
        {
          pkg = $1; sub(/ \[.*\]$/, "", pkg); sub(/\.test$/, "", pkg); sub(/_test$/, "", pkg)
          for (i = 1; i <= NF; i++) { d = $i; if (d in want) { print pkg; break } }
        }' | sort -u | grep -xF -f <(printf '%s\n' $all) || true)
  fi
fi

# An empty selection is a normal answer (a change under server/ that touches no Go package), so
# the `grep -v` that drops the blank line must not decide the exit status of the pipeline.
printf '%s\n' $selected | { grep -v '^$' || true; } | sort -u | awk -v s="$shard" -v t="$total" '(NR - 1) % t == s - 1'
