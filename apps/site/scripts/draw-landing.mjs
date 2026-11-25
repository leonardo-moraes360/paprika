import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEMES, symbolLayers } from "../../../scripts/brand/trio-pixel.mjs";

const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4790/mcp";
const PAGE = process.env.PAPRIKA_PAGE ?? null;
const WORKSPACE = process.env.PAPRIKA_WORKSPACE ?? null;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const REPO = "https://github.com/leonardo-moraes360/paprika";
let rpcId = 0;

async function call(name, args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "landing-agent/2" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: WORKSPACE ? { ...args, workspaceId: WORKSPACE } : args } }),
  });
  const json = await res.json();
  const r = json.result;
  if (!r || r.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? r?.content)}`);
  return r.content.map((c) => c.text ?? "").join("\n");
}

const brand = (file) => readFileSync(fileURLToPath(new URL(`../../../docs/en-US/brand/${file}`, import.meta.url)));
const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const layerSvg = (l) =>
  `<path d="${l.d}" fill="${l.fill ?? "none"}"${l.stroke ? ` stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="round"` : ""}/>`;
const symbolSvg = (c, selection) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${symbolLayers(c, { selection }).map(layerSvg).join("")}</svg>`;
const MONO = { ...THEMES.dark, vermelho: "#3A4263", amarelo: "#3A4263", verde: "#3A4263", verdeEscuro: "#3A4263", brilho: "#4A5378", selecao: "#4A5378", alca: "#141827" };

const ASSETS = {
  lockup: dataUri(brand("lockup.svg")),
  symbol: dataUri(symbolSvg(THEMES.dark, true)),
  symbolMono: dataUri(symbolSvg(MONO, true)),
};

const TOKENS = {
  bg: "#141827",
  "bg.2": "#181D2E",
  canvas: "#161A2A",
  surface: "#1E2336",
  "surface.2": "#10131F",
  ink: "#EEF0F7",
  muted: "#A6ACC4",
  line: "#2C3350",
  "line.strong": "#3D4566",
  red: "#EE4A35",
  "red.strong": "#CC3A27",
  "red.ink": "#FF8A75",
  yellow: "#FFC233",
  green: "#3FA75B",
  "green.ink": "#6FCB85",
  stem: "#4F9A5A",
  select: "#4CC7D8",
  "on.red": "#FFFFFF",
  code: "#D6DBEC",
  "paper": "#FBF4E6",
  "paper.ink": "#2A1A14",
  "paper.muted": "#7A5F52",
  "paper.line": "#EADFC9",
};

const SETUP_PROMPT = [
  "Please set up Paprika for me, a local design tool for AI agents",
  "(https://github.com/leonardo-moraes360/paprika).",
  "",
  "1. Check that Docker and Docker Compose are installed and running…",
  "2. Clone the repository and run `docker compose up -d --build`…",
];
const SETUP_PROMPT_PT = [
  "Configure o Paprika para mim, uma ferramenta de design local para",
  "agentes de IA (https://github.com/leonardo-moraes360/paprika).",
  "",
  "1. Confira se o Docker e o Docker Compose estão instalados…",
  "2. Clone o repositório e rode `docker compose up -d --build`…",
];

const copy = JSON.parse(readFileSync(fileURLToPath(new URL("./landing-copy.json", import.meta.url)), "utf8"));
copy.en.prompt = SETUP_PROMPT;
copy.pt.prompt = SETUP_PROMPT_PT;

const FONT_MONO = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace";
const CURSOR = "M0 0 L0 17 L4.6 12.6 L7.6 19.4 L10.4 18.2 L7.4 11.6 L13 11.6 Z";

