#!/usr/bin/env bash
set -euo pipefail

# usage: docker-smoke.sh IMAGE
#   SCREENSHOT=0  the image has no Chrome (`slim`): skip render_screenshot
#   TEAM=0        the image has no paprika-sync (`slim`): skip team mode (default: same as SCREENSHOT)
#   HARDEN=0      run without --read-only, --cap-drop=ALL and no-new-privileges (default: hardened,
#                 which is how docs/en-US/docker.md says to run it)
#   PORT          host port (default 4777: the server only accepts Host/Origin localhost:4777)
image="${1:?usage: docker-smoke.sh IMAGE}"
port="${PORT:-4777}"
screenshot="${SCREENSHOT:-1}"
team="${TEAM:-$screenshot}"
harden="${HARDEN:-1}"
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

run_flags=(--health-interval 2s --health-start-period 1s --health-timeout 3s)
if [[ "$harden" = "1" ]]; then
  # /data is the volume; /tmp is where Chrome keeps its profile. Nothing else is writable.
  run_flags+=(--read-only --tmpfs /tmp:rw,size=256m,mode=1777 --cap-drop=ALL --security-opt no-new-privileges
              --pids-limit 512 --memory 1g)
fi

start() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" "${run_flags[@]}" -p "127.0.0.1:${port}:4777" -v "${volume}:/data" "$image" "$@" >/dev/null
  for _ in $(seq 1 50); do
    curl -fsS -o /dev/null "$base/" 2>/dev/null && return 0
    sleep 0.2
  done
  fail "server did not answer on $base"
}

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

# --- image properties that need no running container
user=$(docker image inspect -f '{{.Config.User}}' "$image")
[[ "$user" =~ ^[1-9][0-9]*(:[1-9][0-9]*)?$ ]] || fail "image user is '$user', expected a numeric non-root uid"
echo "ok   image user is $user (numeric, not root)"
for sh in /bin/sh /bin/bash /usr/bin/sh /busybox/sh; do
  if docker run --rm --entrypoint "$sh" "$image" -c true >/dev/null 2>&1; then fail "the image has a shell ($sh)"; fi
done
echo "ok   no shell in the image"
[[ -n "$(docker image inspect -f '{{if .Config.Healthcheck}}x{{end}}' "$image")" ]] || fail "image has no HEALTHCHECK"
echo "ok   image declares a HEALTHCHECK"

start

# --- the container as it runs
health=""
for _ in $(seq 1 40); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [[ "$health" = healthy ]] && break
  sleep 0.5
done
[[ "$health" = healthy ]] || fail "HEALTHCHECK says '$health'"
echo "ok   HEALTHCHECK: healthy"
pid=$(docker inspect -f '{{.State.Pid}}' "$name")
if [[ -r "/proc/$pid/status" ]]; then
  uid=$(awk '/^Uid:/{print $3}' "/proc/$pid/status")
  [[ "$uid" != 0 ]] || fail "the server runs as uid 0"
  echo "ok   server process runs as uid $uid"
  if [[ "$harden" = "1" ]]; then
    capeff=$(awk '/^CapEff:/{print $2}' "/proc/$pid/status")
    capbnd=$(awk '/^CapBnd:/{print $2}' "/proc/$pid/status")
    [[ "$capeff$capbnd" =~ ^0+$ ]] || fail "capabilities left: CapEff=$capeff CapBnd=$capbnd"
    nnp=$(awk '/^NoNewPrivs:/{print $2}' "/proc/$pid/status")
    [[ "$nnp" = 1 ]] || fail "no-new-privileges is off"
    [[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$name")" = true ]] || fail "root file system is writable"
    echo "ok   read-only root, no capabilities, no-new-privileges"
  fi
fi

html=$(curl -fsS "$base/") || fail "GET /"
grep -q '<title>Paprika</title>' <<<"$html" || fail "GET / is not the canvas"
echo "ok   GET / (canvas)"
js=$(grep -o '/assets/index-[^"]*\.js' <<<"$html" | head -1)
[[ -n "$js" ]] || fail "no script in the app shell"
chunk=""
# not `name`: that is the container's
for asset in "${js#/assets/}" $(curl -fsS "$base$js" | grep -o '[A-Za-z0-9_.-]*\.js' | sort -u); do
  chunk=$(curl -fsS "$base/assets/$asset" 2>/dev/null | grep -o 'paprika_render-[A-Za-z0-9_-]*\.js' | head -1) || true
  [[ -n "$chunk" ]] && break
