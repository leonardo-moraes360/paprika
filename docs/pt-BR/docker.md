# Docker

O `Dockerfile` na raiz monta numa imagem só tudo de que o Paprika precisa: o servidor Go (MCP por HTTP e stdio, API HTTP/WS, SQLite), o app web (`apps/web`, com Tailwind) e o renderizador Rust/WASM (`crates/render`); os dois alvos levam o sidecar de sincronização de time (`crates/sync`), e o padrão também um Chrome headless (para o `render_screenshot`). Nada mais precisa estar instalado no host.

English: [docs/en-US/docker.md](../en-US/docker.md).

## Rodar

```bash
docker build -t paprika .
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data paprika
# canvas: http://localhost:4777   ·   MCP: http://localhost:4777/mcp
```

Ou com Compose (mesmas opções mais o endurecimento abaixo, em `compose.yaml`):

```bash
docker compose up -d --build
```

Conecte um agente como num servidor local: `claude mcp add --transport http paprika http://localhost:4777/mcp`.

### Rodar endurecido

A imagem foi feita para rodar com o sistema de arquivos da raiz somente leitura e sem privilégios. O `compose.yaml` já faz isso; com `docker run` fica assim:

```bash
docker run -d --name paprika -p 127.0.0.1:4777:4777 -v paprika-data:/data \
  --read-only --tmpfs /tmp:size=256m,mode=1777 \
  --cap-drop=ALL --security-opt no-new-privileges \
  --memory 1g --pids-limit 512 \
  paprika
```

- **Caminhos graváveis: dois.** `/data` (o volume: banco, tokens, histórico de desfazer, chave do time) e `/tmp` (perfil e cache de fontes do Chrome; `HOME=/tmp`). O resto é somente leitura, e os binários são `0555`.
- **Sem capabilities.** O servidor escuta a porta 4777 (acima de 1024) e o Chrome roda sem o sandbox próprio (veja abaixo), então nada precisa de uma. Com `--cap-drop=ALL`, `CapEff` e `CapBnd` ficam em zero.
- **Sem root.** `USER 65532:65532` nos dois alvos (numérico, para o `runAsNonRoot` do Kubernetes poder conferir). Um bind mount em `/data` precisa pertencer a esse uid: `chown 65532:65532 ./data`. Um volume nomeado já nasce com o dono certo.
- **Memória e processos.** Ocioso, o servidor usa uns 12 MiB. O `render_screenshot` sobe o Chrome no primeiro uso e o mantém: cerca de 90 MiB e 70 processos depois do primeiro screenshot de um frame 1600x1200 (medido com `docker stats`; frames maiores pedem mais), por isso os exemplos dão 1 GiB e 512 pids.
- **Sem shell, sem gerenciador de pacotes.** Nenhum dos alvos tem `sh`, `apt`, `curl` ou `tar` (a base do `slim` é distroless; o `runtime` parte de `scratch`). Para olhar dentro de um container rodando, use `docker cp` / `docker export`; para depurar os dados, monte o volume num container descartável seu. Não ponha um shell na imagem para isso.
- **Parar.** O `docker stop` manda `SIGTERM`; o servidor encerra sozinho (código de saída 0, bem abaixo de um segundo; o `tini` repassa o sinal no `runtime`).
- **Saúde.** O `HEALTHCHECK` chama `/app/healthcheck`, um clientezinho estático de `GET /api/health` (não há `curl` para chamar). Ele confere a porta 4777; se você mudar o servidor (`--port 5000`), defina `-e PAPRIKA_HEALTH_PORT=5000` (no Compose, `healthcheck.test: ["CMD", "/app/healthcheck", "5000"]` também serve). Para comandos de uma vez só (`mcp`, `import`, `export`), passe `--no-healthcheck`.

#### Sandbox do Chrome

O servidor sempre sobe o Chrome com `--no-sandbox` (`server/internal/server/screenshot.go`, `chromedp.NoSandbox`): o sandbox próprio do Chrome precisa de user namespaces sem privilégio, que o perfil seccomp padrão do Docker proíbe. O que o substitui aqui é o próprio container: uid 65532, sem capabilities, `no-new-privileges`, raiz somente leitura, limites de memória e de pids. O Chrome só renderiza o HTML que o servidor gerou a partir do design, e as imagens do design; se você tira screenshot de designs de gente em quem não confia, corte também a rede de saída do container: o `render_screenshot` funciona numa rede criada com `docker network create --internal` (verificado: responde e renderiza sem ter por onde sair), embora uma imagem remota do design, nesse caso, não carregue. Religar o sandbox do Chrome pediria um perfil seccomp próprio que permita `clone(CLONE_NEWUSER)` e uma chave no código Go (uma variável `PAPRIKA_CHROMIUM_SANDBOX` seria a escolha óbvia); nenhuma das duas existe hoje.