const T = (text, size, extra = {}) => ({ type: "text", text, fontSize: size, color: "$ink", width: "fill", height: "hug", lineHeight: 1.5, ...extra });
const frame = (name, children, layout = {}, extra = {}) => ({
  type: "frame",
  name,
  width: "fill",
  height: "hug",
  clip: false,
  layout: { mode: "column", gap: 0, padding: 0, align: "stretch", ...layout },
  children,
  ...extra,
});
const col = frame;
const row = (name, children, layout = {}, extra = {}) => frame(name, children, { mode: "row", align: "center", ...layout }, extra);
const box = (name, w, h, extra = {}) => ({ type: "rect", name, width: w, height: h, ...extra });
const dot = (color, size = 10) => box("Ponto", size, size, { fill: color, radius: size * 0.3 });
const navLink = (label, href, size) => T(label, size, { name: href, width: "hug", color: "$muted", fontWeight: 500, lineHeight: 1.2 });
const button = (label, href, primary, size) =>
  row(
    href,
    [T(label, size, { width: "hug", fontWeight: 600, color: primary ? "$on.red" : "$ink", lineHeight: 1.2 })],
    { padding: [14, 22, 14, 22], justify: "center" },
    { width: "hug", radius: 10, ...(primary ? { fill: "$red.strong" } : { stroke: { color: "$line.strong", width: 1 } }) },
  );
const code = (text, size, pad, name = "Código") =>
  col(name, [T(text, size, { fontFamily: FONT_MONO, color: "$code", lineHeight: 1.7 })], { padding: pad }, {
    fill: "$surface.2",
    radius: 12,
    stroke: { color: "$line", width: 1 },
  });

