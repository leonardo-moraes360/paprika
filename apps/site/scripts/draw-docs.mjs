import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4790/mcp";
const PAGE = process.env.PAPRIKA_PAGE ?? null;
const WORKSPACE = process.env.PAPRIKA_WORKSPACE ?? null;
let rpcId = 0;

async function call(name, args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "docs-agent/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: WORKSPACE ? { ...args, workspaceId: WORKSPACE } : args } }),
  });
  const json = await res.json();
  const r = json.result;
  if (!r || r.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? r?.content)}`);
  return r.content.map((c) => c.text ?? "").join("\n");
}

const brand = (file) => `data:image/svg+xml;base64,${readFileSync(fileURLToPath(new URL(`../../../docs/en-US/brand/${file}`, import.meta.url))).toString("base64")}`;
const LOCKUP = { dark: brand("lockup.svg"), light: brand("lockup-light.svg") };

const PALETTE = {
  dark: { bg: "#141827", "bg.2": "#181D2E", surface: "#1E2336", code: "#10131F", "code.ink": "#D6DBEC", "code.muted": "#8F98B5", ink: "#EEF0F7", body: "#D9DCEA", muted: "#A6ACC4", line: "#2C3350", "line.strong": "#3D4566", link: "#7FD6E2", select: "#4CC7D8", "select.soft": "rgba(76, 199, 216, 0.14)", red: "#EE4A35", "red.ink": "#FF8A75", yellow: "#FFC233", green: "#3FA75B" },
  light: { bg: "#FBF4E6", "bg.2": "#F5ECDA", surface: "#FFFFFF", code: "#2A1A14", "code.ink": "#F5ECDA", "code.muted": "#C9B79F", ink: "#2A1A14", body: "#3D2A22", muted: "#6E5548", line: "#EADFC9", "line.strong": "#D9C9AB", link: "#0E6F7C", select: "#1FA3B5", "select.soft": "rgba(31, 163, 181, 0.14)", red: "#E23B2E", "red.ink": "#B42A1C", yellow: "#F4B41A", green: "#2E8B4A" },
};
const TOKENS = Object.fromEntries(Object.entries(PALETTE).flatMap(([m, p]) => Object.entries(p).map(([k, v]) => [`docs.${m}.${k}`, v])));

const FONT_MONO = "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace";
const NAV = [
  ["Get started", ["Introduction", "Install with Docker", "Connect your agent"]],
  ["Use Paprika", ["Using the canvas", "Team sync", "Visual verification"]],
  ["Agents and MCP", ["MCP tools and file format", "Agent sessions", "Agent feedback"]],
  ["Brand", ["Brand guide"]],
  ["Contribute", ["Development", "CI", "Design boards", "Agent bus", "Backlog", "Contributing", "Security", "Code of Conduct"]],
  ["Reference", ["Architecture", "Go server", "Decisions (ADRs)", "Research"]],
];

function build(mode, kind, mobile) {
  const t = (k) => `$docs.${mode}.${k}`;
  const T = (text, size, extra = {}) => ({ type: "text", text, fontSize: size, color: t("ink"), width: "fill", height: "hug", lineHeight: 1.6, ...extra });
  const frame = (name, children, layout = {}, extra = {}) => ({ type: "frame", name, width: "fill", height: "hug", clip: false, layout: { mode: "column", gap: 0, padding: 0, align: "stretch", ...layout }, children, ...extra });
  const row = (name, children, layout = {}, extra = {}) => frame(name, children, { mode: "row", align: "center", ...layout }, extra);
  const box = (name, w, h, extra = {}) => ({ type: "rect", name, width: w, height: h, ...extra });
  const dot = (c, s = 8) => box("Ponto", s, s, { fill: t(c), radius: s * 0.3 });
  const code = (text, label) =>
    frame("Bloco de código", [
      row("Topo", [T(label, 12, { width: "hug", color: t("code.muted"), fontFamily: FONT_MONO, lineHeight: 1.2 }), row("Copiar", [T("Copy", 12, { width: "hug", color: t("code.ink"), fontWeight: 600, lineHeight: 1.2 })], { padding: [4, 10, 4, 10] }, { width: "hug", radius: 6, stroke: { color: t("line.strong"), width: 1 } })], { justify: "between", padding: [10, 14, 10, 18] }),
      box("Divisória", "fill", 1, { fill: t("line.strong") }),
      frame("Código", [T(text, 14, { fontFamily: FONT_MONO, color: t("code.ink"), lineHeight: 1.7 })], { padding: [16, 18, 18, 18] }),
    ], {}, { fill: t("code"), radius: 12, clip: true });

  const search = row("Busca", [box("Lupa", 12, 12, { radius: 6, stroke: { color: t("muted"), width: 1.6 } }), T("Search docs", 14, { color: t("muted"), lineHeight: 1.2 }), row("Atalho", [T("/", 12, { width: "hug", color: t("muted"), fontFamily: FONT_MONO, lineHeight: 1.2 })], { padding: [2, 7, 2, 7] }, { width: "hug", radius: 5, stroke: { color: t("line.strong"), width: 1 } })], { gap: 10, padding: [8, 12, 8, 12] }, { width: mobile ? "fill" : 300, radius: 9, fill: t("surface"), stroke: { color: t("line"), width: 1 } });
  const themeBtn = row("Tema", [mode === "dark" ? box("Lua", 14, 14, { radius: 7, fill: t("yellow") }) : box("Sol", 14, 14, { radius: 7, stroke: { color: t("red.ink"), width: 2.5 } })], { padding: 8, justify: "center" }, { width: "hug", radius: 8, stroke: { color: t("line"), width: 1 } });
  const top = mobile
    ? frame("Topo", [row("Linha", [{ type: "image", name: "Lockup", src: LOCKUP[mode], alt: "Paprika docs", width: 100, height: 25, fit: "contain" }, row("Ações", [themeBtn, row("Menu", [frame("Barras", [box("b", 16, 2, { fill: t("ink") }), box("b", 16, 2, { fill: t("ink") }), box("b", 16, 2, { fill: t("ink") })], { gap: 4 }, { width: 16 })], { padding: 9 }, { width: "hug", radius: 8, stroke: { color: t("line"), width: 1 } })], { gap: 8 }, { width: "hug" })], { justify: "between" }), search], { gap: 12, padding: [14, 16, 14, 16] }, { fill: t("bg"), stroke: { color: t("line"), width: 1 } })
    : row("Topo", [
        row("Esquerda", [{ type: "image", name: "Lockup", src: LOCKUP[mode], alt: "Paprika", width: 110, height: 28, fit: "contain" }, row("Selo", [T("Docs", 13, { width: "hug", color: t("muted"), fontWeight: 600, lineHeight: 1.2 })], { padding: [3, 9, 3, 9] }, { width: "hug", radius: 6, stroke: { color: t("line"), width: 1 } }), search], { gap: 18 }, { width: "hug" }),
        row("Direita", [T("Home", 15, { width: "hug", color: t("muted"), fontWeight: 500, lineHeight: 1.2 }), T("GitHub", 15, { width: "hug", color: t("muted"), fontWeight: 500, lineHeight: 1.2 }), T("Português", 15, { width: "hug", color: t("muted"), fontWeight: 500, lineHeight: 1.2 }), themeBtn], { gap: 24 }, { width: "hug" }),
      ], { justify: "between", padding: [14, 28, 14, 28] }, { fill: t("bg"), stroke: { color: t("line"), width: 1 } });

  const current = kind === "home" ? "Introduction" : "MCP tools and file format";
  const sidebar = frame(
    "Navegação",
    NAV.map(([group, items]) =>
      frame("Grupo", [
        T(group.toUpperCase(), 11.5, { color: t("muted"), fontWeight: 700, letterSpacing: 0.8, lineHeight: 1.2 }),
        ...items.map((it) =>
          it === current
            ? row("Item ativo", [box("Barra", 3, 18, { fill: t("select"), radius: 2 }), T(it, 14, { fontWeight: 600, lineHeight: 1.3 })], { gap: 9, padding: [6, 10, 6, 0] }, { fill: t("select.soft"), radius: 7 })
            : frame("Item", [T(it, 14, { color: t("muted"), lineHeight: 1.3 })], { padding: [6, 10, 6, 12] }),
        ),
      ], { gap: 3 }),
    ),
    { gap: 22, padding: [28, 16, 28, 24] },
    { width: 264, height: "fill", stroke: { color: t("line"), width: 1 } },
  );

  let main;
  if (kind === "home") {
    const pathCard = (color, title, body, cta) =>
      frame("Caminho", [box("Marca", 28, 6, { fill: t(color), radius: 3 }), T(title, 19, { fontWeight: 700, lineHeight: 1.3 }), T(body, 15, { color: t("muted") }), T(`${cta} →`, 15, { color: t("link"), fontWeight: 600, lineHeight: 1.2 })], { gap: 10, padding: 22, align: "start" }, { fill: t("surface"), radius: 14, stroke: { color: t("line"), width: 1 }, height: mobile ? "hug" : "fill" });
    const paths = [
      pathCard("yellow", "Install with Docker", "One command starts the canvas and the MCP server on your computer.", "Install"),
      pathCard("red", "Connect your agent", "Add Paprika to Claude Code or any MCP client and ask for a first screen.", "Connect"),
      pathCard("green", "Contribute", "Build from source, run the tests and follow the design-first rule.", "Start contributing"),
    ];
    main = frame("Conteúdo", [
      frame("Cabeçalho", [T("Paprika docs", mobile ? 34 : 44, { fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }), T("Paprika is a design tool where you and your AI agent draw together, on your own computer. Pick where to start.", mobile ? 17 : 19, { color: t("muted"), lineHeight: 1.55 })], { gap: 14 }),
      (mobile ? frame : row)("Caminhos", paths, { gap: 16, align: "stretch" }),
      box("Divisória", "fill", 1, { fill: t("line") }),
      frame("Tudo", [
        T("Everything in the docs", 22, { fontWeight: 700, lineHeight: 1.3 }),
        (mobile ? frame : row)("Grupos", [0, 3].map((i) => frame("Coluna", NAV.slice(i, i + 3).map(([g, items]) => frame("Grupo", [T(g, 15, { fontWeight: 700, lineHeight: 1.3 }), ...items.map((it) => T(it, 14.5, { color: t("link"), lineHeight: 1.3 }))], { gap: 8 })), { gap: 24 })), { gap: 24, align: "start" }),
      ], { gap: 18 }),
    ], { gap: 36, padding: mobile ? [28, 16, 48, 16] : [44, 56, 72, 56] });
  } else {
    const table = frame("Tabela", [
      ["Tool", "What it does"],
      ["get_document_outline", "One line per node, with configurable depth"],
      ["create_nodes", "Creates nodes with nested children, atomically"],
      ["render_screenshot", "PNG of a node, from the same engine as the canvas"],
    ].map((r, i) => row("Linha", r.map((cell, j) => frame("Célula", [T(cell, 14, { fontFamily: j === 0 && i > 0 ? FONT_MONO : undefined, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? t("ink") : t("body"), lineHeight: 1.4 })], { padding: [10, 14, 10, 14] }, j === 0 ? { width: mobile ? 150 : 240 } : {})), { align: "stretch" }, { fill: i === 0 ? t("surface") : undefined, stroke: { color: t("line"), width: 1 } })), {}, { radius: 10, clip: true, stroke: { color: t("line"), width: 1 } });
    const callout = row("Aviso", [box("Faixa", 4, "fill", { fill: t("yellow"), radius: 2 }), T("Paprika listens only on localhost and has no login. Don't expose port 4777 to a network you don't trust.", 15, { color: t("body") })], { gap: 14, padding: [14, 16, 14, 14], align: "stretch" }, { fill: t("bg.2"), radius: 10 });
    const pn = (dir, title, align) => frame("Navegação de página", [T(dir, 13, { color: t("muted"), textAlign: align, lineHeight: 1.3 }), T(title, 16, { color: t("link"), fontWeight: 600, textAlign: align, lineHeight: 1.3 })], { gap: 4, padding: [14, 18, 14, 18] }, { radius: 12, stroke: { color: t("line"), width: 1 } });
    main = frame("Conteúdo", [
      T("Agents and MCP", 13, { color: t("muted"), fontWeight: 600, lineHeight: 1.2 }),
      T("MCP tools and file format", mobile ? 32 : 40, { fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.8 }),
      T("Every agent that speaks MCP gets the same tools. They all go through one validated, atomic path, so you and the agent share one undo history.", 17, { color: t("body"), lineHeight: 1.65 }),
      T("Connect an agent", 26, { fontWeight: 700, lineHeight: 1.3 }),
      code("claude mcp add --transport http paprika http://localhost:4777/mcp", "bash"),
      callout,
      T("Reading the document", 26, { fontWeight: 700, lineHeight: 1.3 }),
      table,
      (mobile ? frame : row)("Anterior e próxima", [pn("Previous", "Connect your agent", "left"), pn("Next", "Agent sessions", "right")], { gap: 16 }),
      T("Edit this page on GitHub", 14, { color: t("muted"), lineHeight: 1.2 }),
    ], { gap: 20, padding: mobile ? [24, 16, 48, 16] : [40, 56, 72, 56] });
  }

  const toc = frame("Nesta página", [
    T("ON THIS PAGE", 11.5, { color: t("muted"), fontWeight: 700, letterSpacing: 0.8, lineHeight: 1.2 }),
    row("Item", [box("Barra", 2, 16, { fill: t("select") }), T("Connect an agent", 14, { lineHeight: 1.3 })], { gap: 10 }),
    row("Item", [box("Barra", 2, 16, { fill: t("line") }), T("Reading the document", 14, { color: t("muted"), lineHeight: 1.3 })], { gap: 10 }),
    row("Item", [box("Barra", 2, 16, { fill: t("line") }), T("Writing", 14, { color: t("muted"), lineHeight: 1.3 })], { gap: 10 }),
    row("Item", [box("Barra", 2, 16, { fill: t("line") }), T("File format", 14, { color: t("muted"), lineHeight: 1.3 })], { gap: 10 }),
  ], { gap: 12, padding: [40, 24, 24, 8] }, { width: 220 });

  const body = mobile ? main : row("Corpo", [sidebar, main, ...(kind === "page" ? [toc] : [])], { align: "stretch" });
  const id = `docs-${kind}-${mode}${mobile ? "-mobile" : ""}`;
  return {
    type: "frame",
    id,
    name: `Docs ${kind === "home" ? "home" : "page"} ${mode}${mobile ? " mobile" : ""}`,
    width: mobile ? 390 : 1280,
    height: "hug",
    fill: t("bg"),
    clip: true,
    layout: { mode: "column", gap: 0, padding: 0, align: "stretch" },
    children: [top, body],
  };
}

await call("set_tokens", { tokens: TOKENS });
const roots = [
  ["dark", "home", false, 0, 0],
  ["dark", "page", false, 1400, 0],
  ["light", "page", false, 2800, 0],
  ["light", "home", false, 4200, 0],
  ["dark", "page", true, 5600, 0],
  ["light", "page", true, 6100, 0],
];
for (const [mode, kind, mobile, x, y] of roots) {
  const node = { ...build(mode, kind, mobile), x, y };
  await call("delete_nodes", { ids: [node.id] }).catch(() => {});
  await call("create_nodes", { nodes: [node], parentId: PAGE, label: node.name });
}
console.log(await call("lint_design", { rootIds: roots.map(([m, k, mo]) => `docs-${k}-${m}${mo ? "-mobile" : ""}`), minSeverity: "warning" }));