done
[[ -n "$chunk" ]] || fail "WASM renderer chunk not in the canvas build"
wasm=$(curl -fsS "$base/assets/$chunk" | grep -o 'paprika_render_bg-[A-Za-z0-9_-]*\.wasm' | head -1)
[[ -n "$wasm" ]] || fail "WASM file not referenced by $chunk"
wasm_type=$(curl -fsS -o /dev/null -w '%{content_type}' "$base/assets/$wasm") || fail "GET /assets/$wasm"
[[ "$wasm_type" = "application/wasm" ]] || fail "WASM served as $wasm_type"
echo "ok   GET /assets/$wasm ($wasm_type)"

code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example:4777' "$base/")
[[ "$code" = "403" ]] || fail "foreign Host answered $code, expected 403"
echo "ok   foreign Host -> 403"

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

  # Chrome draws a glyph that no installed font has as a "no glyph" box, so a missing font does not
  # leave the PNG blank. Each script is rendered twice, as text and as the same number of U+0378
  # (unassigned: no font has it, so it is always that box); equal PNGs mean no font drew the text.
  # An empty frame is the control that the first render shows any ink at all.
  frame() { # name, text ("" for an empty frame): the id of a white frame with black text
    local children=""
    [[ -n "$2" ]] && children=",\"children\":[{\"type\":\"text\",\"name\":\"T\",\"text\":\"$2\",\"x\":16,\"y\":16,\"fontSize\":40,\"color\":\"#000000\"}]"
    local made
    made=$(tool 10 create_nodes "{\"nodes\":[{\"type\":\"frame\",\"name\":\"$1\",\"x\":400,\"y\":0,\"width\":400,\"height\":90,\"fill\":\"#ffffff\"$children}]}")
    json 'r.result.structuredContent.ids?.[0] ?? r.result.structuredContent.created?.[0] ?? ""' <<<"$made"
  }
  png() { tool 11 render_screenshot "{\"rootId\":\"$1\"}" | json 'r.result.content.find(c=>c.type==="image")?.data ?? ""'; }
  blank=$(png "$(frame "Script blank" "")")
  [[ -n "$blank" ]] || fail "render_screenshot of an empty frame returned no image"
  # label:text:the same shape in U+0378 (one per character; Devanagari and Thai do not combine without a font)
  for script in "Latin:Hello:͸͸͸͸͸" "CJK:日本語 中文:͸͸͸ ͸͸" "Arabic:عربي:͸͸͸͸" "Devanagari:हिन्दी:͸͸͸͸͸͸" "Thai:ไทย:͸͸͸"; do
    IFS=: read -r label text tofu <<<"$script"
    inked=$(png "$(frame "Script $label" "$text")")
    [[ -n "$inked" && "$inked" != "$blank" ]] || fail "render_screenshot drew nothing for $label text"
    [[ "$inked" != "$(png "$(frame "Script $label tofu" "$tofu")")" ]] || fail "render_screenshot drew $label text as missing-glyph boxes: the image has no font for it"
  done
  echo "ok   render_screenshot draws Latin, CJK, Arabic, Devanagari and Thai text"
fi

start
init
outline=$(tool 5 get_document_outline '{}')
grep -q 'Docker smoke' <<<"$outline" || fail "node lost after restart: $(head -c 400 <<<"$outline")"
echo "ok   SQLite on the volume survives a restart"

if [[ "$team" = "1" ]]; then
  team_args=(serve --host 0.0.0.0 --port 4777 --team --team-name smoke --team-no-relay --team-bind 0.0.0.0:4778)
  team_id() {
    for _ in $(seq 1 50); do
      local body
      body=$(curl -fsS "$base/api/team" 2>/dev/null) && grep -q '"fingerprint"' <<<"$body" && { json 'r.id' <<<"$body"; return 0; }
      sleep 0.2
    done
    fail "GET /api/team did not answer with the team status"
  }
  start "${team_args[@]}"
  key1=$(team_id)
  [[ -n "$key1" ]] || fail "team status without a key id"
  start "${team_args[@]}"
  key2=$(team_id)
  [[ "$key1" = "$key2" ]] || fail "team key changed after a restart ($key1 -> $key2)"
  echo "ok   team mode: paprika-sync up, key kept on the volume ($key1)"
fi

# SIGTERM must stop the server on its own (PID 1 forwards it), well before Docker's 10 s kill.
start
t0=$SECONDS
docker stop -t 10 "$name" >/dev/null
elapsed=$((SECONDS - t0))
code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
[[ "$code" = 0 && "$elapsed" -lt 8 ]] || fail "docker stop took ${elapsed}s and the exit code was $code (expected a clean exit well under 10 s)"
echo "ok   docker stop: clean exit in ${elapsed}s"

echo "docker smoke: all checks passed for $image"