function canvasWindow(c, k) {
  const w = c.window;
  const handle = (x, y) => box("Alça", 8 * k, 8 * k, { x, y, fill: "$surface", stroke: { color: "$select", width: 1.5 * k }, radius: 1.5 * k, layoutPositioning: "absolute" });
  const phoneW = 190 * k, phoneH = 250 * k;
  const btnY = 168 * k, btnX = 18 * k, btnW = phoneW - 36 * k, btnH = 34 * k;
  const input = (label) =>
    col("Campo", [T(label, 9.5 * k, { color: "$paper.muted", lineHeight: 1.2 }), box("Caixa", "fill", 24 * k, { fill: "#FFFFFF", radius: 6 * k, stroke: { color: "$paper.line", width: 1 } })], { gap: 4 * k });
  const phone = {
    type: "frame",
    name: "Tela desenhada",
    x: 150 * k,
    y: 34 * k,
    width: phoneW,
    height: phoneH,
    fill: "$paper",
    radius: 16 * k,
    clip: false,
    layout: { mode: "none" },
    children: [
      col(
        "Conteúdo",
        [
          row("Marca do app", [dot("$red", 12 * k), T("Bean & Co.", 10 * k, { width: "hug", fontWeight: 700, color: "$paper.ink", lineHeight: 1.2 })], { gap: 6 * k }),
          T(w.screen, 16 * k, { fontWeight: 800, color: "$paper.ink", lineHeight: 1.15 }),
          input(w.fields[0]),
          input(w.fields[1]),
        ],
        { gap: 10 * k, padding: [18 * k, 18 * k, 0, 18 * k] },
        { x: 0, y: 0, width: phoneW, layoutPositioning: "absolute" },
      ),
      row("Botão", [T(w.button, 11 * k, { width: "hug", fontWeight: 700, color: "$on.red", lineHeight: 1.2 })], { justify: "center" }, {
        x: btnX, y: btnY, width: btnW, height: btnH, radius: 8 * k, fill: "$red.strong", layoutPositioning: "absolute",
      }),
      box("Seleção", btnW + 8 * k, btnH + 8 * k, { x: btnX - 4 * k, y: btnY - 4 * k, stroke: { color: "$select", width: 1.5 * k }, layoutPositioning: "absolute" }),
      handle(btnX - 8 * k, btnY - 8 * k),
      handle(btnX + btnW - 0 * k, btnY - 8 * k),
      handle(btnX - 8 * k, btnY + btnH),
      handle(btnX + btnW, btnY + btnH),
    ],
  };
  const cursor = {
    type: "frame",
    name: "Cursor do agente",
    x: 150 * k + btnX + btnW - 30 * k,
    y: 34 * k + btnY + btnH - 6 * k,
    width: "hug",
    height: "hug",
    clip: false,
    layout: { mode: "column", gap: 2 * k, align: "start" },
    children: [
      { type: "path", name: "Ponteiro", d: CURSOR, width: 13 * k, height: 19.4 * k, fill: "$yellow", stroke: { color: "$bg", width: 1.2 * k } },
      row("Rótulo", [T(w.agent, 10 * k, { width: "hug", fontWeight: 700, color: "$bg", lineHeight: 1.2 })], { padding: [3 * k, 7 * k, 3 * k, 7 * k] }, {
        width: "hug", radius: 6 * k, fill: "$yellow",
      }),
    ],
    layoutPositioning: "absolute",
  };
  const layerLine = (wid, ind, active) =>
    row("Camada", [box("Ícone", 7 * k, 7 * k, { fill: active ? "$select" : "$line.strong", radius: 1.5 * k }), box("Nome", wid * k, 6 * k, { fill: active ? "$ink" : "$line.strong", radius: 3 * k })], { gap: 6 * k, padding: [5 * k, 8 * k, 5 * k, (8 + ind) * k] }, active ? { fill: "rgba(76, 199, 216, 0.14)", radius: 5 * k } : {});
  const layers = col(
    "Camadas",
    [layerLine(58, 0, false), layerLine(46, 10, false), layerLine(40, 10, false), layerLine(50, 10, false), layerLine(36, 10, true), layerLine(52, 0, false)],
    { gap: 2 * k, padding: [12 * k, 6 * k, 12 * k, 6 * k] },
    { width: 110 * k, height: "fill", fill: "$surface", stroke: { color: "$line", width: 1 } },
  );
  const stage = {
    type: "frame",
    name: "Canvas",
    width: "fill",
    height: "fill",
    fill: "$canvas",
    clip: true,
    layout: { mode: "none" },
    children: [{ ...phone, x: 40 * k }, { ...cursor, x: 40 * k + btnX + btnW - 30 * k }],
  };
  const bar = row(
    "Barra de título",
    [row("Pontos", [dot("$red", 10 * k), dot("$yellow", 10 * k), dot("$green", 10 * k)], { gap: 6 * k }, { width: "hug" }), T(w.file, 11 * k, { color: "$muted", lineHeight: 1.2 })],
    { gap: 14 * k, padding: [10 * k, 14 * k, 10 * k, 14 * k] },
    { fill: "$surface", stroke: { color: "$line", width: 1 } },
  );
  return col("Janela do canvas", [bar, row("Corpo", [layers, stage], { align: "stretch" }, { height: 320 * k })], {}, {
    width: 520 * k,
    radius: 14 * k,
    clip: true,
    fill: "$surface",
    stroke: { color: "$line.strong", width: 1 },
    shadow: [{ x: 0, y: 30 * k, blur: 80 * k, spread: 0, color: "rgba(0, 0, 0, 0.45)" }, { x: 0, y: 0, blur: 120 * k, spread: 0, color: "rgba(238, 74, 53, 0.12)" }],
  });
}

