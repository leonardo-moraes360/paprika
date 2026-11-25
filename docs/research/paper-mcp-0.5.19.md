# Agent MCP study: Paper Desktop 0.5.19

Notes from studying a closed design tool's agent surface, kept as input for Paprika's own MCP and for
the drawing loop in [design boards](../design-boards.md). Prose in English here; the Brazilian Portuguese
mirror is [here](../pt-BR/research/paper-mcp-0.5.19.md). The maintainer keeps a 61 KB operator runbook
for that product (`paper-mcp-runbook-guia.md`, Brazilian Portuguese) with the full call-by-call detail.

**What was studied.** `paper-desktop-0.5.19x86_64.AppImage` (sha256 `60a65462…`, Electron 44.9.3,
`app.asar` sha256 `ceadcb0d…`), unsigned. Method: static unpacking of the bundle, then running it with a
logged-in account and driving its local MCP (`http://127.0.0.1:29979/mcp`) to build real screens — a
design-system sheet, a landing page and a login screen (604 nodes, 27 tokens). All numbers below are
measured or quoted from that session (2026-11-24), not inferred.

## What they do well, and Paprika should copy

| # | Observation in Paper | Why it matters | Paprika today |
|---|----------------------|----------------|----------------|
| 1 | Every one of its 41 MCP tools carries annotations: **21** `readOnlyHint`, **19** `destructiveHint`, and `delete_nodes` with both `destructiveHint` and `consequentialHint` | Clients gate approval on these flags; without them an agent deciding what is safe is guessing | 21 of 63 tools are annotated (16 `readOnlyHint`, 2 `destructiveHint`, 1 `idempotentHint`); **42 carry none**, including `create_nodes`, `update_nodes`, `import_document`, `undo` |
| 2 | The server's `initialize` instructions embed the whole workflow: read the guide, outline the document, ask for the brief, look up fonts, write one visual group per call, screenshot after every section | The guidance travels with the server, so any client behaves the same | `get_design_guide` exists; the loop is written in `AGENTS.md` and human docs, not shipped to the agent as server instructions |
| 3 | Tool descriptions say "write incrementally, the user sees you write in real time" and name the review criteria (spacing, typography, contrast, alignment, artboard fit, repetition) | Turns "review your work" into something a model can act on | `lint_design` and visual verification cover the mechanical half; the six-criterion pass is not written down |
| 4 | Every mutating result returns a per-domain `contentHash` (tokens, nodes, …) so a client can skip resending unchanged blocks | Keeps long sessions inside the context budget | `get_document_outline` returns a version; no per-domain change token |
| 5 | Every result is two content blocks (state metadata, then the payload), and some payloads are raw text (CSS, JSX), not JSON | A client that reads only the first block, or parses every payload as JSON, silently loses the result | Paprika returns one block; worth keeping simple and documenting it |
| 6 | A quota is surfaced as an in-band error: `Weekly MCP limit reached. It resets in 3 days.` — and it covers screenshots, export and code read, not just writes | An agent that does not budget calls loses mid-screen | Paprika has no quota today; if one is added, say which tools count |
| 7 | Async node state (`imageGeneration.status`: `processing` → `ready`/`error`) plus the explicit warning that screenshot and export do not wait for it | Prevents "the render is blank" bug reports | `import_image`, `place_reference` are synchronous today; keep that, but say it |
| 8 | Token creation has ordering rules (semantic tokens first, then palettes; smaller values first in numeric types) | Produces consistent systems instead of one-off colours | `set_tokens` accepts anything; the guide could carry the same ordering advice |

## Where Paprika is already ahead

The same session ran into limits Paper has and Paprika does not:

- **No component or instance concept in Paper's MCP** (41 tools, none of them a symbol, variant or
  library tool): reuse is token plus clone (`duplicate_nodes`, `<x-paper-clone>`), and states such as
  hover are separate frames. Paprika has `create_component`, `create_instance`, `detach_instance` and
  `detach_tokens` with per-instance overrides, held to by `docs/mcp.md`.
- **No undo/redo surface in Paper's MCP.** Paprika exposes `undo`, `redo`, `get_history`, and every
  mutating tool is one undo step.
- **No document import in Paper's MCP** (HTML is the only inbound dialect). Paprika has
  `import_html`, `import_document` (`.paprika.json`), `import_svg`, `import_image`.
