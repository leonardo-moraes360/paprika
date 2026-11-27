# syntax=docker/dockerfile:1
#
# Paprika in one image: the Go server (MCP + HTTP/WS + SQLite), the web app (apps/web), the
# Rust/WASM renderer (crates/render) and, in `runtime`, the team sync sidecar (crates/sync) and a
# headless Chrome for `render_screenshot`. See docs/en-US/docker.md.
#
#   docker build -t paprika .
#   docker run --rm -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
#
# Targets:
#   runtime (default)  Chrome headless shell + paprika-sync, on a root file system that holds only
#                      the files they load (no shell, no package manager): screenshots and team mode.
#   slim               distroless/static: no Chrome, no sync sidecar. Everything else.
#
# Every base image is pinned by digest (the tag stays in front of it so Dependabot can bump both);
# downloads are pinned by checksum. Versions that move together (docs/en-US/docker.md): Node 26 +
# pnpm from package.json `packageManager`, Go minor from go.mod, wasm-bindgen from
# crates/render/Cargo.toml (checked below), Chrome from Playwright in packages/e2e.
# To swap a base image (a mirror, an internal registry), pass the full pinned reference:
#   docker buildx build --build-context ubuntu:26.04@sha256:<digest>=docker-image://<other> .

# ------------------------------------------------------------------ downloads (checksum-pinned)
FROM scratch AS wasm-bindgen-tgz
# Must match `wasm-bindgen = "=…"` in crates/render/Cargo.toml; same release and checksum as
# .github/actions/setup-rust-wasm (bump the three together).
ARG WASM_BINDGEN_VERSION=0.2.130
ADD --checksum=sha256:9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f \
    https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz \
    /wasm-bindgen.tgz

FROM scratch AS chrome-zip
# Chrome for Testing's headless shell, the same build Playwright 1.65.1 (packages/e2e) runs the
# screenshot tests with. Bump CHROME_VERSION and its checksum together with Playwright.
ARG CHROME_VERSION=159.0.8154.6
ADD --checksum=sha256:77a6442fd3c8acd3bef9e1067fc26f5ef464277d22f0e8cb58dc3e4077a3e458 \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-headless-shell-linux64.zip \
    /chrome.zip

# ------------------------------------------------------------------ WASM renderer (crates/render)
FROM rust:1.100-slim-trixie@sha256:3b199fd6db7d709274df56565b8f4003f9e30d7bfcff9d53148c86053b7855e2 AS wasm
ARG WASM_BINDGEN_VERSION=0.2.130
RUN --mount=type=bind,from=wasm-bindgen-tgz,source=/wasm-bindgen.tgz,target=/tmp/wasm-bindgen.tgz \
    tar -xzf /tmp/wasm-bindgen.tgz -C /usr/local/bin --strip-components=1 \
      "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen" \
 && rustup target add wasm32-unknown-unknown
WORKDIR /src/crates/render
# .cargo/config.toml turns on WASM SIMD (`+simd128`): it must be in the layer that compiles the
# dependencies too, or their code would differ from the final build's.
COPY crates/render/.cargo/ .cargo/
COPY crates/render/Cargo.toml crates/render/Cargo.lock ./
RUN want="$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)".*/\1/p' Cargo.toml)" \
 && [ "$want" = "$WASM_BINDGEN_VERSION" ] \
 || { echo "WASM_BINDGEN_VERSION=$WASM_BINDGEN_VERSION but Cargo.toml pins $want"; exit 1; }
# Dependencies first, against an empty crate: this layer is rebuilt only when Cargo.toml/Cargo.lock
# change, so a source edit recompiles just paprika-render (cargo's `target/` lives in the layer, not in
# a cache mount, so the layer cache of CI restores it too).
RUN mkdir src && : > src/lib.rs \
 && cargo build --locked --release --target wasm32-unknown-unknown \
 && cargo clean --release --target wasm32-unknown-unknown -p paprika-render \
 && rm -rf src
COPY crates/render/src/ src/
RUN touch src/lib.rs \
 && cargo build --locked --release --target wasm32-unknown-unknown \
 && wasm-bindgen --target web --out-dir /out \
      target/wasm32-unknown-unknown/release/paprika_render.wasm

