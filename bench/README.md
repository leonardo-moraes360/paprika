# Benchmarks: how well an agent designs through Paprika

> Português: [README.pt-BR.md](README.pt-BR.md)

Three tasks measure what an agent does with Paprika's MCP tools: build a login card from an existing
token set, build a three-column pricing section with auto-layout, and repair a shipped document that
fails the linter. Each one is scored by a deterministic checker over the resulting
`.paprika.json` — no model judging a model.

`.toolbelt/config.yaml` already points toolbelt at these directories (`bench.tasks_dir`,
`bench.fixtures_dir`, `bench.output_dir`), so `tb bench` reads this folder.

## Layout

```
bench/
  tasks/<id>/task.yaml      the task: prompt, fixture, verification command, timeout
  tasks/<id>/check.mjs      the checker for that task (plain Node, no dependencies)
  tasks/lib.mjs             shared rules: tokens, WCAG AA contrast, bounds, reporting
  fixtures/<id>/            the starting document the task copies into a temp work dir
  fixtures/<id>-reference/  a hand-made solution used to prove the checker passes when the work is right
  results/                  JSONL scores and reports (git-ignored)
```

`tb bench` copies `fixtures/<id>` into a temporary directory, runs the agent there with the prompt,
then runs `verification.command` in that same directory.

## Running a task by hand

`tb bench` runs the verification command from the temporary work directory, so the checker is
referenced through `$PAPRIKA_BENCH`, which must point at this repository:

```bash
cd ~/paprika
export PAPRIKA_BENCH="$PWD"

tb bench list                                  # the three tasks
tb bench run --task login-card                 # against bench.default_agent
tb bench run --agent 'my-agent {prompt} {workdir}' --repetitions 5
tb bench report bench/results/<run>.jsonl
```

Without `PAPRIKA_BENCH` the verification fails with a message naming it — a score of 0 with that
line in the output means the run never really happened.

To check a single document, skip the harness and run the checker directly:

```bash
node bench/tasks/login-card/check.mjs bench/fixtures/login-card-reference/document.paprika.json      # exit 0
node bench/tasks/login-card/check.mjs bench/fixtures/login-card/document.paprika.json               # exit 1
```

Every check prints one `PASS`/`FAIL` line and the last line is the score (`N/M checks passed`),
which is what lands in the `tb bench` report.

## Running an agent against a task

The fixture is a normal Paprika file, so the agent works on it with the documented tools:

```bash
P="$PAPRIKA_BENCH/server-go/bin/paprika"
"$P" import "$PWD/document.paprika.json" --db "$PWD/paprika.db" --replace   # load the fixture
"$P" mcp --db "$PWD/paprika.db" --no-ui                                     # MCP over stdio
"$P" serve --db "$PWD/paprika.db"                                           # or canvas + MCP/HTTP
"$P" export --db "$PWD/paprika.db" -o "$PWD/document.paprika.json"          # write back what is scored
```

`pnpm go:build` creates the binary. The server stores every mutation in SQLite; the final `export`
writes the document the checker reads. The prompts in `task.yaml` state the
scored rules verbatim, which is what makes a failure explainable: the checker's `FAIL` line names the
node and the value.

## What the checkers do and do not prove

- They are self-contained: they read the JSON and implement the color and geometry rules in
  `tasks/lib.mjs`, so a score does not depend on a built `@paprika/core` or a running server.
- They cover the same ground as `lint_design` (WCAG AA contrast, minimum text size, overflow, image
  alt text, hardcoded colors that duplicate a token), reimplemented locally on purpose. If the two
  ever disagree, `lint_design` is the authority on the live document and the checker is the authority
  on the score.
- The cross-check that keeps a checker honest: every fixture loads through the server's own
  validation (`paprika import`, the same path `paprika serve`/`paprika mcp` use), the three starting fixtures
  produce 8 findings between them under `lint_design` (contrast, small text, missing alt, overflow,
  raw colors), and all three `-reference` fixtures produce **zero** findings and pass their checker.
- The pricing task scores the **layout configuration** (`mode`, `gap`, `padding`, equal column
  widths) rather than the resulting `x`/`y`, because auto-layout positions children at render time.
- `render_screenshot` and `export_code` are not scored: pixel comparison would make the score
  depend on fonts and the browser, and the task is about the document the agent produced.
- A passing score is not a good design, it is a document that meets the listed rules. The reference
  fixtures are the floor: if a checker passes one of those and fails the starting fixture, the
  checker works; whether the rules are the *right* rules is a judgement call worth arguing about.

## Adding a task

Copy an existing directory: write the prompt so that every scored rule appears in it, add the
starting fixture and a `-reference` fixture that must pass, and make `check.mjs` exit 0 only when
every rule holds. Then prove both halves:

```bash
node bench/tasks/<id>/check.mjs bench/fixtures/<id>-reference/document.paprika.json   # must be 0
node bench/tasks/<id>/check.mjs bench/fixtures/<id>/document.paprika.json             # must be non-zero
```
