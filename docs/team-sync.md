🇺🇸 English | [🇧🇷 Português](pt-BR/sincronizacao-time.md)

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
cp crates/sync/target/release/paprika-sync server-go/bin/      # next to paprika, or set PAPRIKA_SYNC
server-go/bin/paprika serve --team --team-name Ana
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--team` | off | Start the sidecar and join the team mode. Without it (or without the binary) the server is local only. |
| `--team-dir` | `<db>.team/` | Key (`key`, mode 0600), team file, invites and the operation log. |
| `--team-name` | `$USER` | How the other members see you. |
| `--team-no-relay` | off | No public relays or DNS address lookup: loopback/LAN only (tests). |
| `--team-bind` | any | UDP address of the Iroh endpoint, for example `127.0.0.1:0`. |

The Docker image ships `paprika-sync` next to `paprika` ([docker.md](docker.md)).

## Layers

| Layer | Where | What it does |
| --- | --- | --- |
| Transport | `crates/sync/src/node.rs`, `proto.rs` | One Iroh endpoint per instance (its key is the member key). One QUIC connection per peer, one bidirectional stream of length-prefixed JSON frames on ALPN `paprika/sync/1`. Connections from keys outside the team are closed before anything is read. |
| CRDT | `crates/sync/src/crdt.rs` | One Loro document per shared workspace: a `LoroTree` for the nodes (fields in each tree node's metadata, one last-writer-wins key per field) and maps for the name, tokens and modes. |
| Security | `crates/sync/src/team.rs`, `envelope.rs`, `keys.rs` | Team file (allowlist), signed envelopes, agent delegation, invites. |
| Go bridge | `server-go/internal/team` | Starts and supervises the sidecar, turns local commits into change sets and remote states into `applyOps` transactions, serves `/api/team/*` and pushes `{type: "team"}` on `/ws`. |

## Sidecar protocol (stdio)

The Go server writes one JSON object per line to the sidecar's stdin and reads one per line from its
stdout. Commands carry an `id`; the sidecar answers each with `{"t": "reply", "id", "ok", "result" | "error"}`.
Everything else on stdout is an event. The sidecar exits when its stdin closes.

| Command `t` | Fields | Result |
| --- | --- | --- |
| `status` | | `{id, name, fingerprint, team, peers: [{id, name, state: direct\|relay\|connecting\|offline, rttMs, presence}], docs, rejected}` |
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

| Event `t` | Fields |
| --- | --- |
| `ready` | `id` (public key), `addr` |
| `status` | `status` (same shape as the command), sent when it changes |
| `peer` | `peer`, `state: connected\|disconnected` |
| `presence` | `peer`, `name`, `data` |
| `remote` | `doc`, `state` (materialized workspace, below), `authors` |
| `rejected` | `peer`, `reason` (not a member, bad signature, invite used/expired/revoked…) |
| `joined` | `peer`, `name`: someone joined with an invite from this instance |
| `log` | `level`, `msg` |

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

### Materialized state (`remote`)

`{name, rootIds, nodes: {id: {…fields, parentId, children?}}, tokens, modes}`: what the Loro document holds,
in tree order. Go turns the difference with its document into ops and applies them in one transaction outside
the local undo stack: nodes whose parent changed move first, then gone nodes are deleted, a walk in tree order
creates the missing ones and puts the rest in place, then field updates, `set_tokens` and `rename_document`
(`server-go/internal/team/diff.go`). The transaction is recorded with actor `peer:<who>` and kind `remote`.
A workspace the instance does not have yet is created.

## Peer protocol

ALPN `paprika/sync/1`, one bidirectional stream, frames of `u32` big-endian length + JSON (64 MiB max).

| Message `t` | Fields | When |
| --- | --- | --- |
| `hello` | `name`, `addr`, `peers` (addresses of other members), `team`, `have` (`{doc: {author: seq}}`) | First frame on each side. |
| `envs` | `envs: [envelope]` | Envelopes the other side lacks (after `hello`), then each new one live. Receivers forward new envelopes to their other peers. |
| `team` | `team` | The team file changed (a member joined). |
| `presence` | `data` | Ephemeral; never stored. |

When both sides dial at once, the connection dialed by the smaller endpoint id is kept.

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
  inviter on ALPN `paprika/join/1` and sends `{team, secret, name}`; the inviter checks the secret, expiry and
  single use, signs the joiner's member entry and answers with the team file and the members' addresses.

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

`/ws` sends `{type: "team", status}` whenever the status changes. Remote agents arrive as ordinary
`{type: "presence"}` messages whose `agent` starts with `peer:` and whose `actor` ends with ` @ <person>`, so
the canvas draws their cursors like local ones.

## Limits (v1)

- One team per instance. Leaving, removing a member and rotating keys are not implemented.
- Undo reverts local transactions only; it can fail in part when a peer deleted what it touches.
- A merge that the core rejects (rare: concurrent structural edits that break page rules) is applied op by op
  and the rest is reported; the next edit that makes it valid heals it.
- The full workspace state crosses stdio on each remote change (fine for documents of a few thousand nodes).
