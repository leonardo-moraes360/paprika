# Design boards

Every change that touches an interface is drawn before it is coded (rule 6 of `AGENTS.md`): the agent opens a
frame per state in a Paprika document over MCP, checks it with `lint_design`, and attaches the
`render_screenshot` PNGs to the PR. Two artifacts come out of that, and they serve different purposes:

- **The PNGs** under `docs/en-US/assets/boards/<TICKET>/` are the review artifact: what the reviewer and the
  maintainer read in the PR. They are committed with the change.
- **The document** is the editable source: frames, tokens, mode overrides. It lives in the Paprika server,
  which is a database — and databases move.

## The drawing loop

The session that draws a board follows the same shape every time, and it is what keeps the board
reviewable while it is being built:

1. Read the state first: `get_document_outline`, then `find_nodes` for what exists, then the ids you
   need with `get_nodes`. Never dump the tree.
2. Fix the system before drawing: theme tokens, spacing scale and the type ramp (`set_tokens`).
3. Write one visual group per `create_nodes` call — a header, one row, one card — so the human sees the
   screen arrive and a mistake costs one group, not the board.
4. After every group: `render_screenshot`, then `lint_design`, and one line of verdict against spacing,
   typography, contrast, alignment, frame fit and repetition. Fix before moving on.
5. Reuse rather than remake: `duplicate_nodes` for repeats, components and instances for states,
   `align_nodes`/`distribute_nodes` instead of hand-placed coordinates.
6. Close the work: name the frames, export the document (below) and, when a change touches an interface
   the user will judge, leave the PNGs under `docs/en-US/assets/boards/<TICKET>/`.

Those steps come from operating a competing agent MCP end to end; the comparison and what Paprika should
adopt are in [the agent MCP study](research/paper-mcp-0.5.19.md).

## Keep the document in the repository

The board document is exported to `docs/en-US/design/boards.paprika.json` the same way the site keeps
`apps/site/design/site.paprika.json`:

```bash
# after drawing the sheets (the server holds them in <db>)
server/bin/paprika export --db <db> -o docs/en-US/design/boards.paprika.json

# after a reset: bring them back into a fresh server, then screenshot again from it
server/bin/paprika import docs/en-US/design/boards.paprika.json --db <db> --replace
```

Commit the export in the change that drew the sheets, or as a follow-up `chore:` commit — either way, one
commit per refresh, so `git log` shows how a screen evolved the way the undo stack does.

## Why this exists

On 2026-11-22 the server at `127.0.0.1:4777` moved from a host-run `paprika serve` to the compose stack with
a fresh volume. The document holding the `Interfaces` page — the PAP-B-030 component sheet and the PAP-B-034
team-panel sheet, plus a PAP-B-026 sheet drawn minutes earlier — was simply gone from `list_workspaces`, and
the sheets had to be redrawn from the drawing scripts. The PNGs survived; the editable source did not.

The committed copy is a **recovery copy**, not the working document: agents keep drawing in whatever Paprika
the ticket points at, and the export is what makes losing that server cost a reload instead of a redraw. The
copy in the repository right now holds the PAP-B-026 destructive-actions sheet, the only one still available;
the sheets that were lost are recorded as PNGs and in the ADRs that came out of them.