function thumb(i, c) {
  const tile = (children, layout = {}) => frame("Miniatura", children, { padding: 16, ...layout }, { height: 132, fill: "$canvas", radius: 12, stroke: { color: "$line", width: 1 }, clip: true });
  const mini = (fill, accent) =>
    col("Mini tela", [box("Título", 40, 6, { fill: accent, radius: 3 }), box("Linha", "fill", 5, { fill: "$line.strong", radius: 3 }), box("Linha", 34, 5, { fill: "$line.strong", radius: 3 }), box("Botão", "fill", 12, { fill: "$red.strong", radius: 4 })], { gap: 7, padding: 10 }, { width: 70, fill, radius: 8 });
  switch (i) {
    case 0:
      return tile([row("Telas", [mini("$surface", "$ink"), mini("$surface", "$ink"), col("Componente", [box("Botão", 54, 14, { fill: "$red.strong", radius: 4 })], { padding: 8 }, { width: "hug", stroke: { color: "$select", width: 1.5 }, radius: 4 })], { gap: 12 })], { justify: "center" });
    case 1: {
      const node = (label, fill) => row("Caixa", [T(label, 11, { width: "hug", fontWeight: 600, color: "$ink", lineHeight: 1.2 })], { padding: [8, 12, 8, 12] }, { width: "hug", fill, radius: 6, stroke: { color: "$line.strong", width: 1 } });
      return tile([row("Fluxo", [node(c.flow[0], "$surface"), box("Seta", 22, 2, { fill: "$muted" }), node(c.flow[1], "$surface"), box("Seta", 22, 2, { fill: "$muted" }), node(c.flow[2], "rgba(63, 167, 91, 0.22)")], { gap: 6 })], { justify: "center" });
    }
    case 2: {
      const half = (fill, ink) => col("Tema", [box("Título", 44, 7, { fill: ink, radius: 3 }), box("Linha", "fill", 5, { fill: ink, radius: 3, opacity: 0.35 }), box("Botão", 50, 14, { fill: "$red.strong", radius: 4 })], { gap: 8, padding: 14 }, { fill, radius: 8 });
      return tile([row("Temas", [half("$surface", "$ink"), half("$paper", "$paper.ink")], { gap: 10, align: "stretch" })], { justify: "center" });
    }
    default:
      return tile([T(`<Button tone="spice">\n  ${c.window.button}\n</Button>`, 13, { fontFamily: FONT_MONO, color: "$code", lineHeight: 1.6 })], { justify: "center" });
  }
}

