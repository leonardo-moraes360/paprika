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
| 1 | Every one of its 41 MCP tools carries annotations; **20** are `destructiveHint`, others `readOnlyHint`/`consequentialHint` | Clients gate approval on these flags; without them an agent deciding what is safe is guessing | 21 of 63 tools are annotated (16 `readOnlyHint`, 2 `destructiveHint`, 1 `idempotentHint`); **42 carry none**, including `create_nodes`, `update_nodes`, `import_document`, `undo` |
| 2 | The server's `initialize` instructions embed the whole workflow: read the guide, outline the document, ask for the brief, look up fonts, write one visual group per call, screenshot after every section | The guidance travels with the server, so any client behaves the same | `get_design_guide` exists; the loop is written in `AGENTS.md` and human docs, not shipped to the agent as server instructions |
| 3 | Tool descriptions say "write incrementally, the user sees you write in real time" and name the review criteria (spacing, typography, contrast, alignment, artboard fit, repetition) | Turns "review your work" into something a model can act on | `lint_design` and visual verification cover the mechanical half; the six-criterion pass is not written down |
| 4 | Every mutating result returns a per-domain `contentHash` (tokens, nodes, …) so a client can skip resending unchanged blocks | Keeps long sessions inside the context budget | `get_document_outline` returns a version; no per-domain change token |
| 5 | Response payload is split into two content blocks (metadata + payload), and the docs of the product state that | Their clients get this wrong constantly; ours should not have to | Paprika returns one block; worth keeping simple and documenting it |
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

## Backlog-worthy proposals

1. Annotate the remaining 42 tools in `server/contract/mcp.json` (`destructiveHint` for
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

## Limits of this study

It documents a third-party binary at one version, from one authenticated account, and the account's
weekly MCP quota ran out before the last screens were built — so the numbers for those screens are
design budgets, not measurements. Nothing here was re-verified against a later Paper release.
