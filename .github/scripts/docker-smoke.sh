#!/usr/bin/env bash
# Smoke test of a built Paprika image (Dockerfile): starts a container on a fresh volume and checks,
# over plain HTTP, the canvas, the WASM renderer asset, MCP over /mcp (initialize, tools/list, a
# write, render_screenshot) and that the SQLite database survives a container restart.
#
#   .github/scripts/docker-smoke.sh paprika:dev            # default (runtime) target
#   SCREENSHOT=0 .github/scripts/docker-smoke.sh paprika:slim  # slim target: no Chromium
#
# Needs docker, curl and node (for JSON). Used by the `docker` job of .github/workflows/ci.yml.
set -euo pipefail

image="${1:?usage: docker-smoke.sh IMAGE}"
port="${PORT:-4777}"
screenshot="${SCREENSHOT:-1}"
name="paprika-smoke-$$"
volume="paprika-smoke-$$"
base="http://127.0.0.1:${port}"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm -f "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$name" >&2 || true
  exit 1
}

start() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p "127.0.0.1:${port}:4777" -v "${volume}:/data" "$image" >/dev/null
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "$base/" 2>/dev/null && return 0
    sleep 0.2
  done
  fail "server did not answer on $base"
}

# json EXPR: evaluates a JS expression over the JSON on stdin (bound to `r`) and prints it.
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const v=('"$1"');process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})'; }

session=""
mcp() {
  local headers
  headers=$(mktemp)
  local body
  body=$(curl -fsS -D "$headers" "$base/mcp" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    ${session:+-H "Mcp-Session-Id: $session"} -d "$1") || fail "POST /mcp: $1"
  local sid
  sid=$(tr -d '\r' <"$headers" | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}')
  rm -f "$headers"
  [[ -n "$sid" ]] && session="$sid"
  printf '%s' "$body"
}

tool() { mcp "{\"jsonrpc\":\"2.0\",\"id\":$1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}"; }

init() {
  session=""
  mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"docker-smoke","version":"1"}}}' >/dev/null
  mcp '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null || true
}

start

# Canvas: index.html, and the WASM renderer built into it (served as application/wasm).
html=$(curl -fsS "$base/") || fail "GET /"
grep -q '<title>Paprika</title>' <<<"$html" || fail "GET / is not the canvas"
echo "ok   GET / (canvas)"
js=$(grep -o '/assets/index-[^"]*\.js' <<<"$html" | head -1)
[[ -n "$js" ]] || fail "no script in index.html"
# The renderer's JS chunk names the .wasm file (hashed by Vite); works on distroless too.
chunk=$(curl -fsS "$base$js" | grep -o 'paprika_render-[A-Za-z0-9_-]*\.js' | head -1)
[[ -n "$chunk" ]] || fail "WASM renderer chunk not in the canvas build"
wasm=$(curl -fsS "$base/assets/$chunk" | grep -o 'paprika_render_bg-[A-Za-z0-9_-]*\.wasm' | head -1)
[[ -n "$wasm" ]] || fail "WASM file not referenced by $chunk"
wasm_type=$(curl -fsS -o /dev/null -w '%{content_type}' "$base/assets/$wasm") || fail "GET /assets/$wasm"
[[ "$wasm_type" = "application/wasm" ]] || fail "WASM served as $wasm_type"
echo "ok   GET /assets/$wasm ($wasm_type)"

# Host check survives the container: a foreign Host is refused.
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example:4777' "$base/")
[[ "$code" = "403" ]] || fail "foreign Host answered $code, expected 403"
echo "ok   foreign Host -> 403"

# MCP over HTTP.
init
tools=$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | json 'r.result.tools.length')
[[ "$tools" -ge 17 ]] || fail "tools/list returned $tools tools"
echo "ok   /mcp initialize + tools/list ($tools tools)"

created=$(tool 3 create_nodes '{"nodes":[{"type":"frame","name":"Docker smoke","x":0,"y":0,"width":320,"height":200,"fill":"#e4572e","children":[{"type":"text","name":"Hello","text":"Hello from Docker","x":24,"y":24,"fontSize":24,"color":"#ffffff"}]}]}')
[[ "$(json 'r.result.isError ? "error" : "ok"' <<<"$created")" = ok ]] || fail "create_nodes: $created"
root=$(json 'r.result.structuredContent.ids?.[0] ?? r.result.structuredContent.created?.[0] ?? ""' <<<"$created")
echo "ok   /mcp create_nodes ($root)"

if [[ "$screenshot" = "1" ]]; then
  shot=$(tool 4 render_screenshot "{\"rootId\":\"$root\"}")
  kind=$(json '(r.result.content||[]).map(c=>c.type+":"+(c.mimeType||"")).join(",")' <<<"$shot")
  grep -q 'image:image/png' <<<"$kind" || fail "render_screenshot returned $kind: $(head -c 400 <<<"$shot")"
  bytes=$(json 'Buffer.from(r.result.content.find(c=>c.type==="image").data,"base64").length' <<<"$shot")
  echo "ok   /mcp render_screenshot (PNG, $bytes bytes)"
fi

# Persistence: the node is still there after the container is recreated on the same volume.
start
init
outline=$(tool 5 get_document_outline '{}')
grep -q 'Docker smoke' <<<"$outline" || fail "node lost after restart: $(head -c 400 <<<"$outline")"
echo "ok   SQLite on the volume survives a restart"

echo "docker smoke: all checks passed for $image"
