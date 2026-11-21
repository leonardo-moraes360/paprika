# AGENTS

## Toolbelt

This repository may use [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as a harness for agents.

### Detected toolchain

- tests (`verify.test_cmd`): `pnpm test`
- build (`verify.build_cmd`): `pnpm run build`

### Using tb

- `tb verify` — runs the test/build/lint configured in `.toolbelt/config.yaml`
- `tb guard check` — anti-cheat checks on the diff
- `tb mem` — invariants kept outside context compaction

Adjust `verify.test_cmd` (and `build_cmd`/`lint_cmd`, if any) if detection is incorrect.
