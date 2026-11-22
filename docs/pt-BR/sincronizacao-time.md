[🇺🇸 English](../team-sync.md) | 🇧🇷 Português

# Sincronização de time (peer to peer)

Cada pessoa roda o próprio Paprika com os próprios agentes; as instâncias de um time se acham pelo
[Iroh](https://www.iroh.computer/) e convergem nos mesmos workspaces por um CRDT [Loro](https://loro.dev).
Não há servidor central. Por que é assim: [ADR 0004](adr/0004-sincronizacao-p2p-de-time.md).

```
 máquina da pessoa A                                  máquina da pessoa B
 ┌────────────── paprika serve --team ─────────────┐  ┌────────────── paprika serve --team ─────────────┐
 │ canvas ─ws─┐   agentes ─MCP─┐                    │  │                                                 │
 │            ▼                ▼                    │  │                                                 │
 │       Store (applyOps, SQLite) ◄─► internal/team │  │  internal/team ◄─► Store (applyOps, SQLite)     │
 │                                   │ linhas JSON  │  │       │ linhas JSON                             │
 │                                   ▼              │  │       ▼                                         │
 │                    paprika-sync (Loro, chaves) ◄═╪══╪═► paprika-sync      QUIC: direto ou via relay    │
 └─────────────────────────────────────────────────┘  └─────────────────────────────────────────────────┘
```

## Como rodar

```bash
cargo build --release --manifest-path crates/sync/Cargo.toml
cp crates/sync/target/release/paprika-sync server-go/bin/      # ao lado do paprika, ou defina PAPRIKA_SYNC
server-go/bin/paprika serve --team --team-name Ana
```

| Flag | Padrão | Significado |
| --- | --- | --- |
| `--team` | desligado | Sobe o sidecar e entra no modo time. Sem ela (ou sem o binário) o servidor é só local. |
| `--team-dir` | `<db>.team/` | Chave (`key`, modo 0600), arquivo de time, convites e o log de operações. |
| `--team-name` | `$USER` | Como os outros membros veem você. |
| `--team-no-relay` | desligado | Sem relays públicos nem busca de endereço por DNS: só loopback/rede local (testes). |
| `--team-bind` | qualquer | Endereço UDP do endpoint Iroh, por exemplo `127.0.0.1:0`. |

A imagem Docker leva o `paprika-sync` ao lado do `paprika` ([docker.md](docker.md)).

## Camadas

| Camada | Onde | O que faz |
| --- | --- | --- |
| Transporte | `crates/sync/src/node.rs`, `proto.rs` | Um endpoint Iroh por instância (a chave dele é a chave de membro). Uma conexão QUIC por peer, um stream bidirecional de frames JSON com prefixo de tamanho no ALPN `paprika/sync/1`. Conexões de chaves fora do time são fechadas antes de qualquer leitura. |
| CRDT | `crates/sync/src/crdt.rs` | Um documento Loro por workspace compartilhado: um `LoroTree` para os nós (campos nos metadados de cada nó da árvore, uma chave em que o último a escrever vence por campo) e mapas para nome, tokens e modos. |
| Segurança | `crates/sync/src/team.rs`, `envelope.rs`, `keys.rs` | Arquivo de time (allowlist), envelopes assinados, delegação a agentes, convites. |
| Ponte Go | `server-go/internal/team` | Sobe e supervisiona o sidecar, transforma commits locais em conjuntos de mudanças e estados remotos em transações `applyOps`, serve `/api/team/*` e manda `{type: "team"}` em `/ws`. |

## Protocolo do sidecar (stdio)

O servidor Go escreve um objeto JSON por linha no stdin do sidecar e lê um por linha do stdout dele.
Comandos levam um `id`; o sidecar responde cada um com `{"t": "reply", "id", "ok", "result" | "error"}`.
O resto no stdout é evento. O sidecar termina quando o stdin fecha.

| Comando `t` | Campos | Resultado |
| --- | --- | --- |
| `status` | | `{id, name, fingerprint, team, peers: [{id, name, state: direct\|relay\|connecting\|offline, rttMs, presence}], docs, rejected}` |
| `addr` | | Endereço deste endpoint (id mais endereços diretos e URL do relay). |
| `peer.add` | `addr` | Permite e disca um peer pelo endereço (anterior aos times; fica para testes e redes locais). |
| `presence` | `data` | Manda a presença de um agente local para todos os peers conectados. |
| `team.create` | `name` | Cria um time com esta instância como fundadora. |
| `invite.create` | `ttlSecs` | `{link, expiresAt}`: um convite de uso único. |
| `invite.revoke` | | Revoga todos os convites ativos. |
| `invite.inspect` | `link` | `{team, name, inviter, inviterFingerprint, fingerprint, expiresAt, expired}`: o que um link diz, antes de entrar. |
| `join` | `link` | Entra no time do convite; os workspaces compartilhados chegam depois como eventos `remote`. |
| `share` | `doc`, `state`, `author` | Começa a compartilhar um workspace: o estado atual vira o primeiro envelope. |
| `local` | `doc`, `author`, `changes` | Uma transação local gravada, como conjunto de mudanças (abaixo). |

| Evento `t` | Campos |
| --- | --- |
| `ready` | `id` (chave pública), `addr` |
| `status` | `status` (mesmo formato do comando), enviado quando muda |
| `peer` | `peer`, `state: connected\|disconnected` |
| `presence` | `peer`, `name`, `data` |
| `remote` | `doc`, `state` (workspace materializado, abaixo), `authors` |
| `rejected` | `peer`, `reason` (fora do time, assinatura inválida, convite usado/vencido/revogado…) |
| `joined` | `peer`, `name`: alguém entrou com um convite desta instância |
| `log` | `level`, `msg` |

### Conjunto de mudanças (`local`)

O Go compara o documento antes e depois de um commit e manda, nesta ordem (movimentos antes das remoções, para um nó tirado de um frame apagado sobreviver em todos os peers):

```json
[
  {"k": "create", "id": "n1", "parent": "frame1", "fields": {"type": "rect", "name": "Card", "fill": "$panel"}},
  {"k": "move",   "id": "n2", "parent": null},
  {"k": "set",    "id": "n3", "fields": {"fill": "#fff", "shadow": null}},
  {"k": "order",  "parent": "frame1", "children": ["n2", "n1", "n4"]},
  {"k": "delete", "id": "old"},
  {"k": "tokens", "mode": "", "set": {"accent": "#e04a2b", "old": null}},
  {"k": "name",   "value": "Checkout"}
]
```

`null` remove um campo ou token. `order` vai para cada contêiner cujos filhos (não derivados) mudaram; o
sidecar move nós da árvore até a ordem bater. Dados derivados nunca viajam: cópias de instância,
`x`/`y`/`width`/`height`/`d` de conectores e `width`/`height` de grupos.

### Estado materializado (`remote`)

`{name, rootIds, nodes: {id: {…campos, parentId, children?}}, tokens, modes}`: o que o documento Loro tem,
na ordem da árvore. O Go transforma a diferença com o próprio documento em ops e as aplica numa transação fora
da pilha local de undo: nós cujo pai mudou se movem primeiro, depois os que sumiram são apagados, um passeio na
ordem da árvore cria os que faltam e põe o resto no lugar, e por fim atualizações de campos, `set_tokens` e
`rename_document` (`server-go/internal/team/diff.go`). A transação fica com ator `peer:<quem>` e tipo `remote`.
Um workspace que a instância ainda não tem é criado.

## Protocolo entre peers

ALPN `paprika/sync/1`, um stream bidirecional, frames de tamanho `u32` big-endian + JSON (no máximo 64 MiB).

| Mensagem `t` | Campos | Quando |
| --- | --- | --- |
| `hello` | `name`, `addr`, `peers` (endereços dos outros membros), `team`, `have` (`{doc: {autor: seq}}`) | Primeiro frame de cada lado. |
| `envs` | `envs: [envelope]` | Envelopes que faltam ao outro lado (depois do `hello`), e cada novo ao vivo. Quem recebe repassa envelopes novos aos outros peers. |
| `team` | `team` | O arquivo de time mudou (alguém entrou). |
| `presence` | `data` | Efêmero; nunca gravado. |

Quando os dois lados discam ao mesmo tempo, fica a conexão discada pelo menor id de endpoint.

### Envelope

```json
{"doc": "jlrnsejy1z", "author": "<chave pública>", "seq": 12, "cert": null,
 "blob": "<update Loro em base64>", "sig": "<ed25519 em hex>"}
```

- `sig` cobre `paprika-env/1`, `doc`, `author`, `seq` e o SHA-256 de `blob`.
- O peer id Loro de cada mudança em `blob` vem de `author` (primeiros 8 bytes); quem recebe confere com
  `decode_import_blob_meta` antes de importar, então ninguém assina mudanças feitas com outro peer id.
- `cert` aparece quando o autor é um agente: `{member, agent, name, sig}`, assinado pelo membro que o roda. A
  chave do agente é derivada da chave do membro e do nome do cliente MCP.
- Um envelope é aceito quando o autor é membro, ou um agente com certificado válido de um membro. Senão é
  descartado e contado em `status.rejected`.

## Arquivo de time e convites

```json
{"id": "<hex de 16 bytes>", "name": "Estúdio Norte", "founder": "<chave>", "nonce": "<hex>",
 "members": [{"key": "<chave>", "name": "Ana", "addedBy": "<chave>", "at": 1795300000, "sig": "<hex>"}]}
```

- `id` é o SHA-256 de `paprika-team/1`, da chave do fundador e do nonce (primeiros 16 bytes), então outro
  fundador não consegue reivindicá-lo.
- Uma entrada de membro vale quando `addedBy` é o fundador ou um membro válido e `sig` (sobre
  `paprika-member/1`, id do time, chave, nome, addedBy, at) confere. Juntar dois arquivos de time é a união das
  entradas válidas.
- Um link de convite é `paprika://join/<id do time>?n=<nome do time>&a=<endereço de quem convida, JSON em base64url>&s=<segredo>&e=<expiração, segundos unix>`.
  Quem convida guarda só o SHA-256 do segredo, a expiração e se já foi usado. Quem entra disca para quem
  convidou no ALPN `paprika/join/1` e manda `{team, secret, name}`; quem convidou confere segredo, validade e
  uso único, assina a entrada de membro de quem entra e responde com o arquivo de time e os endereços dos
  membros.

## HTTP e WebSocket

| Rota | |
| --- | --- |
| `GET /api/team` | Status do sidecar. |
| `GET /api/team/addr` | Endereço Iroh desta instância. |
| `POST /api/team/peers` `{addr}` | Permite e disca um peer pelo endereço. |
| `POST /api/team` `{name}` | Cria um time. |
| `POST /api/team/invites` `{ttlSecs}` | Cria um link de convite. |
| `DELETE /api/team/invites` | Revoga os convites ativos. |
| `POST /api/team/invites/inspect` `{link}` | Prévia de um link (time, quem convida, impressão digital, validade). |
| `POST /api/team/join` `{link}` | Entra num time. |
| `POST /api/team/share` `{doc}` | Compartilha um workspace com o time. |

O `/ws` manda `{type: "team", status}` sempre que o status muda. Agentes remotos chegam como mensagens
`{type: "presence"}` comuns cujo `agent` começa com `peer:` e cujo `actor` termina com ` @ <pessoa>`, então o
canvas desenha os cursores deles como os locais.

## No canvas

Com `--team`, a barra superior mostra um chip com o pior estado entre os peers (só neste dispositivo, conectando, N online · sincronizado, via relay, offline, chave rejeitada) e o painel direito ganha a aba **Time** ao lado do Inspector (`apps/web/src/Team.tsx`):

- sem time: criar um, ou entrar com um link;
- com time: estado da conexão e do sync, um botão para compartilhar o workspace aberto, as pessoas com o caminho de cada uma (direto com RTT, relay, offline) e, sob cada pessoa, os agentes que rodam na instância dela (agentes remotos também ganham cursor no canvas, como `nome @ pessoa`);
- **Convidar**: link e QR, validade (15 min, 1 h, 24 h, 7 dias), contagem regressiva, a impressão digital do time para ler em voz alta, revogar;
- **Entrar**: colar um link, prévia (time, impressão digital, sua chave) antes de entrar, erros claros para link vencido ou usado;
- **Chaves do time**: chaves dos membros, quem adicionou cada uma, os agentes de cada um, operações rejeitadas.

## Limites (v1)

- Um time por instância. Sair, remover membro e trocar chaves não estão implementados.
- O undo reverte só transações locais; pode falhar em parte quando um peer apagou o que ele toca.
- Um merge que o core recusa (raro: edições estruturais concorrentes que quebram as regras de páginas) é
  aplicado op por op e o resto é informado; a próxima edição que o torne válido conserta.
- O estado inteiro do workspace atravessa o stdio a cada mudança remota (ok para documentos de alguns milhares
  de nós).
