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
| WS bytes per one-prop write | 2 KB | 7.23 MB | PAP-A-057 |
| Doc snapshots on open | 1 | 2 | PAP-A-057 |
| Server time per one-prop write | 50 ms | 1.08 s | PAP-A-060 |
| Longest task in the tab on one incoming write | 50 ms | 0.7–1.4 s | PAP-A-061 |
| p95 frame on scroll, zoom and pan | 20 ms | 33–67 ms | PAP-A-062 |
| Panel resize step | 20 ms | 750 ms | PAP-A-063 |
| Time until an agent-created node is visible | 1 s | up to 28.6 s | PAP-A-064 |
| Slow tab ends on the latest version | always | no (481 of 485) | PAP-A-058 |

Count budgets (bytes, messages, snapshots, versions) are exact. Time budgets are relative: the suite measures the same action on a small document in the same run and the budget applies to the difference, so a slow or busy machine does not fail it. The agent-build time is the exception: it is a product limit, measured as is.

Each budget starts report-only (`enforce: false`): when exceeded it prints `known-failing` with its ticket and the run still passes. The PR that meets a budget sets `enforce: true`; from then on an excess fails the suite. A feature that adds a hot path adds its scenario and its budget in the same PR.

## Running the suite

```sh
pnpm build
pnpm test:perf
```

It needs the web build (`apps/web/dist`) and Playwright Chromium for the browser scenarios (see [development](development.md); `PAPRIKA_CHROMIUM` points at another Chrome). Without the web build only the server scenarios run. It prints a `scenario | budget | measured | limit | status` table and writes the same data as JSON to `$PAPRIKA_PERF_REPORT` (default `paprika-perf-report.json` in the OS temp directory). It is not part of `pnpm check`.

## How to profile

- Server: a Go test or benchmark with `go test -cpuprofile cpu.out`, then `go tool pprof -top cpu.out`; or time the MCP call against the worst case. Report the top functions before and after.
- Canvas: drive the page with Playwright and read `Performance.getMetrics` over CDP (`ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`) before and after the gesture, collect `longtask` entries with a `PerformanceObserver`, and record frame times with `requestAnimationFrame` deltas during wheel pan, zoom, panel drag or an incoming write. `packages/e2e/test/perf/helpers.ts` has these helpers.
- Put the numbers (before and after, worst case) in the PR description.
