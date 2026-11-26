[🇺🇸 English](../en-US/team-sync.md) | 🇧🇷 Português

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
cp crates/sync/target/release/paprika-sync server/bin/      # ao lado do paprika, ou defina PAPRIKA_SYNC
server/bin/paprika serve --team --team-name Ana
```

| Flag | Padrão | Significado |
| --- | --- | --- |
| `--team` | desligado | Sobe o sidecar e entra no modo time. Sem ela (ou sem o binário) o servidor é só local. |
| `--team-dir` | `<db>.team/` | Chave (`key`, modo 0600), arquivo de time, convites e o log de operações. |
| `--team-name` | `$USER` | Como os outros membros veem você. |
| `--team-no-relay` | desligado | Sem relays públicos nem busca de endereço por DNS: só loopback/rede local (testes). |
| `--team-bind` | qualquer | Endereço UDP do endpoint Iroh, por exemplo `127.0.0.1:0`. |

A imagem Docker leva o `paprika-sync` ao lado do `paprika`; no Compose, acrescente o `compose.team.yaml` ([docker.md](docker.md#modo-time)).

## Camadas

| Camada | Onde | O que faz |
| --- | --- | --- |
| Transporte | `crates/sync/src/node.rs`, `proto.rs` | Um endpoint Iroh por instância (a chave dele é a chave de membro). Uma conexão QUIC por peer, um stream bidirecional de frames JSON com prefixo de tamanho no ALPN `paprika/sync/1`. Conexões de chaves fora do time são fechadas antes de qualquer leitura. |
| CRDT | `crates/sync/src/crdt.rs` | Um documento Loro por workspace compartilhado: um `LoroTree` para os nós (campos nos metadados de cada nó da árvore, uma chave em que o último a escrever vence por campo) e mapas para nome, tokens, modos, apontamentos e respostas. Apontamentos não são nós do canvas. |
| Segurança | `crates/sync/src/team.rs`, `envelope.rs`, `keys.rs` | Arquivo de time (allowlist), envelopes assinados, delegação a agentes, convites. |
| Ponte Go | `server/internal/team` | Sobe e supervisiona o sidecar, transforma commits locais em conjuntos de mudanças e estados remotos em transações `applyOps`, serve `/api/team/*` e manda `{type: "team"}` em `/ws`. |

## Protocolo do sidecar (stdio)

O servidor Go escreve um objeto JSON por linha no stdin do sidecar e lê um por linha do stdout dele.
Comandos levam um `id`; o sidecar responde cada um com `{"t": "reply", "id", "ok", "result" | "error"}`.
O resto no stdout é evento. O sidecar termina quando o stdin fecha.

| Comando `t` | Campos | Resultado |
| --- | --- | --- |
| `status` | | `{id, name, fingerprint, app, format, team, peers: [{id, name, state: direct\|relay\|connecting\|offline, rttMs, app, format, presence}], docs, rejected}` |
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
| `member.remove` | `key` | Só quem fundou: assina a remoção desse membro (abaixo) e espalha. `{removed}` |
| `member.leave` | | Este membro assina a própria saída e espalha. `{left}`. Quem fundou não sai. |
| `key.rotate` | | Troca a chave desta instância (abaixo). `{old, new, fingerprint, restart: true}`: o servidor Go reinicia o sidecar. |

| Evento `t` | Campos |
| --- | --- |
| `ready` | `id` (chave pública), `addr` |
| `status` | `status` (mesmo formato do comando), enviado quando muda |
| `peer` | `peer`, `state: connected\|disconnected` |
| `presence` | `peer`, `name`, `data` |
| `remote` | `doc`, `state` (workspace materializado, abaixo), `authors` |
| `rejected` | `peer`, `reason` (fora do time, assinatura inválida, convite usado/vencido/revogado, formato de documento incompatível…) |
| `log` | `level`, `msg` (ex.: warn quando as versões de app diferem mas o formato bate) |
| `joined` | `peer`, `name`: alguém entrou com um convite desta instância |
| `removed` | `peer`: esta instância removeu esse membro |

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

Apontamentos viajam no mesmo conjunto de mudanças, e não como nós: `{"k":"pin","id","value"}` (o cabeçalho; `null` remove) e `{"k":"reply","id","value"}` (uma mensagem). Cada resposta é uma chave própria, então dois peers podem acrescentar uma ao mesmo tempo. O cabeçalho do apontamento fica com o último a escrever. O servidor Go grava isso na tabela de apontamentos; não chama `applyOps`.

### Estado materializado (`remote`)

`{name, rootIds, nodes: {id: {…campos, parentId, children?}}, tokens, modes}`: o que o documento Loro tem,
na ordem da árvore. O Go transforma a diferença com o próprio documento em ops e as aplica numa transação fora
da pilha local de undo: nós cujo pai mudou se movem primeiro, depois os que sumiram são apagados, um passeio na
ordem da árvore cria os que faltam e põe o resto no lugar, e por fim atualizações de campos, `set_tokens` e
`rename_document` (`server/internal/team/diff.go`). A transação fica com ator `peer:<quem>` e tipo `remote`.
Um workspace que a instância ainda não tem é criado.

## Protocolo entre peers

ALPN `paprika/sync/1`, um stream bidirecional, frames de tamanho `u32` big-endian + JSON (no máximo 64 MiB).

| Mensagem `t` | Campos | Quando |
| --- | --- | --- |
| `hello` | `name`, `addr`, `peers` (endereços dos outros membros), `team`, `have` (`{doc: {autor: seq}}`), `app` (semver do paprika-sync), `format` (formato do documento, ex. `paprika/1`) | Primeiro frame de cada lado. |
| `envs` | `envs: [envelope]` | Envelopes que faltam ao outro lado (depois do `hello`), e cada novo ao vivo. Quem recebe repassa envelopes novos aos outros peers. |
| `team` | `team` | O arquivo de time mudou (alguém entrou). |
| `presence` | `data` | Efêmero; nunca gravado. |

Quando os dois lados discam ao mesmo tempo, fica a conexão discada pelo menor id de endpoint.

### Compatibilidade de versões

Os ALPNs continuam versionados como hoje (`paprika/sync/1`, `paprika/join/1`). Em cada `hello` de sync e em cada pedido/resposta de join, os peers também trocam **app** (versão do pacote `crates/sync`) e **format** (string do formato do documento, a mesma de `packages/core` `FORMAT` / `paprika/1`):

| Caso | Comportamento |
| --- | --- |
| Mesmo `format`, mesmo `app` | Sync / join como de costume. |
| Mesmo `format`, `app` diferente | Sync / join segue; os dois lados emitem um warn com quem, as duas versões de app e que o formato bate. |
| `format` diferente, ou o peer omitiu `format` | Sync / join é recusado. Os dois lados recebem um erro acionável (quem, format/app local vs do peer, como atualizar: mesmo build / imagem Docker, depois reconectar). A conexão de sync fecha com código de aplicação `3`. |

`GET /api/team` (e o payload WebSocket `{type: "team", status}`) expõem `app` / `format` locais no status e o último `app` / `format` conhecido de cada entrada em `peers`.

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
  convidou no ALPN `paprika/join/1` e manda `{team, secret, name, app, format}`; quem convidou confere segredo,
  validade, uso único e compatibilidade de formato, assina a entrada de membro de quem entra e responde com o
  arquivo de time, os endereços dos membros e o próprio `app` / `format`. Quem entra confere as versões de quem
  convidou antes de gravar o arquivo de time.

### Remover membro, trocar chave

O arquivo de time também leva `removals` e `rotations` (fora do JSON enquanto vazios, então arquivos antigos
carregam como estão):

```json
"removals":  [{"key": "<chave>", "by": "<chave de quem fundou>", "at": 1795300500, "upto": {"<doc>": {"<autor>": 12}}, "sig": "<hex>"}],
"rotations": [{"old": "<chave>", "new": "<chave>", "at": 1795300600, "upto": {…}, "sigOld": "<hex>", "sigNew": "<hex>"}]
```

- **Cadeia de fundação:** a chave de quem fundou e cada chave para a qual ela foi trocada. Só a última chave da
  cadeia remove membros, e nenhuma chave da cadeia pode ser removida.
- **Remoção** (assinada por quem fundou sobre `paprika-remove/1`, time, chave, by, at e o JSON canônico de
  `upto`): a chave deixa de ser membro. **Troca** (assinada pela chave antiga *e* pela nova sobre
  `paprika-rotate/1`, …): a chave nova herda nome e direitos, a antiga é aposentada. Vale a primeira troca de
  cada chave antiga; uma troca depois da remoção não conta.
- **`upto`** é o corte: por workspace e chave de autor (a chave do membro e as dos agentes dele), o maior número
  de sequência ainda aceito de uma chave que saiu. Sai do log de quem assina, então quem entra depois ainda
  reproduz o histórico; o que vier depois é recusado (`rejected`). Envelopes do membro removido que quem fundou
  ainda não tinha recebido se perdem para os peers que também não os tinham.
- Entradas de membro só contam se quem assinou não tinha saído antes do `at` delas. Remoções e trocas se fundem
  como membros (união das que têm assinatura válida).
- Uma instância removida fica sabendo pelo arquivo de time, fecha as conexões e mostra o aviso (status
  `team.member: false`); as mudanças dela ficam naquele dispositivo. Os peers fecham a conexão com a chave que saiu.
- **Passos da troca:** o sidecar recusa quando ninguém do time está online (a chave nova não chegaria a
  ninguém), exceto num time de uma pessoa só. Grava a chave nova em `key.next`, salva o arquivo de time, revoga
  os convites ativos (os links levam o endereço antigo), manda o arquivo de time aos peers e responde; o
  servidor Go reinicia o sidecar, que só adota `key.next` na partida se o arquivo de time tiver essa troca. Os
  endereços conhecidos ficam em `addrs.json` para as primeiras conexões.

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
| `DELETE /api/team/members/{key}` | Remove um membro (só quem fundou). |
| `POST /api/team/leave` | Este membro sai do time. Quem fundou não sai. |
| `POST /api/team/rotate` | Troca a chave desta instância e reinicia o sidecar. |

O `/ws` manda `{type: "team", status}` sempre que o status muda. Agentes remotos chegam como mensagens
`{type: "presence"}` comuns cujo `agent` começa com `peer:` e cujo `actor` termina com ` @ <pessoa>`, então o
canvas desenha os cursores deles como os locais.

## No canvas

Com `--team`, a barra superior mostra um chip com o pior estado entre os peers (só neste dispositivo, conectando, N online · sincronizado, via relay, offline, chave rejeitada) e o painel direito ganha a aba **Time** ao lado do Inspector (`web-legacy/src/Team.tsx`):

- sem time: criar um, ou entrar com um link;
- com time: estado da conexão e do sync, um botão para compartilhar o workspace aberto, as pessoas com o caminho de cada uma (direto com RTT, relay, offline) e, sob cada pessoa, os agentes que rodam na instância dela (agentes remotos também ganham cursor no canvas, como `nome @ pessoa`);
- **Convidar**: link e QR, validade (15 min, 1 h, 24 h, 7 dias), contagem regressiva, a impressão digital do time para ler em voz alta, revogar;
- **Entrar**: colar um link, prévia (time, impressão digital, sua chave) antes de entrar, erros claros para link vencido ou usado;
- **Chaves do time**: chaves dos membros, quem adicionou cada uma, os agentes de cada um, membros removidos, operações rejeitadas; **Gerar nova chave** na sua linha e **Remover** nas outras (só quem fundou), cada um com confirmação;
- **Remover** também aparece ao lado de cada pessoa na aba Time para quem fundou; uma instância removida mostra um aviso e deixa de oferecer convites.
- **Sair do time** fica na sua própria linha quando você não fundou o time. Assina a sua saída. Quem fundou não vê esse botão.

## Limites (v1)

- Um time por instância. Quem não fundou sai por conta própria (`POST /api/team/leave`, uma remoção assinada por si). Quem fundou não sai: a cadeia de fundador não pode ser removida. Papéis de aprovação não estão implementados.
- Remoção e troca se ordenam pelo `at` do relógio de quem assina; um membro removido poderia antedatar uma
  entrada que ele assina. Papéis (aprovação por revisor/editor) não estão implementados.
- O undo reverte só transações locais; pode falhar em parte quando um peer apagou o que ele toca.
- Um merge que o core recusa (raro: edições estruturais concorrentes que quebram as regras de páginas) é
  aplicado op por op e o resto é informado; a próxima edição que o torne válido conserta.
- O estado inteiro do workspace atravessa o stdio a cada mudança remota (ok para documentos de alguns milhares
  de nós).
