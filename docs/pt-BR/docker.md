# Docker

O `Dockerfile` na raiz monta numa imagem só tudo de que o Paprika precisa: o servidor Go (MCP por HTTP e stdio, API HTTP/WS, SQLite), o canvas (`apps/web`, com Tailwind) e o renderizador Rust/WASM (`crates/render`). Nada mais precisa estar instalado no host.

English: [docs/docker.md](../docker.md).

## Rodar

```bash
docker build -t paprika .
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
# canvas: http://localhost:4777   ·   MCP: http://localhost:4777/mcp
```

Ou com Compose (mesmas opções, em `compose.yaml`):

```bash
docker compose up -d --build
```

Conecte um agente como num servidor local: `claude mcp add --transport http paprika http://localhost:4777/mcp`.

### Modo time

O `compose.team.yaml` liga a sincronização de time peer to peer ([sincronizacao-time.md](sincronizacao-time.md)) por cima do `compose.yaml`:

```bash
PAPRIKA_TEAM_NAME=Ana docker compose -f compose.yaml -f compose.team.yaml up -d --build
```

- **Nome.** `PAPRIKA_TEAM_NAME` é como os outros membros veem você (padrão `paprika`).
- **Chave.** A chave, o arquivo do time, os convites e o log de operações ficam em `/data/paprika.team/`, no mesmo volume do banco, então sobrevivem a `docker rm` e a upgrades. Faça backup do volume: perder a chave significa ser convidado de novo.
- **Rede.** O endpoint Iroh usa a porta UDP `4778` no container. Atrás do NAT do Docker, os pares se encontram pelos relays; descomente a porta `4778:4778/udp` no `compose.team.yaml` para conexões diretas. Só chaves da allowlist do time são aceitas, mas a porta fica aberta para quem alcança o host.
- **Voltar ao local.** `docker compose up -d` (sem o segundo arquivo) sobe o servidor sem `--team`; os dados do time continuam no volume.

- **Dados.** O banco SQLite fica em `/data/paprika.db` dentro do container (`PAPRIKA_DB`); `/data` é um volume, então documentos, tokens e o histórico de desfazer/refazer sobrevivem a `docker rm` e a upgrades da imagem. Faça backup com `paprika export` (abaixo) ou copiando o volume.
- **Porta.** Mantenha a porta do host em **4777**. O servidor só aceita requisições cujo `Host`/`Origin` seja `localhost:4777`, `127.0.0.1:4777` ou `[::1]:4777` (a proteção contra DNS rebinding), então `-p 8080:4777` responde `403`. Para outra porta, troque os dois lados e a do servidor: `-p 127.0.0.1:5000:5000 paprika serve --host 0.0.0.0 --port 5000`.
- **Exposição.** Dentro do container o servidor escuta em `0.0.0.0` (precisa, para o encaminhamento de porta do Docker). Publique no loopback do host (`127.0.0.1:4777:4777`, como acima), a não ser que queira compartilhar: não há autenticação.

## Importar, exportar e stdio

O entrypoint da imagem é a CLI `paprika`, então todo comando funciona com o mesmo volume:

```bash
# importa um .paprika.json para o banco do volume
docker run --rm -i -v paprika-data:/data paprika import /dev/stdin < packages/e2e/fixtures/demo.paprika.json
# exporta o workspace ativo (stdout)
docker run --rm -v paprika-data:/data paprika export > design.paprika.json
# lista os workspaces
docker run --rm -v paprika-data:/data paprika list
```

Para agentes que só falam stdio:

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

Pare o container HTTP antes, se os dois fossem escrever no mesmo volume ao mesmo tempo.

## Alvos

| Alvo | Base | Tamanho (comprimido / em disco) | `render_screenshot` |
| --- | --- | --- | --- |
| `runtime` (padrão) | Ubuntu 24.04 + Chrome headless shell, fonte Inter, tini | ~270 MB / ~970 MB | sim |
| `slim` | distroless `static-debian13:nonroot` | ~8 MB / ~30 MB | não (responde "Chromium not found") |

```bash
docker build --target slim -t paprika:slim .
```

Os dois rodam como uid/gid 65532, então um volume pode passar de um para o outro.

## Como a imagem é montada

Multi-stage, com cache mounts do BuildKit para cargo, pnpm e Go:

1. **wasm** (`rust:1.100-slim-trixie`): `cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen` (binário da release, com checksum fixado, mesma versão e checksum de `.github/actions/setup-rust-wasm`). O estágio falha se `WASM_BINDGEN_VERSION` divergir do pin `=` em `crates/render/Cargo.toml`.
2. **web** (`node:22-bookworm-slim`, pnpm do `packageManager`): instala só `@paprika/web` e as dependências do workspace, compila `packages/core` e roda `vite build` com o WASM do estágio 1 (o build confere que um `.wasm` foi parar em `dist/`).
3. **server** (`golang:1.26-trixie`): binário estático (`CGO_ENABLED=0 -tags nodynamic`; `modernc.org/sqlite` é Go puro; webp/avif ficam no WASM para o purego não puxar libc).
   **sync** (`rust:1.100-slim-trixie` + `musl-tools`): o sidecar de sincronização de time `paprika-sync` (`crates/sync`), binário musl estático para rodar também no distroless ([sincronizacao-time.md](sincronizacao-time.md)).
4. **chrome**: o headless shell do Chrome for Testing, o mesmo build (159.0.8154.6) que o Playwright 1.65.1 usa em `packages/e2e`, com checksum fixado.
5. **runtime** / **slim**: binário em `/app/paprika` (e `/app/paprika-sync` ao lado, achado pelo `serve --team`), canvas em `/app/web` (`PAPRIKA_WEB_ROOT`), headless shell em `/opt/chrome` (`PAPRIKA_CHROMIUM`).

O `.dockerignore` é uma allowlist: o contexto de build só leva os arquivos que os estágios copiam.

Ao subir versões, mantenha juntos:

- Playwright em `packages/e2e` → `CHROME_VERSION` e o `--checksum` no estágio `chrome` (`browserVersion` de `chromium-headless-shell` no `browsers.json` do playwright-core).
- `wasm-bindgen` em `crates/render/Cargo.toml` → `WASM_BINDGEN_VERSION` e o checksum aqui e em `.github/actions/setup-rust-wasm`.
- `GO_VERSION` em `.github/workflows/ci.yml` → a tag `golang:` do estágio `server`.

## CI

O job `docker` de `.github/workflows/ci.yml` faz o build do alvo padrão e roda `.github/scripts/docker-smoke.sh` contra ele: canvas e asset WASM servidos, `Host` estranho recusado, MCP `initialize` + `tools/list` + `create_nodes` + `render_screenshot` em `/mcp`, e o banco sobrevivendo a um restart do container no mesmo volume. Roda quando o PR mexe no `Dockerfile`, `.dockerignore`, `compose.yaml` ou em algo que entra na imagem (`server/`, `apps/web/`, `crates/render/`, `crates/sync/`, `packages/core/`), e nas execuções completas. Veja [ci.md](ci.md).

Para rodar a mesma checagem localmente:

```bash
docker build -t paprika:dev . && .github/scripts/docker-smoke.sh paprika:dev
docker build --target slim -t paprika:slim . && SCREENSHOT=0 .github/scripts/docker-smoke.sh paprika:slim
```