# ------------------------------------------------------------------ team sync sidecar (crates/sync)
# Static musl binary, so it needs no libc next to it (ADR 0004). Symbols stripped and build paths
# remapped through cargo's environment, so crates/sync/Cargo.toml stays as it is.
FROM rust:1.100-slim-trixie@sha256:3b199fd6db7d709274df56565b8f4003f9e30d7bfcff9d53148c86053b7855e2 AS sync
ENV CARGO_PROFILE_RELEASE_STRIP=symbols \
    RUSTFLAGS="--remap-path-prefix=/usr/local/cargo=/cargo --remap-path-prefix=/src=/src"
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends musl-tools \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add x86_64-unknown-linux-musl
WORKDIR /src/crates/sync
COPY crates/sync/Cargo.toml crates/sync/Cargo.lock ./
RUN mkdir src && : > src/lib.rs && echo 'fn main() {}' > src/main.rs \
 && cargo build --locked --release --target x86_64-unknown-linux-musl \
 && cargo clean --release --target x86_64-unknown-linux-musl -p paprika-sync \
 && rm -rf src
COPY crates/sync/src/ src/
RUN touch src/lib.rs src/main.rs \
 && cargo build --locked --release --target x86_64-unknown-linux-musl \
 && install -D target/x86_64-unknown-linux-musl/release/paprika-sync /out/paprika-sync

# ------------------------------------------------------------------ web app (apps/web + packages/core)
FROM node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS web
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 npm_config_update_notifier=false
# Node 25+ no longer ships corepack, so pnpm comes from npm; the version must be the one in
# package.json `packageManager` (checked below). Before any repo file, so it is cached for good.
ARG PNPM_VERSION=10.0.0
RUN npm install --global --no-audit --no-fund --ignore-scripts "pnpm@${PNPM_VERSION}"
WORKDIR /src
# Manifests first, so `pnpm install` stays cached until a dependency changes. No `pnpm fetch` +
# `--offline`: the store is a cache mount, which the layer cache of CI does not restore, so an
# offline install would fail on a cold mount.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN [ "pnpm@${PNPM_VERSION}" = "$(node -p 'require("./package.json").packageManager')" ] \
 || { echo "PNPM_VERSION=$PNPM_VERSION but package.json pins $(node -p 'require("./package.json").packageManager')"; exit 1; }
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --ignore-scripts --filter @paprika/web...
COPY packages/core/ packages/core/
COPY apps/web/ apps/web/
COPY --from=wasm /out/ apps/web/src/wasm/
# `vite build` directly: the package's `build` script would try to rebuild the WASM with cargo.
RUN pnpm --filter @paprika/core build \
 && pnpm --filter @paprika/web exec vite build \
 && test -f apps/web/dist/client/_shell.html \
 && test -n "$(find apps/web/dist/client -name '*.wasm' -print -quit)"

# ------------------------------------------------------------------ server (Go)
# modernc.org/sqlite is pure Go; `nodynamic` keeps gen2brain webp/avif on WASM so purego does not
# pull libc (the final images of `slim` have none). GOTOOLCHAIN=local: never download a toolchain.
FROM golang:1.27-trixie@sha256:430985542100b871e108ccc00e8dcc5eef08ca14ee5825e98ebf563d8ffec4ee AS go-base
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS="-mod=readonly -trimpath -buildvcs=false -tags=nodynamic"
WORKDIR /src/server

# Modules first: this layer changes only with go.mod/go.sum.
FROM go-base AS go-mod
COPY server/go.mod server/go.sum ./
RUN go mod download

# The third-party import paths of the server, one per line: the only input of the layer below, so a
# change in server code that adds no dependency leaves that layer cached.
FROM go-mod AS go-deplist
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
COPY server/ ./
RUN go list -deps -f '{{if and (not .Standard) .Module (not .Module.Main)}}{{.ImportPath}}{{end}}' ./cmd/paprika \
      | sed '/^$/d' | sort -u > /deps.txt

# The compiled dependencies stay in this layer (module and build caches), so only the server's own
# packages are compiled when its code changes.
FROM go-mod AS go-deps
COPY --from=go-deplist /deps.txt /deps.txt
# hadolint ignore=SC2046
RUN go build $(cat /deps.txt)

FROM go-deps AS server
COPY server/ ./
# The cache mount starts from the compiled dependencies above and then keeps the server's own
# packages between local builds.
RUN --mount=type=cache,target=/root/.cache/go-build,from=go-deps,source=/root/.cache/go-build \
    go build -ldflags="-s -w" -o /out/paprika ./cmd/paprika \
 && mkdir -p /out/data

# `docker` HEALTHCHECK has no curl or shell to call in these images: a 1.2 MB static client of
# GET /api/health (raw sockets from package syscall), written out and built right here.
FROM go-base AS healthcheck
WORKDIR /src
RUN <<'EOF'
cat > main.go <<'GO'
// healthcheck exits 0 when the Paprika server answers GET /api/health with 200.
// Raw sockets from package syscall only: no net, no fmt, so the binary stays small.
package main

import (
	"os"
	"syscall"
)

