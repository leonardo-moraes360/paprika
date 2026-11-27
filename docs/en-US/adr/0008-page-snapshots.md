🇺🇸 English | [🇧🇷 Português](../../pt-BR/adr/0008-snapshot-por-pagina.md)

# ADR 0008: Open a workspace one page at a time

> **Note (2026-11):** the app described here, `web-legacy`, was replaced by `apps/web` and removed from the tree; paths to it below are historical and no longer resolve.

- **Status:** Proposed
- **Date:** 2026-11-26
- **Code:** `server/internal/server` (`serveWS`, outbox, delta), `web-legacy/src/useDocument.ts` and the consumers of `doc.nodes`
- **Backlog:** PAP-A-071 (this ADR), PAP-A-070 (compression, done), PAP-A-072 (cold open on the server)

## Context

When a tab opens `/w/<id>`, it sends `{"type":"view"}` and the server answers with one `{"type":"doc"}`
message that holds the whole workspace: every page, node, token and asset. After that, only deltas flow
(PAP-A-057). The first load therefore grows with the whole workspace, not with what the person is looking at.

Measured on 2026-11-26 (main 994e913, headless Chromium, DOM renderer):

| Workspace | Nodes | Snapshot JSON | On the wire with deflate (PAP-A-070) | Time to ready, local |
|---|---|---|---|---|
| Maintainer's real workspace | 17,139 | 8.4 MB | 1.25 MB | 1.1 s |
| 3× copy | 51,417 | 25.3 MB | 3.8 MB | 2.5 s |
| 6× copy | 102,834 | 50.7 MB | 7.6 MB | 5.0 s |

Compression removes most of the bytes but not the growth, and it does nothing for parse and render time in
the tab, which also grow with the whole document. With the CPU slowed 4×, the real workspace takes 3.1 s
until it shows, and only 0.6 s of that is the transfer.

The open page is a small part of the document. Counting its nodes, the component masters its instances
use (`sourceId`, `instanceOf`, recursively) and their ancestors:

| Page of the real workspace | Nodes sent | From other pages | JSON | With deflate |
|---|---|---|---|---|
| 2 · Editor (largest) | 4,532 | 1,025 | 2.72 MB (33%) | 0.51 MB |
| 3 · Overview e estados | 3,616 | 579 | 1.70 MB (20%) | 0.29 MB |
| 6 · Correções do canvas | 2,592 | 405 | 1.19 MB (14%) | 0.18 MB |
| Capa | 91 | 0 | 0.04 MB (0%) | 0.01 MB |

Options that were measured and rejected:

- **Chunks of the same message:** no fewer bytes and no earlier render, because the tab needs the
  whole JSON before it can parse it. It only allows a progress bar.
- **A binary format (MessagePack, CBOR):** about 20% smaller raw and close to nothing after deflate. Parsing
  it in JS is slower than the native `JSON.parse`, and it touches every consumer.
- **Leaving default values out on the wire:** 16% smaller raw, 10% after deflate.

## Decision

### 1. The snapshot on open carries the open page and what it depends on

The tab declares the capability in `hello` (`"pages": true`) and names the page in `view`
(`{"type":"view","workspaceId":…,"pageId":…}`; with no `pageId`, the server picks the first page). The server
answers with the same `doc` message plus a `partial` field:

```json
{"type":"doc","doc":{…},"version":812,"partial":{"loaded":["<pageId>"]}, …}
```

`doc` keeps its shape (`format`, `id`, `name`, `tokens`, `modes`, `tokenMeta`, `rootIds`, `nodes`), but `nodes`
holds only:

1. every page node, as a stub with its `children` list, so the page list and its order are complete;
2. the subtree of each loaded page;
3. the closure of what that subtree references: the master of each instance (`sourceId`, `instanceOf`),
   recursively, plus the master's subtree and its ancestors up to its page.

Tokens, modes and token metadata are always sent whole: they are small and every page reads them.
Assets (inline images) follow the nodes that reference them.

### 2. Other pages load on demand

When the person opens another page, the tab sends `{"type":"page","pageId":…,"reqId":…}`. The server answers
`{"type":"nodes","id":<workspaceId>,"version":<head>,"pageId":…,"nodes":{…}}` with that page's subtree and
closure, and adds the page to the connection's loaded set. If the tab is behind `version`, it first applies the
deltas it already has queued; if it is ahead or missed a delta, it asks for a resync, as it does today.

The page list shows the page as loading until the answer arrives. Optionally, after the open page has rendered
and the tab is idle, it can prefetch the remaining pages one at a time.

### 3. The server filters deltas per connection

Each connection keeps the set of loaded pages. A delta sent to a partial connection carries only the nodes of
loaded pages, plus any node that a change pulls into the closure (for example, an instance created on a loaded
page whose master lives on a page that is not loaded). Removals are always sent: deleting an id the tab does not
hold is a no-op. Doing this on the server keeps the closure rule in one place, next to the core that already
knows `sourceId` and `instanceOf`.

### 4. Full snapshots stay the default

A client that does not announce `"pages": true` gets the whole document, exactly as today. That covers older
tabs, the e2e harness, scripts and any other `/ws` consumer. MCP (`/mcp`), `/api/document`, `/api/export`
and team sync (server ↔ `paprika-sync`) keep working on the whole document on the server. Agents are
unaffected.

### 5. Tab features that read the whole document

These read `doc.nodes` whole today and must decide per feature:

| Feature | Where | Proposal |
|---|---|---|
| Render index, layers, selection | `renderIndex.ts`, `Layers.tsx`, `Canvas.tsx` | Already page-scoped; works on the loaded nodes |
| Lint | `lintRunner.ts`, `docLint.ts` | Lints the loaded pages; full lint stays in the MCP (`lint_design`) |
| Default names ("Rectangle 12") | `Canvas.tsx` | Numbered within the loaded nodes, or moved to the server on create |
| Fonts in use | `FontPicker.tsx` | Loaded pages, plus a list the server sends with the snapshot |
| Jump to a node on another page (pins, agent activity, history) | `App.tsx` `pageOfNodes` | The server sends a `pageOf` for ids it mentions; the tab loads that page, then jumps |
| Component library (insert an instance) | inspector and components panel | Master stubs (id, name, page, size) for every master, sent with the snapshot |
| Search across pages | not built yet | Done by the server when it exists |

## Consequences

- The first load stops growing with the number of pages: it costs the open page plus what it uses. On the
  real workspace that is 0–33% of the document today.
- `doc` stops meaning "the whole document" for partial clients. Any new feature in the tab that reads
  `doc.nodes` must say whether it needs one page or all of them.
- The server keeps per-connection state (loaded pages) and computes a closure on every delta it fans out. That
  cost must stay inside the existing write budgets (`serverWriteMs`, `wsBytesPerWrite`).
- New perf budgets: wire bytes and time to ready for the first load of the worst case scale with the open page,
  not with the document; switching to a page not loaded yet shows its content in under 1 s locally.
- New interface states: a page that is loading, in the page list and on the canvas. They are drawn first in a
  local Paprika over MCP (AGENTS rule 6) before any code.
- Rollout: server and contract first behind the `hello` capability, then the tab, feature by feature, then the
  tab announces `"pages": true` by default.
