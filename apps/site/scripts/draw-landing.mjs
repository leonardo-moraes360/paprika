// Draws the Paprika landing page in Paprika itself, over MCP (JSON-RPC over HTTP).
// Four root frames: desktop and mobile, in English and Brazilian Portuguese.
// The site build (build.mjs) turns these frames into the published HTML.
//
// Usage:
//   pnpm go:build
//   server-go/bin/paprika import apps/site/design/landing.paprika.json --db /tmp/landing.db --replace
//   server-go/bin/paprika serve --db /tmp/landing.db --port 4790
//   PAPRIKA_MCP=http://127.0.0.1:4790/mcp node apps/site/scripts/draw-landing.mjs
//   server-go/bin/paprika export --db /tmp/landing.db -o apps/site/design/landing.paprika.json
//
// Links: a node named `link:<href>` becomes an <a href> in the published page.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4790/mcp";
const REPO = "https://github.com/leonardo-moraes360/paprika";
let rpcId = 0;

async function call(name, args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "landing-agent/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = await res.json();
  const r = json.result;
  if (!r || r.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? r?.content)}`);
  return r.content.map((c) => c.text ?? "").join("\n");
}

const iconPath = fileURLToPath(new URL("../../../docs/brand/icon.svg", import.meta.url));
const ICON = `data:image/svg+xml;base64,${readFileSync(iconPath).toString("base64")}`;

// ---------------------------------------------------------------- copy

const copy = {
  en: {
    lang: "en",
    other: { label: "Português", href: "link:pt-BR/" },
    docs: "link:docs/",
    nav: ["Docs", "GitHub"],
    pill: "Open source · MIT · 100% local",
    title: "The design canvas your AI agent can actually use.",
    lead: "Paprika is a local design tool with a built-in MCP server. You and your agent edit the same document at the same time: the agent through MCP, you on a canvas in the browser.",
    cta: ["Read the docs", "View on GitHub"],
    whyTitle: "Built for agents, not bolted on",
    whyLead: "Every edit from either side goes through the same validated, atomic operations and lands in the same undo history.",
    features: [
      ["Cheap to read", "get_document_outline returns one line per node, with configurable depth, so agents don't burn tokens on huge trees."],
      ["All or nothing", "Every write is a transaction. A partial edit never leaves the file broken."],
      ["Loud errors", "Unknown or misspelled fields are rejected with an actionable message instead of silently disappearing."],
      ["Checks its own work", "lint_design flags WCAG contrast, overflow and missing tokens; render_screenshot shows the result."],
      ["One style engine", "Canvas, screenshot and code export share nodeStyle, so what the agent sees is what you see."],
      ["Local, no account", "No SaaS, no call limits. The document is a .paprika.json file you can version with git."],
    ],
    howTitle: "How it works",
    steps: [
      ["1", "Run the server", "paprika serve opens the canvas and the MCP endpoint on 127.0.0.1."],
      ["2", "Connect your agent", "Point any MCP client at /mcp over HTTP, or use stdio."],
      ["3", "Design together", "Agent edits flash on the canvas live. Undo works for both of you."],
    ],
    startTitle: "Quick start",
    startLead: "Requirements: Node 22+ and pnpm 10+.",
    footer: "MIT License · This page was designed in Paprika over MCP.",
  },
  pt: {
    lang: "pt-BR",
    other: { label: "English", href: "link:../" },
    docs: "link:../docs/pt-BR/",
    nav: ["Docs", "GitHub"],
    pill: "Código aberto · MIT · 100% local",
    title: "O canvas de design que o seu agente de IA consegue usar de verdade.",
    lead: "O Paprika é uma ferramenta de design local com servidor MCP embutido. Você e o seu agente editam o mesmo documento ao mesmo tempo: o agente pelo MCP, você num canvas no navegador.",
    cta: ["Ler a documentação", "Ver no GitHub"],
    whyTitle: "Feito para agentes desde o início",
    whyLead: "Toda edição, de qualquer lado, passa pelas mesmas operações validadas e atômicas e entra no mesmo histórico de desfazer.",
    features: [
      ["Leitura barata", "get_document_outline devolve uma linha por nó, com profundidade configurável, e o agente não gasta tokens com árvores enormes."],
      ["Tudo ou nada", "Toda escrita é uma transação. Uma edição pela metade nunca deixa o arquivo quebrado."],
      ["Erros claros", "Campos desconhecidos ou com erro de digitação são recusados com uma mensagem acionável, em vez de sumirem."],
      ["Confere o próprio trabalho", "lint_design aponta contraste WCAG, overflow e tokens faltando; render_screenshot mostra o resultado."],
      ["Um só motor de estilo", "Canvas, screenshot e export de código usam o mesmo nodeStyle: o que o agente vê é o que você vê."],
      ["Local, sem conta", "Sem SaaS e sem limite de chamadas. O documento é um arquivo .paprika.json que você versiona com git."],
    ],
    howTitle: "Como funciona",
    steps: [
      ["1", "Suba o servidor", "paprika serve abre o canvas e o endpoint MCP em 127.0.0.1."],
      ["2", "Conecte o agente", "Aponte qualquer cliente MCP para /mcp via HTTP, ou use stdio."],
      ["3", "Desenhem juntos", "As edições do agente piscam no canvas ao vivo. O desfazer vale para os dois."],
    ],
    startTitle: "Começo rápido",
    startLead: "Requisitos: Node 22+ e pnpm 10+.",
    footer: "Licença MIT · Esta página foi desenhada no Paprika, pelo MCP.",
  },
};

const QUICKSTART = [
  "git clone https://github.com/leonardo-moraes360/paprika",
  "cd paprika && pnpm install && pnpm build",
  "server-go/bin/paprika serve --db design.db",
  "",
  "# canvas: http://127.0.0.1:4777 · MCP: http://127.0.0.1:4777/mcp",
  "claude mcp add --transport http paprika http://127.0.0.1:4777/mcp",
].join("\n");

const MONO = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace";

// ---------------------------------------------------------------- primitives

const T = (text, size, extra = {}) => ({
  type: "text",
  text,
  fontSize: size,
  color: "$ink",
  width: "fill",
  height: "hug",
  lineHeight: 1.5,
  ...extra,
});
const col = (name, children, layout = {}, extra = {}) => ({
  type: "frame",
  name,
  width: "fill",
  height: "hug",
  clip: false,
  layout: { mode: "column", gap: 0, padding: 0, align: "stretch", ...layout },
  children,
  ...extra,
});
const row = (name, children, layout = {}, extra = {}) => col(name, children, { mode: "row", align: "center", ...layout }, extra);
const navLink = (label, href, size) => T(label, size, { name: href, width: "hug", color: "$muted", fontWeight: 500 });
const button = (label, href, primary, size) =>
  row(
    href,
    [T(label, size, { width: "hug", fontWeight: 600, color: primary ? "$on.brand" : "$ink", lineHeight: 1.2 })],
    { padding: [14, 22, 14, 22], justify: "center" },
    {
      width: "hug",
      radius: 10,
      ...(primary ? { fill: "$brand.dark" } : { stroke: { color: "$line.strong", width: 1 } }),
    },
  );
const code = (text, size, pad) =>
  col("Código", [T(text, size, { fontFamily: MONO, color: "$code", lineHeight: 1.7 })], { padding: pad }, {
    fill: "$surface.2",
    radius: 14,
    stroke: { color: "$line", width: 1 },
  });

// ---------------------------------------------------------------- page

function page(c, mobile) {
  const W = mobile ? 390 : 1280;
  const px = mobile ? 20 : 80;
  const s = mobile
    ? { h1: 38, lead: 17, h2: 28, body: 15, small: 13, nav: 15, code: 12, card: 18 }
    : { h1: 64, lead: 21, h2: 40, body: 16, small: 14, nav: 16, code: 15, card: 20 };

  const nav = row(
    "Navegação",
    [
      row(
        "link:./",
        [
          { type: "image", name: "Ícone", src: ICON, alt: "Paprika", width: 36, height: 36, radius: 9 },
          T("Paprika", mobile ? 19 : 21, { width: "hug", fontWeight: 700, lineHeight: 1.2 }),
        ],
        { gap: 12 },
        { width: "hug" },
      ),
      row(
        "Links",
        [
          navLink(c.nav[0], c.docs, s.nav),
          navLink(c.nav[1], `link:${REPO}`, s.nav),
          ...(mobile ? [] : [navLink(c.other.label, c.other.href, s.nav)]),
        ],
        { gap: mobile ? 18 : 28 },
        { width: "hug" },
      ),
    ],
    { padding: [mobile ? 18 : 24, px, mobile ? 18 : 24, px], justify: "between" },
  );

  const heroText = col(
    "Texto do herói",
    [
      row("Selo", [T(c.pill, s.small, { width: "hug", color: "$brand.soft.ink", fontWeight: 600, lineHeight: 1.2 })], { padding: [7, 14, 7, 14] }, {
        width: "hug",
        radius: 999,
        fill: "$brand.soft",
      }),
      T(c.title, s.h1, { fontWeight: 800, lineHeight: 1.06, letterSpacing: mobile ? -0.8 : -1.6 }),
      T(c.lead, s.lead, { color: "$muted", lineHeight: 1.55 }),
      row(
        "Chamadas",
        [button(c.cta[0], c.docs, true, s.body), button(c.cta[1], `link:${REPO}`, false, s.body)],
        { gap: 14, wrap: true },
      ),
    ],
    { gap: mobile ? 20 : 26, align: "start" },
  );
  const heroArt = {
    type: "image",
    name: "Ilustração",
    src: ICON,
    alt: "Paprika pepper icon",
    width: mobile ? 120 : 340,
    height: mobile ? 120 : 340,
    radius: mobile ? 28 : 78,
    shadow: { x: 0, y: 30, blur: 80, spread: 0, color: "rgba(224, 74, 43, 0.25)" },
  };
  const hero = mobile
    ? col("Herói", [heroArt, heroText], { gap: 28, padding: [28, px, 48, px], align: "start" })
    : row("Herói", [heroText, heroArt], { gap: 64, padding: [64, px, 96, px] });

  const card = ([title, body]) =>
    col(
      "Card",
      [T(title, s.card, { fontWeight: 700, lineHeight: 1.25 }), T(body, s.body, { color: "$muted" })],
      { gap: 10, padding: mobile ? 20 : 26 },
      { fill: "$surface", radius: 16, stroke: { color: "$line", width: 1 }, height: mobile ? "hug" : "fill" },
    );
  const grid = mobile
    ? c.features.map(card)
    : [0, 3].map((i) => row("Linha", c.features.slice(i, i + 3).map(card), { gap: 20, align: "stretch" }));

  const section = (name, title, lead, body, extra = {}) =>
    col(
      name,
      [
        col("Cabeçalho", [T(title, s.h2, { fontWeight: 800, lineHeight: 1.15, letterSpacing: mobile ? -0.5 : -1 }), ...(lead ? [T(lead, s.lead - 2, { color: "$muted" })] : [])], { gap: 12 }),
        ...body,
      ],
      { gap: mobile ? 24 : 36, padding: [mobile ? 48 : 80, px, mobile ? 48 : 80, px] },
      extra,
    );

  const why = section("Por quê", c.whyTitle, c.whyLead, [col("Grade", grid, { gap: mobile ? 14 : 20 })], { fill: "$bg.2" });

  const step = ([n, title, body]) =>
    col(
      "Passo",
      [
        row("Número", [T(n, s.body, { width: "hug", fontWeight: 800, color: "$on.brand", lineHeight: 1 })], { justify: "center" }, {
          width: 40,
          height: 40,
          radius: 20,
          fill: "$brand.dark",
        }),
        T(title, s.card, { fontWeight: 700, lineHeight: 1.25 }),
        T(body, s.body, { color: "$muted" }),
      ],
      { gap: 12, align: "start" },
    );
  const how = section("Como funciona", c.howTitle, null, [
    (mobile ? col : row)("Passos", c.steps.map(step), { gap: mobile ? 28 : 32, align: "start" }),
  ]);

  const start = section("Começo rápido", c.startTitle, c.startLead, [code(QUICKSTART, s.code, mobile ? 18 : 28)], { fill: "$bg.2" });

  const footer = (mobile ? col : row)(
    "Rodapé",
    [
      T(c.footer, s.small, { color: "$muted", width: mobile ? "fill" : "hug" }),
      row(
        "Links do rodapé",
        [navLink("GitHub", `link:${REPO}`, s.small), navLink(c.nav[0], c.docs, s.small), navLink(c.other.label, c.other.href, s.small)],
        { gap: 20 },
        { width: "hug" },
      ),
    ],
    { padding: [32, px, 40, px], justify: "between", gap: 16, align: mobile ? "start" : "center" },
  );

  return {
    type: "frame",
    id: `lp-${mobile ? "mobile" : "desktop"}-${c.lang}`,
    name: `Landing ${mobile ? "mobile" : "desktop"} (${c.lang})`,
    notes: "Published by apps/site/scripts/build.mjs. Nodes named link:<href> become links.",
    width: W,
    height: "hug",
    fill: "$bg",
    clip: true,
    layout: { mode: "column", gap: 0, padding: 0, align: "stretch" },
    children: [nav, hero, why, how, start, footer],
  };
}

// ---------------------------------------------------------------- draw

await call("apply_ops", {
  ops: [{ op: "rename_document", name: "Paprika landing page" }],
  label: "Nome do documento",
}).catch(() => {});

await call("set_tokens", {
  tokens: {
    bg: "#141827",
    "bg.2": "#181d2e",
    surface: "#1e2336",
    "surface.2": "#10131f",
    ink: "#eef0f7",
    muted: "#a6acc4",
    line: "#2c3350",
    "line.strong": "#3d4566",
    brand: "#e04a2b",
    "brand.dark": "#b8341b",
    "brand.soft": "rgba(224, 74, 43, 0.16)",
    "brand.soft.ink": "#ff9a7c",
    code: "#d6dbec",
    "on.brand": "#ffffff",
  },
});

const roots = [
  [copy.en, false, 0, 0],
  [copy.en, true, 1400, 0],
  [copy.pt, false, 0, 4200],
  [copy.pt, true, 1400, 4200],
];
for (const [c, mobile, x, y] of roots) {
  const node = { ...page(c, mobile), x, y };
  await call("delete_nodes", { ids: [node.id] }).catch(() => {});
  await call("create_nodes", { nodes: [node], label: `Landing ${c.lang} ${mobile ? "mobile" : "desktop"}` });
}

console.log(await call("lint_design", {}));
console.log(await call("get_document_outline", { depth: 1 }));
