# Docker

The `Dockerfile` at the root builds everything Paprika needs into one image: the Go server (MCP over HTTP and stdio, HTTP/WS API, SQLite), the canvas (`apps/web`, with Tailwind) and the Rust/WASM renderer (`crates/render`). Nothing else has to be installed on the host.

Português: [docs/pt-BR/docker.md](pt-BR/docker.md).

## Run

```bash
docker build -t paprika .
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
# canvas: http://localhost:4777   ·   MCP: http://localhost:4777/mcp
```

Or with Compose (same settings, in `compose.yaml`):

```bash
docker compose up -d --build
```

Connect an agent exactly as with a local server: `claude mcp add --transport http paprika http://localhost:4777/mcp`.

### Team mode

`compose.team.yaml` turns on the peer-to-peer team sync ([team-sync.md](team-sync.md)) on top of `compose.yaml`:

```bash
PAPRIKA_TEAM_NAME=Ana docker compose -f compose.yaml -f compose.team.yaml up -d --build
```

- **Name.** `PAPRIKA_TEAM_NAME` is how the other members see you (default `paprika`).
- **Key.** The key, the team file, invites and the operation log live in `/data/paprika.team/`, in the same volume as the database, so they survive `docker rm` and upgrades. Back up the volume: losing the key means being invited again.
- **Network.** The Iroh endpoint binds UDP `4778` in the container. From Docker's NAT, peers still reach each other through relays; uncomment the `4778:4778/udp` port in `compose.team.yaml` for direct connections. Only keys on the team's allowlist are accepted, but that port is open to whoever can reach the host.
- **Back to local.** `docker compose up -d` (without the second file) starts the server without `--team`; the team data stays in the volume.

- **Data.** The SQLite database is `/data/paprika.db` inside the container (`PAPRIKA_DB`); `/data` is a volume, so documents, tokens and the undo/redo history survive `docker rm` and image upgrades. Back it up with `paprika export` (below) or by copying the volume.
- **Port.** Keep the host port at **4777**. The server only accepts requests whose `Host`/`Origin` is `localhost:4777`, `127.0.0.1:4777` or `[::1]:4777` (its DNS-rebinding protection), so `-p 8080:4777` answers `403`. To use another port, change both sides and the server's: `-p 127.0.0.1:5000:5000 paprika serve --host 0.0.0.0 --port 5000`.
- **Exposure.** Inside the container the server binds `0.0.0.0` (it has to, for Docker's port forwarding). Publish it on the host's loopback (`127.0.0.1:4777:4777`, as above) unless you mean to share it: there is no authentication.

## Import, export and stdio

The image's entrypoint is the `paprika` CLI, so every command works with the same volume:

```bash
# import a .paprika.json into the volume's database
docker run --rm -i -v paprika-data:/data paprika import /dev/stdin < packages/e2e/fixtures/demo.paprika.json
# export the active workspace (stdout)
docker run --rm -v paprika-data:/data paprika export > design.paprika.json
# list workspaces
docker run --rm -v paprika-data:/data paprika list
```

For agents that only speak stdio:

```json
{
  "mcpServers": {
    "paprika": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "paprika-data:/data", "paprika", "mcp", "--no-ui"]
    }
  }
}
```

Stop the HTTP container first if both would write to the same volume at once.

## Targets

| Target | Base | Size (compressed / on disk) | `render_screenshot` |
| --- | --- | --- | --- |
| `runtime` (default) | Ubuntu 24.04 + Chrome headless shell, Inter font, tini | ~270 MB / ~970 MB | yes |
| `slim` | distroless `static-debian13:nonroot` | ~8 MB / ~30 MB | no (returns "Chromium not found") |

```bash
docker build --target slim -t paprika:slim .
```

Both run as uid/gid 65532, so a volume can move between them.

## How the image is built

Multi-stage, with BuildKit cache mounts for cargo, pnpm and Go:

1. **wasm** (`rust:1.100-slim-trixie`): `cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen` (the release binary, checksum-pinned, same version and checksum as `.github/actions/setup-rust-wasm`). The stage fails if `WASM_BINDGEN_VERSION` differs from the `=` pin in `crates/render/Cargo.toml`.
2. **web** (`node:22-bookworm-slim`, pnpm from `packageManager`): installs only `@paprika/web` and its workspace dependencies, builds `packages/core` and runs `vite build` with the WASM from stage 1 (the build checks that a `.wasm` landed in `dist/`).
3. **server** (`golang:1.26-trixie`): static binary (`CGO_ENABLED=0 -tags nodynamic`; `modernc.org/sqlite` is pure Go; webp/avif stay on WASM so purego does not pull libc).
   **sync** (`rust:1.100-slim-trixie` + `musl-tools`): the team sync sidecar `paprika-sync` (`crates/sync`), a static musl binary so it also runs on distroless ([team-sync.md](team-sync.md)).
4. **chrome**: Chrome for Testing's headless shell, the same build (159.0.8154.6) Playwright 1.65.1 uses in `packages/e2e`, checksum-pinned.
5. **runtime** / **slim**: binary at `/app/paprika` (and `/app/paprika-sync` next to it, found by `serve --team`), canvas at `/app/web` (`PAPRIKA_WEB_ROOT`), headless shell at `/opt/chrome` (`PAPRIKA_CHROMIUM`).

`.dockerignore` is an allowlist: the build context only carries the files the stages copy.

When bumping versions, keep these in step:

- Playwright in `packages/e2e` → `CHROME_VERSION` and its `--checksum` in the `chrome` stage (`browserVersion` of `chromium-headless-shell` in playwright-core's `browsers.json`).
- `wasm-bindgen` in `crates/render/Cargo.toml` → `WASM_BINDGEN_VERSION` and its checksum here and in `.github/actions/setup-rust-wasm`.
- `GO_VERSION` in `.github/workflows/ci.yml` → the `golang:` tag of the `server` stage.

## CI

The `docker` job of `.github/workflows/ci.yml` builds the default target and runs `.github/scripts/docker-smoke.sh` against it: canvas and WASM asset served, foreign `Host` refused, MCP `initialize` + `tools/list` + `create_nodes` + `render_screenshot` over `/mcp`, and the database surviving a container restart on the same volume. It runs when the PR touches the `Dockerfile`, `.dockerignore`, `compose.yaml`, or anything that goes into the image (`server-go/`, `apps/web/`, `crates/render/`, `crates/sync/`, `packages/core/`), plus on full runs. See [ci.md](ci.md).

Run the same check locally:

```bash
docker build -t paprika:dev . && .github/scripts/docker-smoke.sh paprika:dev
docker build --target slim -t paprika:slim . && SCREENSHOT=0 .github/scripts/docker-smoke.sh paprika:slim
```