func main() {
	// Port: first argument, else $PAPRIKA_HEALTH_PORT, else 4777.
	arg := os.Getenv("PAPRIKA_HEALTH_PORT")
	if len(os.Args) > 1 {
		arg = os.Args[1]
	}
	port := 4777
	if arg != "" {
		port = 0
		for _, c := range arg {
			if c < '0' || c > '9' {
				os.Exit(2)
			}
			port = port*10 + int(c-'0')
			if port > 65535 {
				os.Exit(2)
			}
		}
	}
	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	if err != nil {
		os.Exit(1)
	}
	tv := syscall.Timeval{Sec: 4}
	_ = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)
	_ = syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_SNDTIMEO, &tv)
	if syscall.Connect(fd, &syscall.SockaddrInet4{Port: port, Addr: [4]byte{127, 0, 0, 1}}) != nil {
		os.Exit(1)
	}
	// The server accepts only Host: localhost:<its port> (DNS-rebinding protection).
	req := "GET /api/health HTTP/1.0\r\nHost: localhost:" + itoa(port) + "\r\nConnection: close\r\n\r\n"
	if _, err := syscall.Write(fd, []byte(req)); err != nil {
		os.Exit(1)
	}
	buf := make([]byte, 12)
	n, _ := syscall.Read(fd, buf)
	// "HTTP/1.x 200"
	if n < 12 || string(buf[:7]) != "HTTP/1." || string(buf[8:12]) != " 200" {
		os.Exit(1)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for ; n > 0; n /= 10 {
		i--
		b[i] = byte('0' + n%10)
	}
	return string(b[i:])
}
GO
go mod init healthcheck
go build -ldflags="-s -w" -o /out/healthcheck .
EOF

# ------------------------------------------------------------------ slim: no Chrome, no sync
FROM gcr.io/distroless/static-debian13:nonroot@sha256:8ce6dd87e9823c5b48dcfb2c8604714ccb351ce59607327bcc4957448da279b5 AS slim
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="Paprika (slim)" \
      org.opencontainers.image.description="Paprika design canvas and MCP server, without Chrome (no render_screenshot) and without the team sync sidecar." \
      org.opencontainers.image.source="https://github.com/leonardo-moraes360/paprika" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"
COPY --link --chmod=0555 --from=server /out/paprika /app/paprika
COPY --link --chmod=0555 --from=healthcheck /out/healthcheck /app/healthcheck
COPY --link --from=web /src/apps/web/dist/client/ /app/web/
COPY --link --from=server --chown=65532:65532 --chmod=0700 /out/data /data
ENV PAPRIKA_DB=/data/paprika.db PAPRIKA_WEB_ROOT=/app/web
USER 65532:65532
WORKDIR /data
VOLUME ["/data"]
EXPOSE 4777
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/app/healthcheck"]
ENTRYPOINT ["/app/paprika"]
# 0.0.0.0 inside the container only; publish it on the host's loopback (-p 127.0.0.1:4777:4777).
CMD ["serve", "--host", "0.0.0.0", "--port", "4777"]

# ------------------------------------------------------------------ root file system of `runtime`
# Built on Ubuntu so Chrome's shared libraries come from one consistent glibc, then reduced to the
# files the headless shell actually loads (the closure `ldd` reports plus NSS's dlopen'd modules,
# fontconfig's configuration and the fonts). `runtime` starts from scratch and copies only this.
FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db AS rootfs
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates fontconfig-config fonts-liberation fonts-noto-color-emoji tini unzip \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libdbus-1-3 libgbm1 \
      libglib2.0-0t64 libnspr4 libnss3 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
      libxfixes3 libxkbcommon0 libxrandr2
# Chrome without what a headless screenshot never reads: the 200+ UI locales (en-US stays) and the
# package metadata. Nothing here is executed by the build.
RUN --mount=type=bind,from=chrome-zip,source=/chrome.zip,target=/tmp/chrome.zip \
    unzip -q /tmp/chrome.zip -d /opt \
 && mv /opt/chrome-headless-shell-linux64 /opt/chrome \
 && find /opt/chrome/locales -type f ! -name 'en-US.pak' -delete \
 && rm -f /opt/chrome/ABOUT /opt/chrome/deb.deps /opt/chrome/rpm.deps
