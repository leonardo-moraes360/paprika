# Design boards

Every change that touches an interface is drawn before it is coded (rule 6 of `AGENTS.md`): the agent opens a
frame per state in a Paprika document over MCP, checks it with `lint_design`, and attaches the
`render_screenshot` PNGs to the PR. Two artifacts come out of that, and they serve different purposes:

- **The PNGs** under `docs/assets/boards/<TICKET>/` are the review artifact: what the reviewer and the
  maintainer read in the PR. They are committed with the change.
- **The document** is the editable source: frames, tokens, mode overrides. It lives in the Paprika server,
  which is a database — and databases move.

## Keep the document in the repository

The board document is exported to `docs/design/boards.paprika.json` the same way the landing page keeps
`apps/site/design/landing.paprika.json`:

```bash
# after drawing the sheets (the server holds them in <db>)
server-go/bin/paprika export --db <db> -o docs/design/boards.paprika.json

# after a reset: bring them back into a fresh server, then screenshot again from it
server-go/bin/paprika import docs/design/boards.paprika.json --db <db> --replace
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
