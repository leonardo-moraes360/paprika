🇺🇸 English | [🇧🇷 Português](CONTRIBUTING.pt-BR.md)

# Contributing to Paprika

Thanks for your interest! Paprika is a small, local design tool for AI agents. Bug reports, ideas, docs fixes and pull requests are all welcome.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through the [security policy](SECURITY.md), never through public issues.

## Before you start

- **Bugs**: open an issue with the steps to reproduce, what you expected, what happened, and your OS, Node/Go versions and how you started the server.
- **Features**: open an issue first so we can agree on the approach before you write code. Check [docs/backlog.md](docs/backlog.md): it lists the planned capabilities and their priority.
- **Small fixes** (typos, docs, obvious bugs): a pull request is enough.

Paprika is an **original** project. Do not submit code, assets, icons, fonts, shortcuts or behavior copied or reverse-engineered from proprietary design tools.

## Development setup

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22+ | everything in TypeScript (`packages/`, `apps/web`) |
| pnpm | 10+ | workspace and scripts |
| Go | 1.25+ | `server-go/` |
| Rust + `wasm32-unknown-unknown` | stable | only `experiments/canvas-wasm` (see its README) |

```bash
pnpm install
pnpm --filter @paprika/server exec playwright install chromium   # for screenshots and E2E
pnpm check        # build + typecheck + unit/integration tests + E2E
```

Day-to-day:

```bash
pnpm dev                              # server with the demo document
pnpm --filter @paprika/web dev        # canvas with hot reload (another terminal)
pnpm check:go                         # Go server: golden fixtures, go test, parity and E2E
```

## Where things go

The map and the hard rules live in [AGENTS.md](AGENTS.md); they apply to humans too. In short:

- `packages/core` has no I/O. Every document mutation goes through `applyOps`.
- New visual styling goes into `nodeStyle`, so the canvas, screenshots and exported code stay identical.
- The TypeScript and Go servers expose the same MCP tools, WebSocket protocol and HTTP API. A change to that surface needs both implementations, regenerated fixtures (`pnpm go:golden`) and passing parity tests.
- A new MCP tool needs a test in `packages/server/test/server.test.ts` and a row in both READMEs.

## Documentation

English is the primary language (`README.md`, `docs/`, root `*.md`). The Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`, `*.pt-BR.md`) is updated **in the same pull request**. If you can't write one of the two languages, say so in the PR and the maintainer will fill it in.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `feat(server-go): …`, `fix(web): …`, `docs: …`. Summaries in English or Portuguese are both fine.
- Keep each pull request focused on one change; don't mix refactors or formatting of unrelated files.
- Before opening it, run the checks for what you touched: `pnpm check` for TypeScript, `pnpm check:go` for anything that affects the Go server or the shared contract.
- In the description, say what changed, why, how you tested it, and link the issue.
- Add or update tests for behavior changes. Don't skip or delete failing tests to get a green run.

### Using an AI agent

Contributions made with AI agents are welcome; you are still responsible for the result. This repository uses [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as its agent harness (`.toolbelt/`); it's optional for human contributors, but `tb mem list` shows the project invariants and `tb stack verify guard` runs the same checks the maintainer uses.

## License

Paprika is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