COPY --link --from=go-deplist /src/server/internal/export/fonts/Inter-Regular.ttf /src/server/internal/export/fonts/Inter-SemiBold.ttf /src/server/internal/export/fonts/Inter-Bold.ttf /rootfs/usr/share/fonts/truetype/inter/
RUN <<'EOF'
set -eu
R=/rootfs
# copy FILE (and the symlink chain that leads to it) under $R, keeping the directory layout
put() {
  p=$1
  while :; do
    d=$(realpath -s "$(dirname "$p")"); d=$(realpath "$d")
    mkdir -p "$R$d"
    cp -a "$d/$(basename "$p")" "$R$d/"
    [ -L "$d/$(basename "$p")" ] || break
    t=$(readlink "$d/$(basename "$p")")
    case "$t" in /*) p=$t ;; *) p="$d/$t" ;; esac
  done
}
# the shared libraries Chrome and the other binaries load, and the modules NSS opens on demand
{
  for b in /opt/chrome/chrome-headless-shell /opt/chrome/*.so /opt/chrome/libvulkan.so.1 /usr/bin/tini; do ldd "$b" 2>/dev/null || true; done
  for f in $(dpkg -L libnss3 | grep '\.so'); do echo "$f"; ldd "$f" 2>/dev/null || true; done
} | awk '{for(i=1;i<=NF;i++) if ($i ~ /^\//) print $i}' | sort -u > /tmp/libs.txt
while read -r f; do if [ -e "$f" ]; then put "$f"; fi; done < /tmp/libs.txt
put /usr/bin/tini
# dynamic linker path and cache
mkdir -p "$R/usr/lib64" && cp -a /usr/lib64/ld-linux-x86-64.so.2 "$R/usr/lib64/"
ln -s usr/lib "$R/lib" && ln -s usr/lib64 "$R/lib64"
mkdir -p "$R/etc/ld.so.conf.d" && printf '/usr/lib/x86_64-linux-gnu\n' > "$R/etc/ld.so.conf"
ldconfig -r "$R"
# fontconfig, fonts, trusted roots
cp -a --parents /etc/fonts /usr/share/fontconfig /usr/share/fonts/truetype/liberation /usr/share/fonts/truetype/noto "$R/"
mkdir -p "$R/etc/ssl/certs" && cp /etc/ssl/certs/ca-certificates.crt "$R/etc/ssl/certs/"
# the files of the image's own account database and name service switch
printf 'root:x:0:0:root:/root:/sbin/nologin\npaprika:x:65532:65532:paprika:/tmp:/sbin/nologin\n' > "$R/etc/passwd"
printf 'root:x:0:\npaprika:x:65532:\n' > "$R/etc/group"
printf 'hosts: files dns\n' > "$R/etc/nsswitch.conf"
# package metadata, in the layout distroless uses, so image scanners can see what is inside
cp /usr/lib/os-release "$R/usr/lib/os-release" && ln -s ../usr/lib/os-release "$R/etc/os-release" && cp /etc/lsb-release "$R/etc/lsb-release"
mkdir -p "$R/var/lib/dpkg/status.d"
find "$R" -type f -o -type l | sed "s|^$R||" | while read -r f; do dpkg -S "$f" 2>/dev/null || true; done \
  | cut -d: -f1 | tr ',' '\n' | sed 's/^ //' | { cat; echo ca-certificates; } | sort -u \
  | while read -r pkg; do dpkg-query -s "$pkg" > "$R/var/lib/dpkg/status.d/$pkg"; done
EOF

# ------------------------------------------------------------------ runtime (default): Chrome + sync
FROM scratch AS runtime
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="Paprika" \
      org.opencontainers.image.description="Paprika design canvas and MCP server with a headless Chrome for render_screenshot and the team sync sidecar." \
      org.opencontainers.image.source="https://github.com/leonardo-moraes360/paprika" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"
COPY --link --from=rootfs /rootfs/ /
COPY --link --from=rootfs /opt/chrome/ /opt/chrome/
COPY --link --chmod=0555 --from=sync /out/paprika-sync /app/paprika-sync
COPY --link --chmod=0555 --from=healthcheck /out/healthcheck /app/healthcheck
COPY --link --from=web /src/apps/web/dist/client/ /app/web/
COPY --link --chmod=0555 --from=server /out/paprika /app/paprika
COPY --link --from=server --chown=65532:65532 --chmod=0700 /out/data /data
# /tmp belongs to the only account of the image, so it needs no world-writable bit.
COPY --link --from=server --chown=65532:65532 --chmod=0700 /out/data /tmp
# HOME=/tmp: Chrome's profile and fontconfig's cache go to /tmp (a tmpfs with --read-only).
ENV PAPRIKA_DB=/data/paprika.db PAPRIKA_WEB_ROOT=/app/web PAPRIKA_CHROMIUM=/opt/chrome/chrome-headless-shell HOME=/tmp
USER 65532:65532
WORKDIR /data
VOLUME ["/data"]
EXPOSE 4777
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/app/healthcheck"]
# tini reaps Chrome's orphaned child processes; paprika would otherwise be PID 1.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/paprika"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4777"]
