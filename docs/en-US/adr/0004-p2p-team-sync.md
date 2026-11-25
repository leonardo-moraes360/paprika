🇺🇸 English | [🇧🇷 Português](../../pt-BR/adr/0004-sincronizacao-p2p-de-time.md)

# ADR 0004: Peer-to-peer team sync (Iroh transport, Loro CRDT, Rust sidecar)

- **Status:** Accepted
- **Date:** 2026-11-21
- **Code:** `crates/sync` (sidecar `paprika-sync`), `server/internal/team` (supervisor, diff and apply)
- **Spec:** [team sync protocol](../team-sync.md)

## Context

A small team wants each person to run their own local Paprika, with their own agents, and see everyone
else (people and agents) editing the same workspaces, **without a central server**. The maintainer already
chose the building blocks:

1. **Transport: [Iroh](https://www.iroh.computer/)**: QUIC connections dialed by public key, hole punching,
   relays as a fallback, ed25519 identities.
2. **Convergence by CRDT**, with no arbiter. Undo and batches have to become CRDT operations.
3. **Security:** an allowlist of the team's public keys (a team file), operations signed by their author
   (person or agent), and invites by link or QR that expire. Approval roles come later.

Two facts shape how this fits Paprika:

- The server is Go (ADR 0001) and keeps the invariants: every mutation goes through `applyOps`, unknown fields
  are rejected, derived data (instance copies, connector geometry, group boxes) is recomputed by the core.
- Iroh is a Rust library. There is no supported Go implementation and no official Go binding.

## Decision

### 1. Bridge: a Rust sidecar, `paprika-sync`, spoken to over stdio

`paprika serve` starts `paprika-sync` as a child process when the instance belongs to a team and talks to it
with newline-delimited JSON on stdin/stdout. The sidecar owns the network, the CRDT documents and the keys;
the Go server stays the only writer of SQLite and the only place where `applyOps` runs.

| Option | Why not |
| --- | --- |
| **Sidecar process (chosen)** | Two binaries to build and ship. In exchange: the Go build stays pure Go (`CGO_ENABLED=0`, `modernc.org/sqlite`), a crash in the network stack cannot take the canvas down, and the sidecar can be tested on its own. |
| iroh-ffi bindings | Official targets are Python, Swift, Kotlin and JavaScript. Go would need `uniffi-bindgen-go` (third party) **and** cgo, and the FFI surface lags the Rust API. |
| Rust static library through cgo | Gives up the pure-Go build and cross compilation, puts a Tokio runtime inside the Go process and makes every Rust panic a server crash. |
| Rewrite the transport in Go (quic-go) | Iroh's value is hole punching, relays and address lookup by key; reimplementing that is the project, not a bridge. |

Without the sidecar binary the server works as before (local only); team features report
`sidecar not found`.

### 2. CRDT: Loro, with the node tree in a `LoroTree`

| | Loro 1.x | Automerge 0.12 |
| --- | --- | --- |
| Language | Rust core (JS/WASM, Swift bindings) | Rust core (JS, C) |
| Tree with concurrent moves | **Native `LoroTree`**: moves are CRDT operations, cycles are impossible by construction, siblings ordered by fractional index | No tree type; a move is delete + insert, so concurrent moves duplicate nodes and the app must repair cycles |
| Per-field merge | `LoroMap` per node (last writer wins per key) | Map per node (same) |
| Incremental export | `export(updates from version vector)`, `import` buffers out-of-order changes | Equivalent |
| Blob metadata without importing | `decode_import_blob_meta` (which peers a blob carries) | Must load the changes |

Paprika's document is a tree whose structure changes all the time (move, group, ungroup, pages), so the
native movable tree decides it. Mapping:

- one `LoroTree` (`nodes`): one tree node per Paprika node; parent = `parentId`, sibling order = `children`
  / `rootIds`; the tree node's metadata map holds the node's stored fields (`id`, `type`, `name`, `fill`…),
  each one a separate last-writer-wins key;
- `LoroMap`s for the document name, `tokens` and `modes`;
- **not synced:** derived data. Instance copies, a connector's `x`/`y`/`width`/`height`/`d` and a group's
  `width`/`height` are recomputed by `applyOps` on every peer, exactly as they are locally.

### 3. The Go server stays authoritative for validity

- **Local change:** after every commit (canvas, MCP, HTTP; apply, undo or redo) the team package diffs the
  previous and the new document and sends the changed fields, moves, creations and deletions as **one change
  set**. The sidecar writes it as **one Loro commit**. A batch (several MCP calls with the same `batch`) is
  already one transaction, so it becomes one commit; an undo is the inverse transaction, so it becomes an
  ordinary forward commit and reaches every peer. Undo stays local in scope: it reverts transactions made on
  this instance, never a peer's.
- **Remote change:** the sidecar imports verified changes and sends back the materialized state of the
  workspace. Go turns the difference into `delete`, `create`, `move`, `update`, `set_tokens` and
  `rename_document` ops and runs them through `applyOps` in one transaction, outside the local undo stack.
  Derived data is recomputed there, so the canvas, screenshots and exports stay identical on every peer.
- **Invalid merges:** two valid concurrent edits can merge into something the core rejects (for example a
  frame moved into a page while another peer turned the document into loose frames). The Go side applies what
  it can, op by op, and reports the rest as a sync warning; the CRDT keeps both edits, so the next edit that
  makes the merge valid heals it. Making the merge itself schema-aware is future work.

### 4. Identity, signatures and the team file

- Each instance has one ed25519 key, stored in the sidecar's data directory (mode `0600`). It is both the
  Iroh endpoint id and the **member** key of the person running the instance.
- Each local agent (MCP client name) gets its own key, derived from the member key, and a **delegation
  certificate** signed by the member. Every change set is an **envelope** `{workspace, author, seq, cert?,
  loro update, signature}` signed by its author. The Loro peer id of a commit is derived from the author key,
  and a receiver checks with `decode_import_blob_meta` that a blob only carries that peer's changes, so a
  member cannot sign changes under someone else's name.
- Envelopes are stored and forwarded **as signed**, so a peer that was offline gets the original author's
  signature from whoever has it. Anti-entropy on connect compares per-author sequence numbers.
- The **team file** is a grow-only set of member entries, each signed by an existing member (the founder's
  entry by the founder). It is the allowlist: Iroh connections from keys outside it are closed before any
  sync, and envelopes whose author does not chain to it are dropped and counted.
- **Invites:** a link `paprika://join/<team>?…` (also shown as a QR) carries the inviter's address, a random
  single-use secret and the expiry chosen by the inviter. The joiner dials the inviter on a separate ALPN;
  the inviter checks the secret, the expiry and that it was not used, then signs the joiner's member entry.
  Revoking an invite deletes the secret.

### 5. Discovery and relays

The default endpoint uses Iroh's public relays and DNS address lookup, which only help peers find each other
and carry end-to-end encrypted QUIC when hole punching fails: they never see document contents and have no
authority. A team can point to its own relay. Tests run with relays and lookup disabled, over loopback.

## Consequences

- **Material trade-off:** two binaries. Building the team feature needs the Rust toolchain; the Docker image
  and releases ship `paprika-sync` next to `paprika`. An instance without it keeps working alone.
- The document now exists twice on a team instance: SQLite (what Go serves) and the Loro state with its
  envelope log (what peers converge on). The sidecar's state can always be rebuilt from SQLite plus the log.
- Undo semantics change only in a team: it reverts local transactions, and a revert may partly fail if a
  peer deleted the nodes it touched (reported, not silent).
- Removing a member and rotating keys came later (2026-11-22) as signed `removals`/`rotations` in the team file
  with a per-author cut (`upto`), see docs/en-US/team-sync.md. Approval roles are not covered yet.
- Presence (agents' cursors, people online) travels as ephemeral messages on the same connections and is
  never stored.
