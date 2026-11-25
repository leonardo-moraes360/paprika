#!/usr/bin/env bash
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
    selected=$(go list -test -f '{{.ImportPath}} {{join .Deps " "}}' ./... |
      awk -v seeds="${!seeds[*]}" '
        BEGIN { n = split(seeds, s, " "); for (i = 1; i <= n; i++) want[s[i]] = 1 }
        {
          pkg = $1; sub(/ \[.*\]$/, "", pkg); sub(/\.test$/, "", pkg); sub(/_test$/, "", pkg)
          for (i = 1; i <= NF; i++) { d = $i; if (d in want) { print pkg; break } }
        }' | sort -u | grep -xF -f <(printf '%s\n' $all) || true)
  fi
fi

printf '%s\n' $selected | { grep -v '^$' || true; } | sort -u | awk -v s="$shard" -v t="$total" '(NR - 1) % t == s - 1'