- **Vector and layout control**: `path_info`, `edit_path`, `combine_paths`, `convert_to_path`,
  `round_path_corners`, `create_shape_path`, `align_nodes`, `distribute_nodes`, `wrap_nodes`,
  `layout.wrap` are Paprika-only in this comparison.
- **Human/agent handoff on the canvas**: pins with `claim_pin`, `reply_pin`, `resolve_pin`,
  `wait_for_pins` have no counterpart in Paper.
- **No usage quota** on a self-hosted server, and screenshots/export are free.

## Patterns the reports surface that the table above leaves out

| # | Observation in Paper | Paprika today | Where it lands |
|---|----------------------|---------------|----------------|
| 9 | Write tools mark the touched frames as "being edited" and a dedicated call releases them, with the advice to pass explicit ids so several agents can share a file | Presence (`internal/server/presence.go`) shows the last tool and nodes of each agent, and expires after a TTL; there is no explicit release | New proposal 5 below; it extends the live-presence work, not section T |
| 10 | Mutations answer with what changed, so the agent never re-reads: duplicating returns a source → copy id map for every descendant, moving returns the new child order of every affected parent | `duplicate_nodes` returns `copies` and `map`; every write returns `version`; `move_nodes` does not return the parents' new order | New proposal 6 below |
| 11 | Style that has no effect is not dropped silently: the write result lists it as ignored | Unknown arguments are ignored without a word | Already in section T as PAP-A-007 (strict inputs); no new item |
| 12 | Errors carry a recovery step ("try once more, then ask the user to restart the MCP connection"), and a wrong route answers with the right endpoint | Errors are plain messages | Fold into PAP-A-007: each error names the valid shape and the next step |
| 13 | The local MCP checks `Host` against DNS rebinding but has no per-client credential, so any local process can call destructive tools | Same class: `AllowedRequest` (`internal/server/http.go`) checks `Host` and `Origin`, and there is no token | New proposal 7 below (opt-in, so the zero-setup local flow keeps working) |
| 14 | The guide tells the agent never to show raw node ids to the user, and to read values from code export rather than from screenshots | Not written in the guide | Fold into PAP-A-013 (guide points agents at the tools they missed) |

## Backlog-worthy proposals

1. Annotate the remaining 42 tools in `server-go/contract/mcp.json` (`destructiveHint` for
   `delete_*`, `archive_workspace`, `move_workspace`, `import_document`; `readOnlyHint` is already
   correct on the getters; `idempotentHint` for `show_all`, `unlock_all`, `open_workspace`), and add the
   annotation column to both MCP tool tables.
2. Ship the drawing loop in the server instructions returned by `initialize` (or in
   `get_design_guide`) instead of only in `AGENTS.md`: one visual group per `create_nodes`, screenshot
   after each screen, six named review criteria, narrowest read first.
3. Return a per-domain change token (`tokens`, `nodes`, `pages`) next to the document version so an
   agent can tell what actually moved since its last call.
4. Add the "narrow read first" ladder to `docs/mcp.md` (`get_document_outline` → `find_nodes` →
   `get_nodes` of the ids you need → `get_bounds`), which is what kept Paper sessions inside context.

5. Let an agent release what it is working on: an optional `release_nodes` call (or a `done: true` flag on the last write) that clears its presence on those ids at once instead of waiting for the TTL.
6. Return the new child order of every affected parent from `move_nodes`, `group_nodes` and `ungroup_nodes`, as `duplicate_nodes` already returns its id map.
7. Offer an opt-in bearer token for `/mcp` (`paprika serve --mcp-token`, or a file under the data directory), off by default on loopback and recommended with `--host` or `--team`.

None of these duplicates section T of the [backlog](../backlog.md) (PAP-A-005…020): proposals 1–4 and 5–7 are new, and items 11, 12 and 14 above are notes for PAP-A-007 and PAP-A-013. Tool counts above are from `main` at the time of writing; the open PRs that add tools (`analyze_image`, `trace_image`, `compare_reference`, `outline_stroke`, `repeat_nodes`) ship without annotations too, so proposal 1 should land after them or annotate them in the same change.

## Limits of this study

It documents a third-party binary at one version, from one authenticated account, and the account's
weekly MCP quota ran out before the last screens were built — so the numbers for those screens are
design budgets, not measurements. Nothing here was re-verified against a later Paper release.