### Modo time

O `compose.team.yaml` liga a sincronização de time peer to peer ([sincronizacao-time.md](sincronizacao-time.md)) por cima do `compose.yaml`:

```bash
PAPRIKA_TEAM_NAME=Ana docker compose -f compose.yaml -f compose.team.yaml up -d --build
```

- **Nome.** `PAPRIKA_TEAM_NAME` é como os outros membros veem você (padrão `paprika`).
- **Chave.** A chave, o arquivo do time, os convites e o log de operações ficam em `/data/paprika.team/`, no mesmo volume do banco, então sobrevivem a `docker rm` e a atualizações. Faça backup do volume: perder a chave significa ser convidado de novo.
- **Rede.** O endpoint Iroh escuta a UDP `4778` no container. Atrás do NAT do Docker, os pares ainda se alcançam por relays; descomente a porta `4778:4778/udp` no `compose.team.yaml` para conexões diretas. Só chaves da lista do time são aceitas, mas essa porta fica aberta para quem alcançar o host.
- **Qual imagem.** O sidecar `paprika-sync` fica em `/app/paprika-sync` nos dois alvos (`runtime` e `slim`), então `serve --team` funciona em qualquer um. Se o servidor disser que não o encontra na imagem, a imagem está quebrada ou foi customizada.
- **Voltar ao local.** `docker compose up -d` (sem o segundo arquivo) sobe o servidor sem `--team`; os dados do time continuam no volume.

### Dados, porta, exposição

- **Dados.** O banco SQLite é `/data/paprika.db` dentro do container (`PAPRIKA_DB`); `/data` é um volume, então documentos, tokens e o histórico de desfazer/refazer sobrevivem a `docker rm` e a atualizações da imagem. Faça backup com `paprika export` (abaixo) ou copiando o volume.
- **Porta.** Mantenha a porta do host em **4777**. O servidor só aceita requisições cujo `Host`/`Origin` seja `localhost:4777`, `127.0.0.1:4777` ou `[::1]:4777` (a proteção dele contra DNS rebinding: uma página web que você visita não consegue fazer o navegador falar com um Paprika sob outro nome), então `-p 8080:4777` responde `403`. Para usar outra porta, mude os dois lados e a do servidor: `-p 127.0.0.1:5000:5000 paprika serve --host 0.0.0.0 --port 5000` (e a verificação de saúde, acima).
- **Exposição.** Dentro do container o servidor escuta em `0.0.0.0` (precisa, para o encaminhamento de porta do Docker). Publique no loopback do host (`127.0.0.1:4777:4777`, como acima), a menos que queira compartilhar: não há autenticação.
- **Variáveis.** `PAPRIKA_DB` (`/data/paprika.db`), `PAPRIKA_WEB_ROOT` (`/app/web`), `PAPRIKA_CHROMIUM` (`/opt/chrome/chrome-headless-shell`, só no `runtime`), `PAPRIKA_SYNC` (o `/app/paprika-sync` é achado ao lado do binário), `HOME=/tmp`.

## Importar, exportar e stdio

O entrypoint da imagem é a CLI `paprika`, então todo comando funciona com o mesmo volume:

```bash
# importa um .paprika.json para o banco do volume
docker run --rm -i --no-healthcheck -v paprika-data:/data paprika import /dev/stdin < packages/e2e/fixtures/demo.paprika.json
# exporta o workspace ativo (stdout)
docker run --rm --no-healthcheck -v paprika-data:/data paprika export > design.paprika.json
# lista os workspaces
docker run --rm --no-healthcheck -v paprika-data:/data paprika list
```

Para agentes que só falam stdio:

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

Pare o container HTTP antes, se os dois fossem escrever no mesmo volume ao mesmo tempo.

## Alvos

| Alvo | Base | Tamanho (camadas / comprimido) | `render_screenshot` | Modo time |
| --- | --- | --- | --- | --- |
| `runtime` (padrão) | `scratch` + os arquivos que o Chrome e o `tini` carregam (sem shell, sem gerenciador de pacotes) | 354 MB / 162 MB | sim | sim |
| `slim` | distroless `static-debian13:nonroot` | não medido de novo desde a inclusão do `paprika-sync` (sem ele eram 54 MB / 20 MB): veja o passo "Image sizes" do job `docker` do CI | não (responde "Chromium not found") | sim |

