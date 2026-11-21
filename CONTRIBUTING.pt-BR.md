[🇺🇸 English](CONTRIBUTING.md) | 🇧🇷 Português

# Como contribuir com o Paprika

Obrigado pelo interesse! O Paprika é uma ferramenta de design pequena e local para agentes de IA. Relatos de bug, ideias, correções na documentação e pull requests são bem-vindos.

Ao participar, você concorda em seguir o [Código de Conduta](CODE_OF_CONDUCT.pt-BR.md). Problemas de segurança seguem a [política de segurança](SECURITY.pt-BR.md), nunca issues públicas.

## Antes de começar

- **Bugs**: abra uma issue com os passos para reproduzir, o que você esperava, o que aconteceu, e seu sistema, versões de Node/Go e como iniciou o servidor.
- **Features**: abra uma issue antes, para combinarmos a abordagem antes de você escrever código. Veja o [docs/pt-BR/backlog.md](docs/pt-BR/backlog.md): ele lista as capacidades planejadas e a prioridade de cada uma.
- **Correções pequenas** (typos, docs, bugs óbvios): um pull request basta.

O Paprika é um projeto **original**. Não envie código, assets, ícones, fontes, atalhos ou comportamento copiados ou obtidos por engenharia reversa de ferramentas de design proprietárias.

## Ambiente de desenvolvimento

| Ferramenta | Versão | Para quê |
|---|---|---|
| Node.js | 22+ | tudo em TypeScript (`packages/`, `apps/web`) |
| pnpm | 10+ | workspace e scripts |
| Go | 1.25+ | `server-go/` |
| Rust + `wasm32-unknown-unknown` | stable | só `experiments/canvas-wasm` (veja o README dele) |

```bash
pnpm install
pnpm --filter @paprika/server exec playwright install chromium   # para screenshots e E2E
pnpm check        # build + typecheck + testes unitários/integração + E2E
```

No dia a dia:

```bash
pnpm dev                              # servidor com o documento demo
pnpm --filter @paprika/web dev        # canvas com hot reload (outro terminal)
pnpm check:go                         # servidor Go: fixtures golden, go test, paridade e E2E
```

## Onde fica cada coisa

O mapa e as regras obrigatórias estão no [AGENTS.md](AGENTS.md); valem para humanos também. Em resumo:

- `packages/core` não faz I/O. Toda mutação do documento passa por `applyOps`.
- Estilo visual novo entra no `nodeStyle`, para que canvas, screenshot e código exportado continuem idênticos.
- Os servidores TypeScript e Go expõem as mesmas ferramentas MCP, o mesmo protocolo WebSocket e a mesma API HTTP. Mudar essa superfície exige as duas implementações, fixtures regeneradas (`pnpm go:golden`) e testes de paridade passando.
- Ferramenta MCP nova exige um teste em `packages/server/test/server.test.ts` e uma linha nos dois READMEs.

## Documentação

Inglês é o idioma principal (`README.md`, `docs/`, `*.md` da raiz). O espelho em português (`README.pt-BR.md`, `docs/pt-BR/`, `*.pt-BR.md`) é atualizado **no mesmo pull request**. Se você não consegue escrever em um dos dois idiomas, avise no PR e o mantenedor completa.

## Commits e pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `tipo(escopo): resumo`, por exemplo `feat(server-go): …`, `fix(web): …`, `docs: …`. O resumo pode ser em português ou inglês.
- Mantenha cada pull request focado em uma mudança; não misture refatorações ou formatação de arquivos sem relação.
- Antes de abrir, rode as verificações do que você mexeu: `pnpm check` para TypeScript, `pnpm check:go` para qualquer coisa que afete o servidor Go ou o contrato compartilhado.
- Na descrição, diga o que mudou, por quê, como você testou e linke a issue.
- Adicione ou atualize testes quando o comportamento mudar. Não pule nem apague testes que falham para ficar verde.

### Usando um agente de IA

Contribuições feitas com agentes de IA são bem-vindas; a responsabilidade pelo resultado continua sendo sua. Este repositório usa o [toolbelt](https://github.com/leonardo-moraes360/toolbelt) (`tb`) como harness de agentes (`.toolbelt/`); ele é opcional para quem contribui manualmente, mas `tb mem list` mostra as invariantes do projeto e `tb stack verify guard` roda as mesmas verificações que o mantenedor usa.

## Licença

O Paprika é distribuído sob a [Licença MIT](LICENSE). Ao contribuir, você concorda que suas contribuições são licenciadas nos mesmos termos.
