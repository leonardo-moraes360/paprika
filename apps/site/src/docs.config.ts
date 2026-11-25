export type Lang = "en" | "pt-BR";

export interface DocEntry {
  slug: string;
  title: Record<Lang, string>;
  src: Record<Lang, string>;
  out: Record<Lang, string>;
}

export interface DocGroup {
  title: Record<Lang, string>;
  items: DocEntry[];
}

const page = (title: [string, string], src: [string, string], out: [string, string]): DocEntry => ({
  slug: out[0],
  title: { en: title[0], "pt-BR": title[1] },
  src: { en: src[0], "pt-BR": src[1] },
  out: { en: `docs/${out[0]}`, "pt-BR": `docs/pt-BR/${out[1]}` },
});

export const HOME: DocEntry = {
  slug: "index",
  title: { en: "Introduction", "pt-BR": "Introdução" },
  src: { en: "", "pt-BR": "" },
  out: { en: "docs/index.html", "pt-BR": "docs/pt-BR/index.html" },
};

export const GROUPS: DocGroup[] = [
  {
    title: { en: "Get started", "pt-BR": "Comece aqui" },
    items: [
      HOME,
      page(["Install with Docker", "Instalar com Docker"], ["docs/en-US/install.md", "docs/pt-BR/instalar.md"], ["install.html", "instalar.html"]),
      page(["Connect your agent", "Conectar o seu agente"], ["docs/en-US/connect-agent.md", "docs/pt-BR/conectar-agente.md"], ["connect-agent.html", "conectar-agente.html"]),
    ],
  },
  {
    title: { en: "Use Paprika", "pt-BR": "Usar o Paprika" },
    items: [
      page(["Using the canvas", "Usando o canvas"], ["docs/en-US/canvas.md", "docs/pt-BR/canvas.md"], ["canvas.html", "canvas.html"]),
      page(["Docker", "Docker"], ["docs/en-US/docker.md", "docs/pt-BR/docker.md"], ["docker.html", "docker.html"]),
      page(["Team sync", "Sincronização do time"], ["docs/en-US/team-sync.md", "docs/pt-BR/sincronizacao-time.md"], ["team-sync.html", "sincronizacao-time.html"]),
      page(["Visual verification", "Verificação visual"], ["docs/en-US/visual-verification.md", "docs/pt-BR/verificacao-visual.md"], ["visual-verification.html", "verificacao-visual.html"]),
    ],
  },
  {
    title: { en: "Agents and MCP", "pt-BR": "Agentes e MCP" },
    items: [
      page(["MCP tools and file format", "Ferramentas MCP e formato"], ["docs/en-US/mcp.md", "docs/pt-BR/mcp.md"], ["mcp.html", "mcp.html"]),
      page(["Agent sessions", "Sessões de agentes"], ["docs/en-US/agent-sessions.md", "docs/pt-BR/sessoes-agentes.md"], ["agent-sessions.html", "sessoes-agentes.html"]),
      page(["Agent feedback", "Feedback de agentes"], ["docs/en-US/agent-feedback.md", "docs/pt-BR/feedback-agentes.md"], ["agent-feedback.html", "feedback-agentes.html"]),
    ],
  },
  {
    title: { en: "Brand", "pt-BR": "Marca" },
    items: [page(["Brand guide", "Guia da marca"], ["docs/en-US/brand/README.md", "docs/pt-BR/marca.md"], ["brand.html", "marca.html"])],
  },
  {
    title: { en: "Contribute", "pt-BR": "Contribuir" },
    items: [
      page(["Development", "Desenvolvimento"], ["docs/en-US/development.md", "docs/pt-BR/desenvolvimento.md"], ["development.html", "desenvolvimento.html"]),
      page(["CI", "CI"], ["docs/en-US/ci.md", "docs/pt-BR/ci.md"], ["ci.html", "ci.html"]),
      page(["Design boards", "Folhas de design"], ["docs/en-US/design-boards.md", "docs/pt-BR/folhas-de-design.md"], ["design-boards.html", "folhas-de-design.html"]),
      page(["Agent bus", "Barramento de agentes"], ["docs/en-US/agent-bus.md", "docs/pt-BR/barramento-agentes.md"], ["agent-bus.html", "barramento-agentes.html"]),
      page(["Backlog", "Backlog"], ["docs/en-US/backlog.md", "docs/pt-BR/backlog.md"], ["backlog.html", "backlog.html"]),
      page(["Contributing", "Como contribuir"], ["CONTRIBUTING.md", "docs/pt-BR/CONTRIBUTING.md"], ["contributing.html", "contribuindo.html"]),
      page(["Security", "Segurança"], ["SECURITY.md", "docs/pt-BR/SECURITY.md"], ["security.html", "seguranca.html"]),
      page(["Code of Conduct", "Código de Conduta"], ["CODE_OF_CONDUCT.md", "docs/pt-BR/CODE_OF_CONDUCT.md"], ["code-of-conduct.html", "codigo-de-conduta.html"]),
    ],
  },
  {
    title: { en: "Reference", "pt-BR": "Referência" },
    items: [
      page(["Architecture", "Arquitetura"], ["docs/en-US/architecture.md", "docs/pt-BR/arquitetura.md"], ["architecture.html", "arquitetura.html"]),
      page(["Go server", "Servidor Go"], ["server/README.md", "server/README.pt-BR.md"], ["go-server.html", "servidor-go.html"]),
      page(["ADR 0001: Go server + SQLite", "ADR 0001: servidor Go + SQLite"], ["docs/en-US/adr/0001-go-server-sqlite.md", "docs/pt-BR/adr/0001-servidor-go-sqlite.md"], ["adr/0001-go-server-sqlite.html", "adr/0001-servidor-go-sqlite.html"]),
      page(["ADR 0002: Rust/WASM renderer", "ADR 0002: renderizador Rust/WASM"], ["docs/en-US/adr/0002-canvas-renderer-rust-wasm.md", "docs/pt-BR/adr/0002-renderizador-canvas-rust-wasm.md"], ["adr/0002-canvas-renderer-rust-wasm.html", "adr/0002-renderizador-canvas-rust-wasm.html"]),
      page(["ADR 0003: Tailwind CSS", "ADR 0003: Tailwind CSS"], ["docs/en-US/adr/0003-tailwind-css.md", "docs/pt-BR/adr/0003-tailwind-css.md"], ["adr/0003-tailwind-css.html", "adr/0003-tailwind-css.html"]),
      page(["ADR 0004: P2P team sync", "ADR 0004: sincronização P2P"], ["docs/en-US/adr/0004-p2p-team-sync.md", "docs/pt-BR/adr/0004-sincronizacao-p2p-de-time.md"], ["adr/0004-p2p-team-sync.html", "adr/0004-sincronizacao-p2p-de-time.html"]),
      page(["ADR 0005: shadcn/ui", "ADR 0005: shadcn/ui"], ["docs/en-US/adr/0005-shadcn-ui.md", "docs/pt-BR/adr/0005-shadcn-ui.md"], ["adr/0005-shadcn-ui.html", "adr/0005-shadcn-ui.html"]),
      page(["ADR 0006: Astro site", "ADR 0006: site em Astro"], ["docs/en-US/adr/0006-astro-site.md", "docs/pt-BR/adr/0006-site-astro.md"], ["adr/0006-astro-site.html", "adr/0006-site-astro.html"]),
      page(["Research: Paper MCP 0.5.19", "Pesquisa: MCP do Paper 0.5.19"], ["docs/en-US/research/paper-mcp-0.5.19.md", "docs/pt-BR/research/paper-mcp-0.5.19.md"], ["research/paper-mcp-0.5.19.html", "research/paper-mcp-0.5.19.html"]),
    ],
  },
];

export const ENTRIES: DocEntry[] = GROUPS.flatMap((g) => g.items);
