🇺🇸 English | [🇧🇷 Português](../pt-BR/sincronizacao-time.md)

# Team sync (peer to peer)

Each person runs their own Paprika with their own agents; the instances of a team find each other over
[Iroh](https://www.iroh.computer/) and converge on the same workspaces through a [Loro](https://loro.dev) CRDT.
There is no central server. Why it is built this way: [ADR 0004](adr/0004-p2p-team-sync.md).

```
 person A's machine                                   person B's machine
 ┌────────────── paprika serve --team ─────────────┐  ┌────────────── paprika serve --team ─────────────┐
 │ canvas ─ws─┐   agents ─MCP─┐                     │  │                                                 │
 │            ▼               ▼                     │  │                                                 │
 │       Store (applyOps, SQLite) ◄─► internal/team │  │  internal/team ◄─► Store (applyOps, SQLite)     │
 │                                   │ JSON lines   │  │       │ JSON lines                              │
 │                                   ▼              │  │       ▼                                         │
 │                    paprika-sync (Loro, keys) ◄═══╪══╪═► paprika-sync      QUIC: direct, or via relay   │
 └─────────────────────────────────────────────────┘  └─────────────────────────────────────────────────┘
```

## Running it

```bash
cargo build --release --manifest-path crates/sync/Cargo.toml
cp crates/sync/target/release/paprika-sync server/bin/      # next to paprika, or set PAPRIKA_SYNC
server/bin/paprika serve --team --team-name Ana
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--team` | off | Start the sidecar and join the team mode. Without it (or without the binary) the server is local only. |
| `--team-dir` | `<db>.team/` | Key (`key`, mode 0600), team file, invites and the operation log. |
| `--team-name` | `$USER` | How the other members see you. |
| `--team-no-relay` | off | No public relays or DNS address lookup: loopback/LAN only (tests). |
| `--team-bind` | any | UDP address of the Iroh endpoint, for example `127.0.0.1:0`. |

The Docker image ships `paprika-sync` next to `paprika`; with Compose, add `compose.team.yaml` ([docker.md](docker.md#team-mode)).

## Layers

| Layer | Where | What it does |
| --- | --- | --- |
| Transport | `crates/sync/src/node.rs`, `proto.rs` | One Iroh endpoint per instance (its key is the member key). One QUIC connection per peer, one bidirectional stream of length-prefixed JSON frames on ALPN `paprika/sync/1`. Connections from keys outside the team are closed before anything is read. |
| CRDT | `crates/sync/src/crdt.rs` | One Loro document per shared workspace: a `LoroTree` for the nodes (fields in each tree node's metadata, one last-writer-wins key per field) and maps for the name, tokens, modes, pins and pin replies. Pins are not canvas nodes. |
| Security | `crates/sync/src/team.rs`, `envelope.rs`, `keys.rs` | Team file (allowlist), signed envelopes, agent delegation, invites. |
| Go bridge | `server/internal/team` | Starts and supervises the sidecar, turns local commits into change sets and remote states into `applyOps` transactions, serves `/api/team/*` and pushes `{type: "team"}` on `/ws`. |

## Sidecar protocol (stdio)

The Go server writes one JSON object per line to the sidecar's stdin and reads one per line from its
stdout. Commands carry an `id`; the sidecar answers each with `{"t": "reply", "id", "ok", "result" | "error"}`.
Everything else on stdout is an event. The sidecar exits when its stdin closes.

| Command `t` | Fields | Result |
| --- | --- | --- |
| `status` | | `{id, name, fingerprint, app, format, team, peers: [{id, name, state: direct\|relay\|connecting\|offline, rttMs, app, format, presence}], docs, rejected}` |
| `addr` | | This endpoint's address (id plus direct addresses and relay URL). |
| `peer.add` | `addr` | Allows and dials a peer by address (before teams; kept for tests and LAN setups). |
| `presence` | `data` | Sends a local agent's presence to every connected peer. |
| `team.create` | `name` | Creates a team with this instance as founder. |
| `invite.create` | `ttlSecs` | `{link, expiresAt}`: a single-use invite. |
| `invite.revoke` | | Revokes every active invite. |
| `invite.inspect` | `link` | `{team, name, inviter, inviterFingerprint, fingerprint, expiresAt, expired}`: what a link says, before joining. |
| `join` | `link` | Joins the team behind the invite; the shared workspaces then arrive as `remote` events. |
| `share` | `doc`, `state`, `author` | Starts sharing a workspace: its current state becomes the first envelope. |
| `local` | `doc`, `author`, `changes` | One committed local transaction as a change set (below). |
| `member.remove` | `key` | Founder only: signs a removal of that member (see below) and spreads it. `{removed}` |
| `member.leave` | | This member signs their own removal and spreads it. `{left}`. The founder cannot leave. |
| `key.rotate` | | Replaces this instance's key (below). `{old, new, fingerprint, restart: true}`: the Go server restarts the sidecar. |

| Event `t` | Fields |
| --- | --- |
| `ready` | `id` (public key), `addr` |
| `status` | `status` (same shape as the command), sent when it changes |
| `peer` | `peer`, `state: connected\|disconnected` |
| `presence` | `peer`, `name`, `data` |
| `remote` | `doc`, `state` (materialized workspace, below), `authors` |
| `rejected` | `peer`, `reason` (not a member, bad signature, invite used/expired/revoked, incompatible document format…) |
| `log` | `level`, `msg` (e.g. warn when peer app versions differ but format matches) |
| `joined` | `peer`, `name`: someone joined with an invite from this instance |
| `removed` | `peer`: this instance removed that member |

### Change set (`local`)

Go diffs the document before and after a commit and sends, in order (moves come before deletes, so a node moved out of a deleted frame survives on every peer):

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

`null` removes a field or token. `order` is sent for every container whose (non-derived) children changed;
the sidecar moves tree nodes until the order matches. Derived data never travels: instance copies, a
connector's `x`/`y`/`width`/`height`/`d` and a group's `width`/`height`.

Pins travel in the same change set, not as nodes: `{"k":"pin","id","value"}` (the pin header; `null` removes it) and `{"k":"reply","id","value"}` (one message). Each reply is its own key, so two peers can add one at the same time. The pin header is last-writer-wins. The Go server writes them into the pins table; it does not call `applyOps`.

### Materialized state (`remote`)

`{name, rootIds, nodes: {id: {…fields, parentId, children?}}, tokens, modes}`: what the Loro document holds,
in tree order. Go turns the difference with its document into ops and applies them in one transaction outside
the local undo stack: nodes whose parent changed move first, then gone nodes are deleted, a walk in tree order
creates the missing ones and puts the rest in place, then field updates, `set_tokens` and `rename_document`
(`server/internal/team/diff.go`). The transaction is recorded with actor `peer:<who>` and kind `remote`.
A workspace the instance does not have yet is created.

## Peer protocol

ALPN `paprika/sync/1`, one bidirectional stream, frames of `u32` big-endian length + JSON (64 MiB max).

| Message `t` | Fields | When |
| --- | --- | --- |
| `hello` | `name`, `addr`, `peers` (addresses of other members), `team`, `have` (`{doc: {author: seq}}`), `app` (paprika-sync semver), `format` (document format, e.g. `paprika/1`) | First frame on each side. |
| `envs` | `envs: [envelope]` | Envelopes the other side lacks (after `hello`), then each new one live. Receivers forward new envelopes to their other peers. |
| `team` | `team` | The team file changed (a member joined). |
| `presence` | `data` | Ephemeral; never stored. |

When both sides dial at once, the connection dialed by the smaller endpoint id is kept.

### Version compatibility

ALPNs stay versioned as today (`paprika/sync/1`, `paprika/join/1`). On every sync `hello` and every join request/reply, peers also exchange **app** (`crates/sync` package version) and **format** (the document format string, same as `packages/core` `FORMAT` / `paprika/1`):

| Case | Behaviour |
| --- | --- |
| Same `format`, same `app` | Sync / join as usual. |
| Same `format`, different `app` | Sync / join continues; both sides emit a warn log naming who, both app versions, and that the format matches. |
| Different `format`, or peer omitted `format` | Sync / join is refused. Both sides get an actionable error (who, local vs peer format and app, how to update: same build / Docker image, then reconnect). The sync connection is closed with application error code `3`. |

`GET /api/team` (and the `{type: "team", status}` WebSocket payload) expose local `app` / `format` on the status object and each peer's last known `app` / `format` on every entry in `peers`.

### Envelope

```json
{"doc": "jlrnsejy1z", "author": "<public key>", "seq": 12, "cert": null,
 "blob": "<base64 Loro update>", "sig": "<hex ed25519>"}
```

- `sig` covers `paprika-env/1`, `doc`, `author`, `seq` and the SHA-256 of `blob`.
- The Loro peer id of every change in `blob` is derived from `author` (first 8 bytes); the receiver checks it
  with `decode_import_blob_meta` before importing, so nobody can sign changes made under another peer id.
- `cert` is present when the author is an agent: `{member, agent, name, sig}`, signed by the member that runs
  it. An agent's key is derived from its member's key and its MCP client name.
- An envelope is accepted when its author is a member, or an agent with a valid certificate from a member.
  Otherwise it is dropped and counted in `status.rejected`.

## Team file and invites

```json
{"id": "<16-byte hex>", "name": "Estúdio Norte", "founder": "<key>", "nonce": "<hex>",
 "members": [{"key": "<key>", "name": "Ana", "addedBy": "<key>", "at": 1795300000, "sig": "<hex>"}]}
```

- `id` is the SHA-256 of `paprika-team/1`, the founder key and the nonce (first 16 bytes), so it cannot be
  claimed by another founder.
- A member entry is valid when `addedBy` is the founder or a valid member and `sig` (over `paprika-member/1`,
  team id, key, name, addedBy, at) verifies. Merging two team files is the union of their valid entries.
- An invite link is `paprika://join/<team id>?n=<team name>&a=<inviter address, base64url JSON>&s=<secret>&e=<expiry, unix seconds>`.
  The inviter keeps only the SHA-256 of the secret, its expiry and whether it was used. The joiner dials the
  inviter on ALPN `paprika/join/1` and sends `{team, secret, name, app, format}`; the inviter checks the secret, expiry,
  single use and format compatibility, signs the joiner's member entry and answers with the team file, the members'
  addresses and its own `app` / `format`. The joiner checks the inviter's versions before saving the team file.

### Removing a member, rotating a key

The team file also carries `removals` and `rotations` (left out of the JSON while empty, so older files load
as they are):

```json
"removals":  [{"key": "<key>", "by": "<founder key>", "at": 1795300500, "upto": {"<doc>": {"<author>": 12}}, "sig": "<hex>"}],
"rotations": [{"old": "<key>", "new": "<key>", "at": 1795300600, "upto": {…}, "sigOld": "<hex>", "sigNew": "<hex>"}]
```

- **Founder chain:** the founder key, then each key it rotated to. Only the last key of the chain removes
  members, and no key of the chain can be removed.
- **Removal** (signed by the founder over `paprika-remove/1`, team, key, by, at and the canonical JSON of
  `upto`): the key stops being a member. **Rotation** (signed by the old *and* the new key over
  `paprika-rotate/1`, …): the new key takes the old one's name and rights, the old one is retired. The first
  rotation per old key wins; a rotation after the key was removed does not count.
- **`upto`** is the cut: per workspace and author key (the member's own key and its agents' keys), the highest
  sequence number still accepted from a key that left. It is taken from the signer's own log, so a newcomer can
  still replay the history; anything later is refused (`rejected`). Envelopes of the removed member that the
  founder had not received yet are lost for the peers that did not have them either.
- Member entries count only when their signer had not left before their `at`. Removals and rotations merge like
  members (union of the ones whose signatures verify).
- A removed instance learns it from the team file, closes its connections and shows it (status
  `team.member: false`); its changes stay on that device. Peers close their connection to a key that left.
- **Rotation steps:** the sidecar refuses it when nobody of the team is online (the new key would reach no one),
  except in a team of one. It writes the new key to `key.next`, saves the team file, revokes the active invites
  (their links carry the old address), sends the team file to the peers and returns; the Go server restarts the
  sidecar, which swaps `key.next` in at start only when the team file has that rotation. The addresses it knew
  are kept in `addrs.json` for the first dials.

## HTTP and WebSocket

| Route | |
| --- | --- |
| `GET /api/team` | The sidecar status. |
| `GET /api/team/addr` | This instance's Iroh address. |
| `POST /api/team/peers` `{addr}` | Allow and dial a peer by address. |
| `POST /api/team` `{name}` | Create a team. |
| `POST /api/team/invites` `{ttlSecs}` | Create an invite link. |
| `DELETE /api/team/invites` | Revoke the active invites. |
| `POST /api/team/invites/inspect` `{link}` | Preview a link (team, inviter, fingerprint, expiry). |
| `POST /api/team/join` `{link}` | Join a team. |
| `POST /api/team/share` `{doc}` | Share a workspace with the team. |
| `DELETE /api/team/members/{key}` | Remove a member (founder only). |
| `POST /api/team/leave` | This member leaves the team. The founder cannot leave. |
| `POST /api/team/rotate` | Rotate this instance's key and restart the sidecar. |

`/ws` sends `{type: "team", status}` whenever the status changes. Remote agents arrive as ordinary
`{type: "presence"}` messages whose `agent` starts with `peer:` and whose `actor` ends with ` @ <person>`, so
the canvas draws their cursors like local ones.

## On the canvas

With `--team`, the top bar shows one chip with the worst state across peers (only this device, connecting, N online · synced, via relay, offline, key rejected) and the right panel gets a **Time** tab next to the Inspector (`apps/web/src/editor/regions/team.tsx`):

- no team yet: create one, or join with a link;
- a team: connection and sync state, a button to share the open workspace, people with their path (direct with RTT, relay, offline) and, under each person, the agents running on their instance (remote agents also get their cursor on the canvas, as `name @ person`);
- **Convidar**: a link and its QR, expiry (15 min, 1 h, 24 h, 7 days), countdown, the team fingerprint to read aloud, revoke;
- **Entrar**: paste a link, preview (team, fingerprint, your key) before joining, clear errors for expired or used links;
- **Chaves do time**: members' keys, who added them, the agents each one runs, removed members, rejected operations; **Gerar nova chave** on your own row and **Remover** on the others (founder only), each with a confirmation;
- **Remover** also sits next to each person in the Time tab for the founder; a removed instance shows a notice and no longer offers invites.
- **Sair do time** sits on your own row when you are not the founder. It signs your removal. The founder does not get that button.

## Limits (v1)

- One team per instance. A member who is not the founder leaves on their own (`POST /api/team/leave`, a self-signed removal). The founder cannot leave: the founder chain cannot be removed. Approval roles are not implemented.
- Removal and rotation order by the `at` of the signer's clock; a removed member could backdate an entry it
  signs. Roles (approval by reviewer/editor) are not implemented.
- Undo reverts local transactions only; it can fail in part when a peer deleted what it touches.
- A merge that the core rejects (rare: concurrent structural edits that break page rules) is applied op by op
  and the rest is reported; the next edit that makes it valid heals it.
- The full workspace state crosses stdio on each remote change (fine for documents of a few thousand nodes).
