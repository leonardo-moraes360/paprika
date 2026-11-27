# Docker

The `Dockerfile` at the root builds everything Paprika needs into one image: the Go server (MCP over HTTP and stdio, HTTP/WS API, SQLite), the web app (`apps/web`, with Tailwind) and the Rust/WASM renderer (`crates/render`); the default target also carries a headless Chrome (for `render_screenshot`) and the team sync sidecar (`crates/sync`). Nothing else has to be installed on the host.

Português: [docs/pt-BR/docker.md](../pt-BR/docker.md).

## Run

```bash
docker build -t paprika .
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
# canvas: http://localhost:4777   ·   MCP: http://localhost:4777/mcp
```

Or with Compose (same settings plus the hardening below, in `compose.yaml`):

```bash
docker compose up -d --build
```

Connect an agent exactly as with a local server: `claude mcp add --transport http paprika http://localhost:4777/mcp`.

### Run it hardened

The image is built to run with a read-only root file system and no privileges. `compose.yaml` already does this; with `docker run` it is:

```bash
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data \
  --read-only --tmpfs /tmp:size=256m,mode=1777 \
  --cap-drop=ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 512 \
  paprika
```

- **Writable paths: two.** `/data` (the volume: database, tokens, undo history, team key) and `/tmp` (Chrome's profile and font cache; `HOME=/tmp`). Everything else is read-only, and the binaries are `0555`.
- **No capabilities.** The server binds port 4777 (above 1024) and Chrome runs without its own sandbox (see below), so nothing needs one. `--cap-drop=ALL` leaves `CapEff`/`CapBnd` at zero.
- **Non-root.** `USER 65532:65532` in both targets (numeric, so Kubernetes `runAsNonRoot` can verify it). A bind mount for `/data` must belong to that uid: `chown 65532:65532 ./data`. A named volume is created with the right owner.
- **Memory and processes.** Idle, the server uses about 12 MiB. `render_screenshot` starts Chrome on first use and keeps it: about 90 MiB and 70 processes after a first screenshot of a 1600x1200 frame (measured with `docker stats`; larger frames need more), which is why the examples allow 1 GiB and 512 pids.
- **No shell, no package manager.** Neither target has `sh`, `apt`, `curl` or `tar` (the `slim` base is distroless; `runtime` starts from `scratch`). To look inside a running container use `docker cp` / `docker export`; to debug the data, mount the volume in a throwaway container of your own. Do not add a shell to the image for it.
- **Stop.** `docker stop` sends `SIGTERM`; the server shuts down by itself (exit code 0, well under a second; `tini` forwards the signal in `runtime`).
- **Health.** `HEALTHCHECK` calls `/app/healthcheck`, a small static client of `GET /api/health` (there is no `curl` to call). It checks port 4777; if you move the server (`--port 5000`), set `-e PAPRIKA_HEALTH_PORT=5000` (in Compose, `healthcheck.test: ["CMD", "/app/healthcheck", "5000"]` also works). For one-shot commands (`mcp`, `import`, `export`) pass `--no-healthcheck`.

#### Chrome's sandbox

The server always starts Chrome with `--no-sandbox` (`server/internal/server/screenshot.go`, `chromedp.NoSandbox`): Chrome's own sandbox needs unprivileged user namespaces, which Docker's default seccomp profile forbids. What replaces it here is the container itself: uid 65532, no capabilities, `no-new-privileges`, a read-only root, memory and pid limits. Chrome only renders HTML that the server generated from the design, and the design's images; if you screenshot designs from people you do not trust, also cut the container's outbound network: `render_screenshot` works on a `docker network create --internal` network (checked: it answers and renders with no way out), though a design that points at a remote image then renders without it. Turning Chrome's sandbox back on would take a custom seccomp profile that allows `clone(CLONE_NEWUSER)` and a switch in the Go code (a `PAPRIKA_CHROMIUM_SANDBOX` variable is the obvious one); neither exists today.

### Team mode

`compose.team.yaml` turns on the peer-to-peer team sync ([team-sync.md](team-sync.md)) on top of `compose.yaml`:

```bash
PAPRIKA_TEAM_NAME=Ana docker compose -f compose.yaml -f compose.team.yaml up -d --build
```

- **Name.** `PAPRIKA_TEAM_NAME` is how the other members see you (default `paprika`).
- **Key.** The key, the team file, invites and the operation log live in `/data/paprika.team/`, in the same volume as the database, so they survive `docker rm` and upgrades. Back up the volume: losing the key means being invited again.
- **Network.** The Iroh endpoint binds UDP `4778` in the container. From Docker's NAT, peers still reach each other through relays; uncomment the `4778:4778/udp` port in `compose.team.yaml` for direct connections. Only keys on the team's allowlist are accepted, but that port is open to whoever can reach the host.
- **Which image.** The sidecar `paprika-sync` is in the default `runtime` target only; `slim` has no team mode.
- **Back to local.** `docker compose up -d` (without the second file) starts the server without `--team`; the team data stays in the volume.

### Data, port, exposure

- **Data.** The SQLite database is `/data/paprika.db` inside the container (`PAPRIKA_DB`); `/data` is a volume, so documents, tokens and the undo/redo history survive `docker rm` and image upgrades. Back it up with `paprika export` (below) or by copying the volume.
- **Port.** Keep the host port at **4777**. The server only accepts requests whose `Host`/`Origin` is `localhost:4777`, `127.0.0.1:4777` or `[::1]:4777` (its DNS-rebinding protection: a web page you visit cannot make your browser talk to a Paprika on another name), so `-p 8080:4777` answers `403`. To use another port, change both sides and the server's: `-p 127.0.0.1:5000:5000 paprika serve --host 0.0.0.0 --port 5000` (and the health check, above).
- **Exposure.** Inside the container the server binds `0.0.0.0` (it has to, for Docker's port forwarding). Publish it on the host's loopback (`127.0.0.1:4777:4777`, as above) unless you mean to share it: there is no authentication.
- **Variables.** `PAPRIKA_DB` (`/data/paprika.db`), `PAPRIKA_WEB_ROOT` (`/app/web`), `PAPRIKA_CHROMIUM` (`/opt/chrome/chrome-headless-shell`, `runtime` only), `PAPRIKA_SYNC` (`/app/paprika-sync` is found next to the binary), `HOME=/tmp`.

## Import, export and stdio

The image's entrypoint is the `paprika` CLI, so every command works with the same volume:

```bash
# import a .paprika.json into the volume's database
docker run --rm -i --no-healthcheck -v paprika-data:/data paprika import /dev/stdin < packages/e2e/fixtures/demo.paprika.json
# export the active workspace (stdout)
docker run --rm --no-healthcheck -v paprika-data:/data paprika export > design.paprika.json
# list workspaces
docker run --rm --no-healthcheck -v paprika-data:/data paprika list
```

For agents that only speak stdio:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--no-healthcheck", "--read-only", "--cap-drop=ALL", "-v", "paprika-data:/data", "paprika", "mcp", "--no-ui"]
    }
  }
}
```

Stop the HTTP container first if both would write to the same volume at once.

## Targets

| Target | Base | Size (layers / compressed) | `render_screenshot` | Team mode |
| --- | --- | --- | --- | --- |
| `runtime` (default) | `scratch` + the files Chrome and `tini` load (no shell, no package manager) | 354 MB / 162 MB | yes | yes |
| `slim` | distroless `static-debian13:nonroot` | 54 MB / 20 MB | no (returns "Chromium not found") | no (no sidecar) |

Measured with `docker history` (sum of the layers) and `docker save | gzip | wc -c`; before this rewrite the same images were 757 MB / 290 MB and 83 MB / 31 MB. The machine was a shared 4-core one, so treat timings as orders of magnitude.

```bash
docker build --target slim -t paprika:slim .
```

Both run as uid/gid 65532, so a volume can move between them.

Labels (`org.opencontainers.image.source`, `.licenses`, `.version`, `.revision`, `.created`) come from build arguments: `docker build --build-arg VERSION=1.2.3 --build-arg REVISION=$(git rev-parse HEAD) .` (Compose reads `PAPRIKA_VERSION` and `PAPRIKA_REVISION`).

## How the image is built

`# syntax=docker/dockerfile:1`, BuildKit. The stages are independent, so the Rust, Go and Node builds run in parallel; each splits "dependencies" from "our code" so an edit to a source file rebuilds only the last step:

