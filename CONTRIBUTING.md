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
| Node.js | 22+ | `packages/core`, the canvas (`apps/web`), the E2E suites (`packages/e2e`) |
| pnpm | 10+ | workspace and scripts |
| Go | 1.26+ | the server (`server-go/`) |
| Rust + `wasm32-unknown-unknown` | stable | the WASM canvas renderer (`crates/render`) and the team sync sidecar (`crates/sync`) |

```bash
pnpm install
pnpm --filter @paprika/e2e exec playwright install chromium   # for screenshots and E2E
pnpm check        # build + typecheck + fixtures + unit and Go tests + API and E2E suites
```

Day-to-day:

```bash
pnpm dev                              # Go server with the demo document
pnpm --filter @paprika/web dev        # canvas with hot reload (another terminal)
pnpm go:test && pnpm test:api         # Go tests + black-box API suite against the binary
```

## Where things go

The map and the hard rules live in [AGENTS.md](AGENTS.md); they apply to humans too. In short:

- `packages/core` has no I/O. Every document mutation goes through `applyOps`.
- New visual styling goes into `nodeStyle`, so the canvas, screenshots and exported code stay identical.
- The server is `server-go/`; `server-go/internal/core` ports `packages/core`, which the canvas runs. A change to `packages/core` needs the same change in Go, regenerated fixtures (`pnpm go:golden`) and passing `pnpm go:test`.
- Interface changes (`apps/web`, `apps/site`, new screens, visual tweaks) are designed first in a local Paprika over MCP; the PR carries screenshots of the frames, and MCP friction goes to `docs/agent-feedback.md`.
- A new MCP tool needs its definition in `server-go/contract/mcp.json`, its handler and a Go test, a scenario in `packages/e2e/test/api.test.ts`, and a row in both MCP tool tables (`docs/mcp.md` and `docs/pt-BR/mcp.md`).

## Documentation

English is the primary language (`README.md`, `docs/`, root `*.md`). The Brazilian Portuguese mirror (`README.pt-BR.md`, `docs/pt-BR/`, `*.pt-BR.md`) is updated **in the same pull request**. If you can't write one of the two languages, say so in the PR and the maintainer will fill it in.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `feat(server-go): …`, `fix(web): …`, `docs: …`. Summaries in English or Portuguese are both fine.
- Keep each pull request focused on one change; don't mix refactors or formatting of unrelated files.
- Before opening it, run the checks for what you touched: `pnpm check` runs everything; `pnpm go:test`, `pnpm test:api` and `pnpm test:e2e` are the faster subsets.
- In the description, say what changed, why, how you tested it, and link the issue.
- Add or update tests for behavior changes. Don't skip or delete failing tests to get a green run.

### Using an AI agent

Contributions made with AI agents are welcome; you are still responsible for the result. This repository uses [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) as its agent harness (`.toolbelt/`); it's optional for human contributors, but `tb mem list` shows the project invariants and `tb stack verify guard` runs the same checks the maintainer uses.

## License

Paprika is released under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
