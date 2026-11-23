# Sessões de agentes e `tb`

Toda sessão de agente neste repositório precisa conseguir rodar o `tb` (toolbelt), porque o `AGENTS.md` pede `tb mem list` antes de começar e `tb stack verify guard` antes de um pull request. Sessões na nuvem começam num container novo, então o próprio repositório instala o `tb`.

## Como funciona

O `.claude/settings.json` registra um hook `SessionStart` do Claude Code, `.claude/hooks/session-start.sh`. Ele roda a cada início, retomada, clear e compactação de sessão.

| Onde | O que o hook faz |
| --- | --- |
| Sessão na nuvem (`CLAUDE_CODE_REMOTE=true`) | Se o `tb` do `PATH` (ou de `$(go env GOPATH)/bin`) não for exatamente o módulo fixado, roda `go install github.com/leonardo-moraes360/toolbelt/cmd/tb@v1.0.0-rc.3`, coloca o binário no `PATH` via `CLAUDE_ENV_FILE`, roda `pnpm install --frozen-lockfile` quando os manifests mudaram e define `PAPRIKA_CHROMIUM=/opt/pw-browsers/chromium` quando esse navegador existe. |
| Sessão local | Não instala nada. Aceita um `tb` cuja versão de módulo é a fixada (um build feito a partir de um checkout do toolbelt não tem hash de módulo); senão, informa ao agente o comando de instalação. |

A primeira execução num container novo leva cerca de 30 s (o Go baixa a toolchain pedida pelo `go.mod` do toolbelt e compila o `tb`); as seguintes só conferem o binário e terminam em milissegundos. O hook é síncrono: a sessão espera por ele e o `tb` já existe no primeiro turno.

## Integridade

- A versão é fixada (`TB_VERSION`) junto com o hash do módulo (`TB_SUM`, a linha `h1:` do `sum.golang.org`).
- O `go install` roda fora de qualquer módulo com verificação de checksum forçada: `GOSUMDB=sum.golang.org` e `GOFLAGS`, `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE` zerados, então o ambiente não consegue desligá-la. A toolchain do Go baixada (`GOTOOLCHAIN=auto`) é verificada do mesmo jeito.
- Depois de instalar, o hook lê a linha do módulo embutida no binário (`go version -m`) e falha se não for `v1.0.0-rc.3` com esse hash exato.

`tb version` mostra a versão num build via `go install`, mas `commit: unknown` e `embed: unavailable (built without embednative)`: o build da nuvem não tem o motor nativo de embeddings, então `tb graph search --mode semantic|hybrid` não funciona lá (busca léxica, verify, guard e mem funcionam). Use `go version -m "$(command -v tb)"` para ver a versão e o hash do módulo.

## Atualizar o `tb`

1. Pegue o hash: `curl -s https://sum.golang.org/lookup/github.com/leonardo-moraes360/toolbelt@<versão>` (a linha sem `/go.mod`).
2. Troque `TB_VERSION` e `TB_SUM` juntos em `.claude/hooks/session-start.sh`, e a versão no `AGENTS.md`.
3. Teste localmente: `CLAUDE_CODE_REMOTE=true CLAUDE_ENV_FILE=/dev/null .claude/hooks/session-start.sh`.

## Quando o `tb` ainda assim não estiver disponível

Se o hook falhar (por exemplo, a política de rede bloquear `proxy.golang.org` ou `sum.golang.org`), não pule o gate em silêncio: rode as mesmas verificações à mão (`pnpm check`, invariantes de `.toolbelt/invariants.yaml`) e escreva no pull request que o `tb stack verify guard` não rodou e por quê.
