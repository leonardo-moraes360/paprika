## Summary

## Verification

- [ ] `pnpm check` (or the affected suites) and `tb guard check --base origin/main`

## Performance

- [ ] Touches `apps/web`, `web-legacy`, `packages/core`, `server` or `crates/render`: profiling before/after on the worst case is below, and `pnpm test:perf` stays within budget ([performance](../docs/en-US/performance.md))

## Design (UI changes)

- [ ] Screenshots of the frames drawn first (design-first, AGENTS rule 6) are attached
