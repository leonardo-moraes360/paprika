# Performance

> Português: [docs/pt-BR/desempenho.md](../pt-BR/desempenho.md)

Paprika must stay fast on a real workspace, not only on the demo. This page defines the worst case, the budgets the `perf` suite checks, and how to profile. The rules are in [AGENTS.md](../../AGENTS.md) rule 7; the work that brings each number inside its budget is section W of the [backlog](backlog.md).

## Worst case

Measured on the maintainer's real workspace (14,752 nodes, 7.2 MB, main `17c9fac`). The suite never uses that export (it is private): it builds a synthetic document with the same shape, in code (`packages/e2e/test/perf/synthetic.ts`, deterministic):

- about 15,000 nodes over 7 pages;
- one page with about 3,500 nodes (the heavy page, opened first), made of nested auto-layout frames with strokes, text, paths and ellipses;
- 1,000 component instances;
- several agents writing at the same time;
- one slow tab (a WebSocket consumer that stops reading).

## Budgets

The numbers live in one file, `packages/e2e/test/perf/budgets.ts`.

| Budget | Limit | Today | Ticket |
|---|---|---|---|
| WS bytes per one-prop write | 2 KB | 608 B (enforced; was 7.23 MB) | PAP-A-057 |
| Doc snapshots on open | 1 | 1 (enforced; was 2) | PAP-A-057 |
| Wire bytes of the snapshot on open, as % of its JSON | 25% | 9% on the worst case (enforced; was 100%: `/ws` had no permessage-deflate). The maintainer's real workspace (17,139 nodes) goes from 8.4 MB to 1.25 MB | PAP-A-070 |
| Server time per one-prop write | 50 ms | 2 to 7 ms over a small document (enforced; was 1.08 s) on a plain node | PAP-A-060 |
| Server time per one-prop write on a component master with 1,000 instances | 50 ms | 0.4 s (report-only; was 2.2 s). The floor is about 0.35 s: the 1,000 copies are rebuilt and about 4,000 rows are written | PAP-A-060 |
| Server time to create a frame with 200 children | 50 ms | 31 ms over a small document (report-only; was about 450 ms) | PAP-A-060 |
| Server time to delete a frame with 200 children | 50 ms | 14 ms over a small document (enforced; was about 430 ms) | PAP-A-060 |
| Script time in the tab on one incoming write | 50 ms | about 0.1 s over the small document (48–173 ms in 10 runs, median about 100 ms; report-only; was 2.5 s: the inspector linted the whole document on the main thread for every version) | PAP-A-068 |
| p95 frame on scroll, zoom and pan | 20 ms | met (17 ms; was 33–83 ms) | PAP-A-062 |
| Panel resize step | 20 ms | met (17 ms over the small document; was 750 ms) | PAP-A-063 |
| Time until an agent-created 200-node frame is visible, small document | 1 s | 180 ms (enforced; was a 200-step replay) | PAP-A-064 |
| Same, on the heavy page of the worst case | 1 s | 0.7–0.97 s in 10 runs (report-only: too close to the limit to enforce; was 25 s) | PAP-A-068 |
| Slow tab ends on the latest version | always | no (481 of 485) | PAP-A-058 |

Count budgets (bytes, messages, snapshots, versions) are exact. Time budgets are relative: the suite measures the same action on a small document in the same run and the budget applies to the difference, so a slow or busy machine does not fail it. The agent-build times are the exception: they are a product limit, measured as is. Created nodes are never hidden while the agent outline walks them, so what is left on the heavy page is the tab rendering the write, not the walk.

Each budget starts report-only (`enforce: false`): when exceeded it prints `known-failing` with its ticket and the run still passes. The PR that meets a budget sets `enforce: true`; from then on an excess fails the suite. A feature that adds a hot path adds its scenario and its budget in the same PR.

## Running the suite

```sh
pnpm build
pnpm test:perf
```

It needs the web build (`web-legacy/dist`) and Playwright Chromium for the browser scenarios (see [development](development.md); `PAPRIKA_CHROMIUM` points at another Chrome). Without the web build only the server scenarios run. It prints a `scenario | budget | measured | limit | status` table and writes the same data as JSON to `$PAPRIKA_PERF_REPORT` (default `report.json` in a fresh `paprika-perf-report-*` directory under the OS temp directory; the path is printed). It is not part of `pnpm check`.

## How to profile

- Server: a Go test or benchmark with `go test -cpuprofile cpu.out`, then `go tool pprof -top cpu.out`; or time the MCP call against the worst case. Report the top functions before and after.
- Canvas: drive the page with Playwright and read `Performance.getMetrics` over CDP (`ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`) before and after the gesture, collect `longtask` entries with a `PerformanceObserver`, and record frame times with `requestAnimationFrame` deltas during wheel pan, zoom, panel drag or an incoming write. `packages/e2e/test/perf/helpers.ts` has these helpers.
- Put the numbers (before and after, worst case) in the PR description.