function page(c, mobile) {
  const W = mobile ? 390 : 1280;
  const px = mobile ? 20 : 80;
  const s = mobile
    ? { h1: 36, lead: 17, h2: 28, body: 15, small: 13, nav: 15, code: 12, card: 18, tag: 13 }
    : { h1: 60, lead: 20, h2: 40, body: 16, small: 14, nav: 16, code: 14, card: 20, tag: 14 };

  const nav = row(
    "Navegação",
    [
      { type: "image", name: c.home, src: ASSETS.lockup, alt: "Paprika", width: mobile ? 104 : 126, height: mobile ? 26 : 32, fit: "contain" },
      row(
        "Links",
        [navLink(c.nav[0], c.docs, s.nav), navLink(c.nav[1], `link:${REPO}`, s.nav), ...(mobile ? [] : [navLink(c.other.label, c.other.href, s.nav)])],
        { gap: mobile ? 18 : 28 },
        { width: "hug" },
      ),
    ],
    { padding: [mobile ? 18 : 24, px, mobile ? 18 : 24, px], justify: "between" },
  );

  const tagline = row(
    "Frase de marca",
    [row("Trio", [dot("$yellow", 8), dot("$red", 8), dot("$green", 8)], { gap: 4 }, { width: "hug" }), T(c.tagline, s.tag, { width: "hug", color: "$red.ink", fontWeight: 600, lineHeight: 1.2 })],
    { gap: 10 },
    { width: "hug" },
  );
  const heroText = col(
    "Texto do herói",
    [
      tagline,
      T(c.title, s.h1, { name: "h1", fontWeight: 800, lineHeight: 1.06, letterSpacing: mobile ? -0.8 : -1.6 }),
      T(c.lead, s.lead, { color: "$muted", lineHeight: 1.55 }),
      row("Chamadas", [button(c.cta[0], "link:#start", true, s.body), button(c.cta[1], c.docs, false, s.body)], { gap: 14, wrap: true }),
    ],
    { gap: mobile ? 20 : 26, align: "start" },
    mobile ? {} : { width: 560 },
  );
  const hero = mobile
    ? col("Herói", [heroText, row("Arte", [canvasWindow(c, 0.66)], { justify: "center" })], { gap: 36, padding: [24, px, 40, px], align: "start" })
    : row("Herói", [heroText, row("Arte", [canvasWindow(c, 1)], { justify: "end" })], { gap: 40, padding: [56, px, 72, px] });

  const trust = (mobile ? col : row)(
    "Confiança",
    c.trust.map((t, i) => row("Item", [dot(["$yellow", "$red", "$green"][i], 8), T(t, s.small, { width: "hug", color: "$muted", fontWeight: 500, lineHeight: 1.2 })], { gap: 10 }, { width: "hug" })),
    { gap: mobile ? 12 : 40, padding: [mobile ? 20 : 22, px, mobile ? 20 : 22, px], align: mobile ? "start" : "center", justify: "center" },
    { stroke: { color: "$line", width: 1 }, fill: "$bg.2" },
  );

  const heading = (title, lead) =>
    col("Cabeçalho", [T(title, s.h2, { name: "h2", fontWeight: 800, lineHeight: 1.15, letterSpacing: mobile ? -0.5 : -1 }), ...(lead ? [T(lead, s.lead - 2, { color: "$muted" })] : [])], { gap: 12 });
  const section = (name, body, extra = {}, pad = mobile ? 48 : 88) => col(name, body, { gap: mobile ? 24 : 40, padding: [pad, px, pad, px] }, extra);

  const makeCard = ([title, body], i) =>
    col("Card", [thumb(i, c), col("Texto", [T(title, s.card, { name: "h3", fontWeight: 700, lineHeight: 1.25 }), T(body, s.body, { color: "$muted" })], { gap: 8 })], { gap: 18, padding: mobile ? 16 : 18 }, {
      fill: "$surface",
      radius: 16,
      stroke: { color: "$line", width: 1 },
      height: mobile ? "hug" : "fill",
    });
  const makeGrid = mobile ? c.make.map(makeCard) : [0, 2].map((i) => row("Linha", c.make.slice(i, i + 2).map((m, j) => makeCard(m, i + j)), { gap: 20, align: "stretch" }));
  const make = section("O que faz", [heading(c.makeTitle, c.makeLead), col("Grade", makeGrid, { gap: mobile ? 14 : 20 })]);

  const control = section(
    "Controle",
    [
      heading(c.controlTitle),
      (mobile ? col : row)(
        "Itens",
        c.control.map(([title, body], i) =>
          col("Item", [box("Marca", 28, 6, { fill: ["$yellow", "$red", "$green"][i], radius: 3 }), T(title, s.card, { name: "h3", fontWeight: 700, lineHeight: 1.25 }), T(body, s.body, { color: "$muted" })], { gap: 12, align: "start" }),
        ),
        { gap: mobile ? 28 : 40, align: "start" },
      ),
    ],
    { fill: "$bg.2" },
  );

  const checkCard = col(
    "Relatório",
    [
      row("Topo", [dot("$select", 10), T(c.checkCard, s.small, { color: "$muted", fontWeight: 600, lineHeight: 1.2 })], { gap: 10 }),
      ...c.checks.map(([tone, text]) =>
        row("Linha", [box("Estado", 14, 14, { fill: tone === "green" ? "$green" : "$yellow", radius: 4 }), T(text, s.body, { lineHeight: 1.35 })], { gap: 12, padding: [12, 14, 12, 14] }, { fill: "$surface.2", radius: 10 }),
      ),
    ],
    { gap: 10, padding: mobile ? 16 : 22 },
    { width: mobile ? "fill" : 460, fill: "$surface", radius: 16, stroke: { color: "$line", width: 1 } },
  );
  const check = section("Confere", [(mobile ? col : row)("Conteúdo", [col("Texto", [heading(c.checkTitle, c.checkLead)], {}, mobile ? {} : { width: 560 }), checkCard], { gap: mobile ? 24 : 80, justify: "between" })]);

  const step = ([title, cmd], i) =>
    col(
      "Passo",
      [
        row("Topo", [row("Número", [T(String(i + 1), s.body, { width: "hug", fontWeight: 800, color: "$on.red", lineHeight: 1 })], { justify: "center" }, { width: 32, height: 32, radius: 8, fill: "$red.strong" }), T(title, s.card, { name: "h3", fontWeight: 700, lineHeight: 1.25 })], { gap: 14 }),
        code(cmd, s.code, mobile ? 14 : 18),
      ],
      { gap: 14 },
    );
  const prompt = col(
    "Prompt",
    [
      col("Texto", [T(c.promptTitle, s.card, { name: "h3", fontWeight: 700, lineHeight: 1.25 }), T(c.promptLead, s.body, { color: "$muted" })], { gap: 8 }),
      code(c.prompt.join("\n"), s.code, mobile ? 14 : 18, "Prompt de setup"),
      button(c.promptCta, "copy:setup-prompt", false, s.body),
    ],
    { gap: 18, padding: mobile ? 16 : 24, align: "start" },
    { fill: "$surface", radius: 16, stroke: { color: "$line", width: 1 }, ...(mobile ? {} : { width: 500 }) },
  );
  const start = section(
    "anchor:start",
    [heading(c.startTitle, c.startLead), (mobile ? col : row)("Conteúdo", [col("Passos", c.steps.map(step), { gap: 28 }), prompt], { gap: mobile ? 32 : 48, align: "start" })],
    { fill: "$bg.2" },
  );

  const pattern = row(
    "Padrão",
    Array.from({ length: mobile ? 5 : 12 }, (_, i) => ({ type: "image", name: "Símbolo", src: i % 2 ? ASSETS.symbolMono : ASSETS.symbol, alt: "", decorative: true, width: 56, height: 56 })),
    { gap: mobile ? 16 : 30, justify: "center" },
    { opacity: 0.9 },
  );
  const team = section(
    "Time",
    [pattern, col("Texto", [T(c.teamTitle, s.h2, { name: "h2", fontWeight: 800, lineHeight: 1.15, letterSpacing: mobile ? -0.5 : -1, textAlign: mobile ? "left" : "center" }), T(c.teamLead, s.lead - 2, { color: "$muted", textAlign: mobile ? "left" : "center" }), button(c.teamCta, c.team, false, s.body)], { gap: 18, align: mobile ? "start" : "center" }, mobile ? {} : { width: 760 })],
    {},
  );
  team.layout.align = mobile ? "stretch" : "center";

  const footer = (mobile ? col : row)(
    "Rodapé",
    [
      col("Assinatura", [{ type: "image", name: c.home, src: ASSETS.lockup, alt: "Paprika", width: 104, height: 26, fit: "contain" }, T(c.footer, s.small, { color: "$muted", width: mobile ? "fill" : "hug" })], { gap: 12, align: "start" }, { width: mobile ? "fill" : "hug" }),
      row("Links do rodapé", [navLink("GitHub", `link:${REPO}`, s.small), navLink(c.nav[0], c.docs, s.small), navLink(c.other.label, c.other.href, s.small)], { gap: 20 }, { width: "hug" }),
    ],
    { padding: [36, px, 44, px], justify: "between", gap: 20, align: mobile ? "start" : "end" },
    { stroke: { color: "$line", width: 1 } },
  );

  return {
    type: "frame",
    id: `lp-${mobile ? "mobile" : "desktop"}-${c.lang}`,
    name: `Landing ${mobile ? "mobile" : "desktop"} (${c.lang})`,
    notes: "Published by apps/site/src/lib/landing.ts. Nodes named link:<href> become links, anchor:<id> sets an id, copy:<id> copies the text of the code block before it.",
    width: W,
    height: "hug",
    fill: "$bg",
    clip: true,
    layout: { mode: "column", gap: 0, padding: 0, align: "stretch" },
    children: [nav, hero, trust, make, control, check, start, team, footer],
  };
}

if (!PAGE) await call("apply_ops", { ops: [{ op: "rename_document", name: "Paprika landing page" }], label: "Nome do documento" }).catch(() => {});
await call("set_tokens", { tokens: TOKENS });

const roots = [
  [copy.en, false, 0, 0],
  [copy.en, true, 1400, 0],
  [copy.pt, false, 0, 4600],
  [copy.pt, true, 1400, 4600],
];
for (const [c, mobile, x, y] of roots) {
  const node = { ...page(c, mobile), x, y };
  if (ONLY && !ONLY.includes(node.id)) continue;
  await call("delete_nodes", { ids: [node.id] }).catch(() => {});
  await call("create_nodes", { nodes: [node], parentId: PAGE, label: `Landing ${c.lang} ${mobile ? "mobile" : "desktop"}` });
}

console.log(await call("lint_design", PAGE ? { rootId: PAGE } : {}));