1. **wasm** (`rust`): `cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen` (release binary, checksum-pinned, same version and checksum as `.github/actions/setup-rust-wasm`). Dependencies compile first against an empty crate (a layer keyed by `Cargo.toml`/`Cargo.lock`/`.cargo/config.toml`, which turns on WASM SIMD), then the crate itself. The stage fails if `WASM_BINDGEN_VERSION` differs from the `=` pin in `crates/render/Cargo.toml`.
2. **sync** (`rust` + `musl-tools`): the sidecar `paprika-sync`, a static musl binary with symbols stripped and build paths remapped (through cargo's environment, not `Cargo.toml`), same dependency split.
3. **web** (`node`, pnpm from `packageManager`, checked): `pnpm install --frozen-lockfile --ignore-scripts --filter @paprika/web...` with the pnpm store in a cache mount, then `packages/core` build and `vite build` with the WASM from stage 1 copied to `apps/web/src/wasm`. It checks that `dist/client/_shell.html` and a `.wasm` exist.
4. **server** (`golang`): modules in one layer, the compiled third-party packages in the next (their list comes from `go list -deps`), then the server itself; `CGO_ENABLED=0 -tags nodynamic -trimpath -ldflags "-s -w"` (`modernc.org/sqlite` is pure Go; webp/avif stay on WASM so purego does not pull libc). A cache mount seeded from that layer keeps local rebuilds at a few seconds. The **healthcheck** client is a small program written out in the same Dockerfile.
5. **rootfs** (`ubuntu`): the packages Chrome links against, reduced to the files the headless shell loads: the closure `ldd` reports for the binary, its libraries and `tini`, NSS's modules, fontconfig's configuration, Liberation and Noto Color Emoji fonts (the same Inter TTFs the server embeds, instead of Ubuntu's `fonts-inter`), the CA bundle, and `status.d` package metadata so image scanners can see what is inside. Chrome comes from Chrome for Testing's headless shell (the build Playwright uses in `packages/e2e`, checksum-pinned) without its 200+ UI locales (`en-US` stays).
6. **runtime** / **slim**: binary at `/app/paprika` (and `/app/paprika-sync` next to it, found by `serve --team`), canvas at `/app/web` (`PAPRIKA_WEB_ROOT`), headless shell at `/opt/chrome` (`PAPRIKA_CHROMIUM`). `runtime` starts `FROM scratch`.

`.dockerignore` is an allowlist: the build context only carries what the stages copy (tests, test fixtures and the other apps stay out, so editing them never invalidates a layer). The context is 5.6 MB.

Base images and downloads are pinned: every `FROM` is `name:tag@sha256:digest`; `wasm-bindgen` and Chrome are `ADD --checksum`.

## Keeping the pins up to date

- **Base image digests.** Dependabot (`docker` ecosystem in `.github/dependabot.yml`) updates the tag and the digest in the `FROM` lines together. By hand: `docker buildx imagetools inspect <image>:<tag> --format '{{.Manifest.Digest}}'`, then replace the `@sha256:` part.
- **Overriding a base** (a mirror, an internal registry, a CA injected for a proxy): the name to override is the full pinned reference: `docker buildx build --build-context rust:1.100-slim-trixie@sha256:<digest>=docker-image://<other> .`
- **Chrome and Playwright.** Playwright in `packages/e2e` → `CHROME_VERSION` and the checksum in the `chrome-zip` stage (`browserVersion` of `chromium-headless-shell` in playwright-core's `browsers.json`; the checksum is `curl -sL <zip url> | sha256sum`). The server refuses a Chromium build other than the one Playwright expects, so these two move together.
- **wasm-bindgen.** `wasm-bindgen = "=…"` in `crates/render/Cargo.toml` → `WASM_BINDGEN_VERSION` and its checksum in the `wasm-bindgen-tgz` stage and in `.github/actions/setup-rust-wasm` (the build checks the first two against each other; Dependabot ignores that crate).
- **pnpm.** `packageManager` in `package.json` → `PNPM_VERSION` (the build fails if they differ).
- **Go.** The `golang:` tag must be at least the `go` line of `server/go.mod` (`GOTOOLCHAIN=local` stops the toolchain from downloading another one).
- **Node.** The `node:` tag follows the `engines` floor and what CI uses.
- **Ubuntu packages.** `apt` installs the current versions from the pinned Ubuntu image's archive at build time (DL3008 is ignored on purpose): rebuild to pick up security fixes, and re-scan.

## CI

The `docker` job of `.github/workflows/ci.yml` lints the `Dockerfile` with hadolint, builds the default target and `slim` with a layer cache in the GitHub Actions cache, and runs `.github/scripts/docker-smoke.sh` against each. The smoke test runs the image hardened (`--read-only --cap-drop=ALL --security-opt no-new-privileges`, memory and pid limits) and checks: numeric non-root user, no shell, the `HEALTHCHECK` turning healthy, no capabilities left, the canvas and WASM asset served, foreign `Host` refused, MCP `initialize` + `tools/list` + `create_nodes` + `render_screenshot` over `/mcp`, the database surviving a container restart, team mode (sidecar up, key kept on the volume) and a clean `docker stop` in under 8 seconds. It runs when the PR touches the `Dockerfile`, `.dockerignore`, `compose.yaml`, or anything that goes into the image (`server/`, `apps/web/`, `crates/render/`, `crates/sync/`, `packages/core/`), plus on full runs. See [ci.md](ci.md).

Run the same checks locally (the port must be 4777):

```bash
docker build -t paprika:dev . && .github/scripts/docker-smoke.sh paprika:dev
docker build --target slim -t paprika:slim . && SCREENSHOT=0 TEAM=0 .github/scripts/docker-smoke.sh paprika:slim
```