Medido com `docker history` (soma das camadas) e `docker save | gzip | wc -c`; antes desta reescrita as mesmas imagens tinham 757 MB / 290 MB e 83 MB / 31 MB. A linha do `runtime` já inclui o sidecar; o `slim` cresce o tamanho do binário estático `paprika-sync`. A máquina era compartilhada, de 4 núcleos: trate os tempos como ordem de grandeza.

```bash
docker build --target slim -t paprika:slim .
```

Os dois rodam como uid/gid 65532, então um volume pode passar de um para o outro.

Os rótulos (`org.opencontainers.image.source`, `.licenses`, `.version`, `.revision`, `.created`) vêm de build args: `docker build --build-arg VERSION=1.2.3 --build-arg REVISION=$(git rev-parse HEAD) .` (o Compose lê `PAPRIKA_VERSION` e `PAPRIKA_REVISION`).

## Como a imagem é montada

`# syntax=docker/dockerfile:1`, BuildKit. Os estágios são independentes, então os builds de Rust, Go e Node rodam em paralelo; cada um separa "dependências" de "nosso código", de modo que editar um arquivo-fonte refaz só o último passo:

1. **wasm** (`rust`): `cargo build --release --target wasm32-unknown-unknown` + `wasm-bindgen` (binário da release, com checksum fixado, mesma versão e checksum de `.github/actions/setup-rust-wasm`). As dependências compilam primeiro contra um crate vazio (uma camada chaveada por `Cargo.toml`/`Cargo.lock`/`.cargo/config.toml`, que liga o SIMD do WASM), depois o crate em si. O estágio falha se `WASM_BINDGEN_VERSION` divergir do pin `=` em `crates/render/Cargo.toml`.
2. **sync** (`rust` + `musl-tools`): o sidecar `paprika-sync`, binário musl estático com símbolos removidos e caminhos de build remapeados (pelo ambiente do cargo, não pelo `Cargo.toml`), com a mesma separação de dependências.
3. **web** (`node`, pnpm do `packageManager`, conferido): `pnpm install --frozen-lockfile --ignore-scripts --filter @paprika/web...` com o store do pnpm num cache mount, depois o build de `packages/core` e o `vite build` com o WASM do estágio 1 copiado para `apps/web/src/wasm`. Confere que `dist/client/_shell.html` e um `.wasm` existem.
4. **server** (`golang`): módulos numa camada, os pacotes de terceiros já compilados na seguinte (a lista vem de `go list -deps`), depois o servidor; `CGO_ENABLED=0 -tags nodynamic -trimpath -ldflags "-s -w"` (`modernc.org/sqlite` é Go puro; webp/avif ficam no WASM para o purego não puxar libc). Um cache mount semeado a partir dessa camada mantém os rebuilds locais em poucos segundos. O cliente do **healthcheck** é um programinha escrito no próprio Dockerfile.
5. **rootfs** (`ubuntu`): os pacotes com que o Chrome liga, reduzidos aos arquivos que o headless shell carrega: o fecho que o `ldd` informa para o binário, suas bibliotecas e o `tini`, os módulos do NSS, a configuração do fontconfig, as fontes (veja abaixo; os mesmos TTFs da Inter que o servidor embute, no lugar do `fonts-inter` do Ubuntu), o bundle de CAs e metadados de pacotes em `status.d` para os scanners de imagem enxergarem o que há dentro. O Chrome vem do headless shell do Chrome for Testing (o build que o Playwright usa em `packages/e2e`, com checksum fixado), sem os mais de 200 idiomas da interface (`en-US` fica).
6. **runtime** / **slim**: binário em `/app/paprika` (e `/app/paprika-sync` ao lado, achado pelo `serve --team`), canvas em `/app/web` (`PAPRIKA_WEB_ROOT`), headless shell em `/opt/chrome` (`PAPRIKA_CHROMIUM`). O `runtime` parte de `FROM scratch`.

**Fontes no `runtime`.** O `render_screenshot` desenha o texto com o que estiver instalado, e um glifo sem fonte some, nem quadradinho aparece. A imagem leva Inter, Liberation (latim, grego, cirílico, hebraico; também os fallbacks serif e monoespaçado), Noto Color Emoji, Droid Sans Fallback (ideogramas e kana do chinês e do japonês, 4,0 MB) e Noto Sans Regular e Bold para árabe, devanágari e tailandês (seis arquivos, cerca de 1,1 MB; o resto do `fonts-noto-core`, 42 MB, é instalado no estágio `rootfs` mas não é copiado). Tudo isso são 5,1 MB a mais nas camadas (cerca de 2,6 MB comprimidos) que a imagem sem os três últimos grupos. **Não cobertos:** hangul coreano e outras escritas (bengali, tâmil, georgiano, armênio etc.) saem em branco. O smoke test falha se texto em latim, chinês/japonês, árabe, devanágari ou tailandês sair em branco. Para acrescentar uma escrita, instale o pacote da fonte no estágio `rootfs` e inclua os arquivos na linha do `cp --parents` de lá.

