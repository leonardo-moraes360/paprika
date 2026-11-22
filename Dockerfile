# syntax=docker/dockerfile:1.7
#
# Paprika in one image: the Go server (MCP + HTTP/WS + SQLite), the canvas (apps/web), the
# Rust/WASM renderer (crates/render) and the team sync sidecar (crates/sync). See docs/docker.md.
#
#   docker build -t paprika .
#   docker run --rm -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
#
# Targets:
#   runtime (default)  Ubuntu 24.04 + Chromium headless shell, so `render_screenshot` works.
#   slim               distroless, no Chromium: everything except screenshots (~10x smaller).
#
# Versions follow the repository: Node 22 + pnpm from package.json, Go minor from GO_VERSION in
# .github/workflows/ci.yml, wasm-bindgen from crates/render/Cargo.toml (checked below). Base image
# tags are literal so Dependabot can bump them; to swap one (a mirror, an internal registry), use
# `docker buildx build --build-context ubuntu:24.04=docker-image://<other image> .`.

# ------------------------------------------------------------------ WASM renderer (crates/render)
FROM rust:1.100-slim-trixie AS wasm
# Must match `wasm-bindgen = "=…"` in crates/render/Cargo.toml; same release and checksum as
# .github/actions/setup-rust-wasm (bump the three together).
ARG WASM_BINDGEN_VERSION=0.2.130
ADD --checksum=sha256:9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f \
    https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz \
    /tmp/wasm-bindgen.tgz
RUN tar -xzf /tmp/wasm-bindgen.tgz -C /usr/local/bin --strip-components=1 \
      "wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl/wasm-bindgen" \
 && rm /tmp/wasm-bindgen.tgz \
 && rustup target add wasm32-unknown-unknown
WORKDIR /src/crates/render
COPY crates/render/ ./
RUN want="$(sed -n 's/^wasm-bindgen = "=\([0-9.]*\)".*/\1/p' Cargo.toml)" \
 && [ "$want" = "$WASM_BINDGEN_VERSION" ] \
 || { echo "WASM_BINDGEN_VERSION=$WASM_BINDGEN_VERSION but Cargo.toml pins $want"; exit 1; }
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/crates/render/target \
    cargo build --locked --release --target wasm32-unknown-unknown \
 && wasm-bindgen --target web --out-dir /out \
      target/wasm32-unknown-unknown/release/paprika_render.wasm

# ------------------------------------------------------------------ team sync sidecar (crates/sync)
# Static musl binary, so it runs on distroless/static next to the Go server (ADR 0004).
FROM rust:1.100-slim-trixie AS sync
RUN apt-get update \
 && apt-get install -y --no-install-recommends musl-tools \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add x86_64-unknown-linux-musl
WORKDIR /src/crates/sync
COPY crates/sync/ ./
# Own registry cache: the wasm stage builds at the same time and would race on unpacking crates.
RUN --mount=type=cache,id=cargo-registry-sync,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/crates/sync/target \
    cargo build --locked --release --target x86_64-unknown-linux-musl \
 && install -D target/x86_64-unknown-linux-musl/release/paprika-sync /out/paprika-sync

# ------------------------------------------------------------------ canvas (apps/web + packages/core)
FROM node:26-bookworm-slim AS web
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /src
# Manifests first, so `pnpm install` stays cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @paprika/web...
COPY packages/core/ packages/core/
COPY apps/web/ apps/web/
COPY --from=wasm /out/ apps/web/src/wasm/
# `vite build` directly: the package's `build` script would try to rebuild the WASM with cargo.
RUN pnpm --filter @paprika/core build \
 && pnpm --filter @paprika/web exec vite build \
 && test -n "$(find apps/web/dist -name '*.wasm' -print -quit)"

# ------------------------------------------------------------------ server (server-go)
FROM golang:1.27-trixie AS server
WORKDIR /src/server-go
COPY server-go/go.mod server-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server-go/ ./
# modernc.org/sqlite is pure Go, so the binary is static and runs on distroless too.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/paprika ./cmd/paprika \
 && mkdir -p /out/data

# ------------------------------------------------------------------ slim: no Chromium
FROM gcr.io/distroless/static-debian13:nonroot AS slim
COPY --from=server /out/paprika /app/paprika
COPY --from=sync /out/paprika-sync /app/paprika-sync
COPY --from=web /src/apps/web/dist/ /app/web/
COPY --from=server --chown=65532:65532 /out/data /data
ENV PAPRIKA_DB=/data/paprika.db PAPRIKA_WEB_ROOT=/app/web
WORKDIR /data
VOLUME ["/data"]
EXPOSE 4777
ENTRYPOINT ["/app/paprika"]
# 0.0.0.0 inside the container only; publish it on the host's loopback (-p 127.0.0.1:4777:4777).
CMD ["serve", "--host", "0.0.0.0", "--port", "4777"]

# ------------------------------------------------------------------ Chromium for render_screenshot
# Chrome for Testing's headless shell, the same build Playwright 1.65.1 (packages/e2e) runs the
# screenshot tests with. Bump CHROME_VERSION and its checksum together with Playwright.
FROM ubuntu:26.04 AS chrome
ARG CHROME_VERSION=159.0.8154.6
ADD --checksum=sha256:77a6442fd3c8acd3bef9e1067fc26f5ef464277d22f0e8cb58dc3e4077a3e458 \
    https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-headless-shell-linux64.zip \
    /tmp/chrome.zip
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && unzip -q /tmp/chrome.zip -d /opt \
 && mv /opt/chrome-headless-shell-linux64 /opt/chrome

# ------------------------------------------------------------------ runtime (default): with Chromium
FROM ubuntu:26.04 AS runtime
# The headless shell's shared libraries (Playwright's list for Ubuntu 24.04), fonts-inter (the
# canvas's and the screenshot's font; Liberation and Noto Color Emoji as fallbacks) and tini, which reaps
# Chromium's child processes since paprika would otherwise be PID 1.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 \
      libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
      fonts-inter fonts-liberation fonts-noto-color-emoji tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 65532 paprika \
 && useradd --uid 65532 --gid paprika --create-home --home-dir /home/paprika --shell /usr/sbin/nologin paprika \
 && install -d -o paprika -g paprika /data
COPY --from=chrome /opt/chrome/ /opt/chrome/
COPY --from=server /out/paprika /app/paprika
COPY --from=sync /out/paprika-sync /app/paprika-sync
COPY --from=web /src/apps/web/dist/ /app/web/
ENV PAPRIKA_DB=/data/paprika.db PAPRIKA_WEB_ROOT=/app/web PAPRIKA_CHROMIUM=/opt/chrome/chrome-headless-shell
USER paprika
WORKDIR /data
VOLUME ["/data"]
EXPOSE 4777
ENTRYPOINT ["/usr/bin/tini", "--", "/app/paprika"]
CMD ["serve", "--host", "0.0.0.0", "--port", "4777"]
