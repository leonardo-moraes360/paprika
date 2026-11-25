// The docs sidebar and the files behind each page. Both languages share the slug, so the
// language switch only swaps the /pt-BR prefix. Paths are relative to the repository root.

export type Lang = "en" | "pt-BR";

export interface DocPage {
  slug: string;
  en: { file: string; label: string };
  "pt-BR": { file: string; label: string };
}

export interface DocGroup {
  en: string;
  "pt-BR": string;
  pages: DocPage[];
}

const page = (slug: string, en: [string, string], pt: [string, string]): DocPage => ({
  slug,
  en: { file: en[0], label: en[1] },
  "pt-BR": { file: pt[0], label: pt[1] },
});

export const NAV: DocGroup[] = [
  {
    en: "Get started",
    "pt-BR": "Primeiros passos",
    pages: [
      page("introduction", ["README.md", "Introduction"], ["docs/pt-BR/README.md", "Introdução"]),
      page("docker", ["docs/en-US/docker.md", "Install with Docker"], ["docs/pt-BR/docker.md", "Instalar com Docker"]),
      page("mcp", ["docs/en-US/mcp.md", "Agents and MCP"], ["docs/pt-BR/mcp.md", "Agentes e MCP"]),
    ],
  },
  {
    en: "Use Paprika",
    "pt-BR": "Usar o Paprika",
    pages: [
      page("canvas", ["docs/en-US/canvas.md", "Using the canvas"], ["docs/pt-BR/canvas.md", "Usando o canvas"]),
      page("team-sync", ["docs/en-US/team-sync.md", "Team sync"], ["docs/pt-BR/sincronizacao-time.md", "Sincronização em time"]),
      page("visual-verification", ["docs/en-US/visual-verification.md", "Visual verification"], ["docs/pt-BR/verificacao-visual.md", "Verificação visual"]),
    ],
  },
  {
    en: "Agents",
    "pt-BR": "Agentes",
    pages: [
      page("agent-sessions", ["docs/en-US/agent-sessions.md", "Agent sessions"], ["docs/pt-BR/sessoes-agentes.md", "Sessões de agentes"]),
      page("agent-bus", ["docs/en-US/agent-bus.md", "Agent bus"], ["docs/pt-BR/barramento-agentes.md", "Barramento de agentes"]),
      page("agent-feedback", ["docs/en-US/agent-feedback.md", "Agent feedback"], ["docs/pt-BR/feedback-agentes.md", "Feedback de agentes"]),
    ],
  },
  {
    en: "Brand",
    "pt-BR": "Marca",
    pages: [page("brand", ["docs/en-US/brand/README.md", "Brand guide"], ["docs/pt-BR/marca.md", "Guia da marca"])],
  },
  {
    en: "Contribute",
    "pt-BR": "Contribuir",
    pages: [
      page("development", ["docs/en-US/development.md", "Development"], ["docs/pt-BR/desenvolvimento.md", "Desenvolvimento"]),
      page("ci", ["docs/en-US/ci.md", "CI"], ["docs/pt-BR/ci.md", "CI"]),
      page("design-boards", ["docs/en-US/design-boards.md", "Design boards"], ["docs/pt-BR/folhas-de-design.md", "Folhas de design"]),
      page("backlog", ["docs/en-US/backlog.md", "Backlog"], ["docs/pt-BR/backlog.md", "Backlog"]),
      page("contributing", ["CONTRIBUTING.md", "Contributing"], ["docs/pt-BR/CONTRIBUTING.md", "Como contribuir"]),
      page("security", ["SECURITY.md", "Security"], ["docs/pt-BR/SECURITY.md", "Segurança"]),
      page("code-of-conduct", ["CODE_OF_CONDUCT.md", "Code of Conduct"], ["docs/pt-BR/CODE_OF_CONDUCT.md", "Código de Conduta"]),
    ],
  },
  {
    en: "Reference",
    "pt-BR": "Referência",
    pages: [
      page("architecture", ["docs/en-US/architecture.md", "Architecture"], ["docs/pt-BR/arquitetura.md", "Arquitetura"]),
      page("go-server", ["server/README.md", "Go server"], ["server/README.pt-BR.md", "Servidor Go"]),
      page("adr/0001-go-server-sqlite", ["docs/en-US/adr/0001-go-server-sqlite.md", "ADR 0001: Go server + SQLite"], ["docs/pt-BR/adr/0001-servidor-go-sqlite.md", "ADR 0001: servidor Go + SQLite"]),
      page("adr/0002-canvas-renderer-rust-wasm", ["docs/en-US/adr/0002-canvas-renderer-rust-wasm.md", "ADR 0002: Rust/WASM renderer"], ["docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md", "ADR 0002: renderizador Rust/WASM"]),
      page("adr/0003-tailwind-css", ["docs/en-US/adr/0003-tailwind-css.md", "ADR 0003: Tailwind CSS"], ["docs/pt-BR/adr/0003-tailwind-css.md", "ADR 0003: Tailwind CSS"]),
      page("adr/0004-p2p-team-sync", ["docs/en-US/adr/0004-p2p-team-sync.md", "ADR 0004: P2P team sync"], ["docs/pt-BR/adr/0004-sincronizacao-p2p-de-time.md", "ADR 0004: sincronização P2P"]),
      page("adr/0005-shadcn-ui", ["docs/en-US/adr/0005-shadcn-ui.md", "ADR 0005: shadcn/ui"], ["docs/pt-BR/adr/0005-shadcn-ui.md", "ADR 0005: shadcn/ui"]),
      page("research/paper-mcp", ["docs/en-US/research/paper-mcp-0.5.19.md", "Research: Paper MCP"], ["docs/pt-BR/research/paper-mcp-0.5.19.md", "Pesquisa: Paper MCP"]),
    ],
  },
];

export const PAGES: DocPage[] = NAV.flatMap((g) => g.pages);

export const LANGS: Lang[] = ["en", "pt-BR"];

export const prefix = (lang: Lang) => (lang === "en" ? "" : "/pt-BR");
export const docsHome = (lang: Lang) => `${prefix(lang)}/docs/`;
export const docHref = (lang: Lang, slug: string) => `${prefix(lang)}/docs/${slug}/`;
export const home = (lang: Lang) => `${prefix(lang)}/`;

export const groupOf = (slug: string) => NAV.find((g) => g.pages.some((p) => p.slug === slug))!;

/** Repository file → [lang, slug], for rewriting links between docs. */
export const FILE_TO_PAGE = new Map<string, [Lang, string]>(
  PAGES.flatMap((p) => LANGS.map((l) => [p[l].file, [l, p.slug]] as [string, [Lang, string]])),
);

export const REPO = "https://github.com/leonardo-moraes360/paprika";