O `.dockerignore` é uma lista de permissão: o contexto de build só leva o que os estágios copiam (testes, fixtures de teste e os outros apps ficam de fora, então editá-los nunca invalida uma camada). O contexto tem 5,6 MB.

Imagens base e downloads são fixados: todo `FROM` é `nome:tag@sha256:digest`; `wasm-bindgen`, o Chrome e o pnpm (o tarball do npm) usam `ADD --checksum`.

## Manter os pins em dia

- **Digests das imagens base.** O Dependabot (ecossistema `docker` em `.github/dependabot.yml`) atualiza a tag e o digest das linhas `FROM` juntos. À mão: `docker buildx imagetools inspect <imagem>:<tag> --format '{{.Manifest.Digest}}'` e troque a parte `@sha256:`.
- **Trocar uma base** (um espelho, um registry interno, uma CA injetada por causa de proxy): o nome a sobrescrever é a referência fixada inteira: `docker buildx build --build-context rust:1.100-slim-trixie@sha256:<digest>=docker-image://<outra> .`
- **Chrome e Playwright.** Playwright em `packages/e2e` → `CHROME_VERSION` e o checksum no estágio `chrome-zip` (`browserVersion` de `chromium-headless-shell` no `browsers.json` do playwright-core; o checksum sai de `curl -sL <url do zip> | sha256sum`). O servidor recusa um build do Chromium diferente do que o Playwright espera, então os dois andam juntos.
- **wasm-bindgen.** `wasm-bindgen = "=…"` em `crates/render/Cargo.toml` → `WASM_BINDGEN_VERSION` e o checksum no estágio `wasm-bindgen-tgz` e em `.github/actions/setup-rust-wasm` (o build confere os dois primeiros entre si; o Dependabot ignora esse crate).
- **pnpm.** `packageManager` em `package.json` → `PNPM_VERSION` e o checksum no estágio `pnpm-tgz` (o build falha se a versão divergir; o checksum é `curl -sL https://registry.npmjs.org/pnpm/-/pnpm-<versão>.tgz | sha256sum`).
- **Go.** A tag `golang:` precisa ser no mínimo a linha `go` de `server/go.mod` (`GOTOOLCHAIN=local` impede que o toolchain baixe outro).
- **Node.** A tag `node:` acompanha o piso de `engines` e o que a CI usa.
- **Pacotes do Ubuntu.** O `apt` instala, na hora do build, as versões atuais do repositório da imagem Ubuntu fixada (o DL3008 é ignorado de propósito): refaça o build para pegar correções de segurança e rode o scan de novo.

## CI

O job `docker` de `.github/workflows/ci.yml` roda o hadolint no `Dockerfile`, constrói o alvo padrão e o `slim` com cache de camadas no cache do GitHub Actions e roda `.github/scripts/docker-smoke.sh` contra cada um. O smoke test roda a imagem endurecida (`--read-only --cap-drop=ALL --security-opt no-new-privileges`, limites de memória e de pids) e confere: usuário numérico sem root, sem shell, o `HEALTHCHECK` ficando saudável, nenhuma capability sobrando, canvas e asset WASM servidos, `Host` estranho recusado, MCP `initialize` + `tools/list` + `create_nodes` + `render_screenshot` em `/mcp` (inclusive que texto em latim, chinês/japonês, árabe, devanágari e tailandês não saia em branco), `/app/paprika-sync` presente e `0555`, o banco sobrevivendo a um restart do container, o modo time (sidecar de pé, chave mantida no volume; a rodada do `slim` faz o mesmo, sem `render_screenshot`) e um `docker stop` limpo em menos de 8 segundos. Roda quando o PR mexe no `Dockerfile`, `.dockerignore`, `compose.yaml` ou em qualquer coisa que entra na imagem (`server/`, `apps/web/`, `crates/render/`, `crates/sync/`, `packages/core/`), além das execuções completas. Veja [ci.md](ci.md).

Rode as mesmas verificações localmente (a porta precisa ser 4777):

```bash
docker build -t paprika:dev . && .github/scripts/docker-smoke.sh paprika:dev
docker build --target slim -t paprika:slim . && SCREENSHOT=0 .github/scripts/docker-smoke.sh paprika:slim
```
