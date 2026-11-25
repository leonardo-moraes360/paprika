#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveShots, textOf, unwrapTool } from "./design-board.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-080");
const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";

let session = "";
let rpcId = 0;

async function rpc(method, params) {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  session = res.headers.get("mcp-session-id") ?? session;
  const raw = await res.text();
  if (!res.ok && res.status !== 202) throw new Error(`${method} HTTP ${res.status}: ${raw.slice(0, 400)}`);
  if (!raw.trim()) return {};
  const line = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).at(-1);
  const body = JSON.parse(line || raw);
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pap-b-080-design", version: "0" } });

async function call(name, args = {}) {
  return unwrapTool(name, await rpc("tools/call", { name, arguments: args }));
}

const wsRaw = textOf(await call("list_workspaces"));
let parsed;
try {
  parsed = JSON.parse(wsRaw);
} catch {
  parsed = { workspaces: [] };
}
const list = parsed.workspaces ?? parsed;
console.log("workspaces", list.map((w) => `${w.id}:${w.name}`).join(" | "));
const ui = list.find((w) => w.name === "Paprica · UI") ?? list.find((w) => /paprica/i.test(w.name ?? "") && /ui/i.test(w.name ?? ""));
if (!ui?.id) throw new Error("workspace Paprica · UI not found");
const workspaceId = ui.id;
console.log("workspaceId", workspaceId, ui.name);

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 1 }));
const pages = [...outline.matchAll(/^page#(\S+)(?: "([^"]*)")?/gm)].map((m) => ({ id: m[1], name: m[2] ?? "" }));
console.log("pages", pages);
let pageId = pages.find((p) => p.id === "interfaces")?.id;
if (!pageId) {
  const named = pages.filter((p) => p.name === "Interfaces");
  pageId = named[0]?.id;
}
if (!pageId) throw new Error("Interfaces page not found");

const pageOutline = textOf(await call("get_document_outline", { workspaceId, depth: 1, rootId: pageId }));
const ys = [...pageOutline.matchAll(/@-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const heights = [...pageOutline.matchAll(/(\d{1,8}(?:\.\d{1,8})?)×(\d{1,8}(?:\.\d{1,8})?) @/g)].map((m) => Number(m[2]));
const bottoms = ys.map((y, i) => y + (heights[i] ?? 0));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Math.ceil((maxBottom + 240) / 40) * 40;
console.log("page", pageId, "y", Y, "maxBottom", maxBottom);

const night = { bg: "#1e2336", panel: "#272d45", muted: "#2c3350", fg: "#eef0f7", mutedFg: "#a6acc4", line: "#3a4266", accent: "#4cc7d8", card: "#141827" };
const day = { bg: "#f4f5f8", panel: "#ffffff", muted: "#e7e9f2", fg: "#1a1d2b", mutedFg: "#5c6478", line: "#d5d9e6", accent: "#0b7183", card: "#ffffff" };

function text(id, value, x, y, w, color, size, weight = 400) {
  return {
    type: "text",
    id,
    text: value,
    x,
    y,
    width: w,
    height: "hug",
    color,
    fontSize: size,
    fontWeight: weight,
    fontFamily: "Inter, system-ui, sans-serif",
  };
}

function field(id, x, y, w, label, value, t) {
  return {
    type: "frame",
    id,
    name: label,
    x,
    y,
    width: w,
    height: 28,
    fill: t.muted,
    radius: 6,
    children: [text(`${id}-l`, label, 8, 6, 52, t.mutedFg, 12), text(`${id}-v`, value, 62, 6, Math.max(24, w - 70), t.fg, 12)],
  };
}

function panel(id, name, x, y, t) {
  const swatch = (sid, sx, sy, fill) => ({
    type: "rect",
    id: sid,
    x: sx,
    y: sy,
    width: 16,
    height: 16,
    fill,
    radius: 4,
    stroke: { color: t.line, width: 1 },
  });
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 320,
    height: 600,
    fill: t.bg,
    radius: 12,
    clip: true,
    children: [
      text(`${id}-title`, "Efeitos", 16, 14, 288, t.fg, 13, 700),
      text(`${id}-sh`, "Sombras", 16, 44, 200, t.mutedFg, 11, 600),
      {
        type: "frame",
        id: `${id}-s1`,
        name: "sombra externa",
        x: 16,
        y: 66,
        width: 288,
        height: 96,
        fill: t.panel,
        radius: 8,
        stroke: { color: t.line, width: 1 },
        children: [
          field(`${id}-s1x`, 8, 8, 132, "X", "0", t),
          field(`${id}-s1y`, 148, 8, 132, "Y", "8", t),
          field(`${id}-s1b`, 8, 40, 132, "Blur", "16", t),
          field(`${id}-s1p`, 148, 40, 132, "Exp", "0", t),
          swatch(`${id}-s1c`, 8, 72, "#00000055"),
          text(`${id}-s1k`, "externa", 32, 72, 80, t.fg, 11),
        ],
      },
      {
        type: "frame",
        id: `${id}-s2`,
        name: "sombra interna",
        x: 16,
        y: 170,
        width: 288,
        height: 96,
        fill: t.panel,
        radius: 8,
        stroke: { color: t.accent, width: 1 },
        children: [
          field(`${id}-s2x`, 8, 8, 132, "X", "0", t),
          field(`${id}-s2y`, 148, 8, 132, "Y", "2", t),
          field(`${id}-s2b`, 8, 40, 132, "Blur", "6", t),
          field(`${id}-s2p`, 148, 40, 132, "Exp", "0", t),
          swatch(`${id}-s2c`, 8, 72, "#4cc7d8"),
          text(`${id}-s2k`, "interna", 32, 72, 80, t.accent, 11, 600),
        ],
      },
      {
        type: "frame",
        id: `${id}-add`,
        name: "adicionar sombra",
        x: 16,
        y: 274,
        width: 288,
        height: 28,
        fill: t.muted,
        radius: 6,
        children: [text(`${id}-add-t`, "+ sombra", 100, 6, 88, t.fg, 12, 600)],
      },
      text(`${id}-ol`, "Contorno", 16, 316, 200, t.mutedFg, 11, 600),
      field(`${id}-ow`, 16, 336, 140, "Larg.", "2", t),
      field(`${id}-os`, 164, 336, 140, "Tipo", "sólido", t),
      field(`${id}-oo`, 16, 370, 140, "Offset", "2", t),
      swatch(`${id}-oc`, 172, 376, t.accent),
      text(`${id}-fl`, "Filtro", 16, 412, 200, t.mutedFg, 11, 600),
      field(`${id}-fb`, 16, 432, 140, "Blur", "0", t),
      field(`${id}-fs`, 164, 432, 140, "Sat", "1", t),
      field(`${id}-fg`, 16, 466, 140, "Cinza", "0", t),
      field(`${id}-fh`, 164, 466, 140, "Matiz", "0", t),
      text(`${id}-bd`, "Filtro de fundo", 16, 508, 200, t.mutedFg, 11, 600),
      field(`${id}-bb`, 16, 528, 288, "Blur", "8", t),
    ],
  };
}

function preview(id, name, x, y, t) {
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 280,
    height: 320,
    fill: t.bg,
    radius: 12,
    clip: true,
    children: [
      text(`${id}-title`, "Prévia", 16, 14, 248, t.fg, 13, 700),
      {
        type: "rect",
        id: `${id}-sh1`,
        x: 48,
        y: 92,
        width: 184,
        height: 112,
        fill: "rgba(0,0,0,0.28)",
        radius: 16,
      },
      {
        type: "rect",
        id: `${id}-sh2`,
        x: 40,
        y: 78,
        width: 184,
        height: 112,
        fill: "rgba(76,199,216,0.35)",
        radius: 16,
      },
      {
        type: "frame",
        id: `${id}-card`,
        name: "cartão",
        x: 36,
        y: 70,
        width: 184,
        height: 112,
        fill: t.card,
        radius: 14,
        stroke: { color: t.accent, width: 2, position: "outside" },
        children: [
          text(`${id}-card-t`, "Sombra dupla", 16, 36, 152, t.fg, 14, 600),
          text(`${id}-card-s`, "contorno e desfoque", 16, 58, 152, t.mutedFg, 11),
        ],
      },
      text(`${id}-cap`, "lista, interna, contorno, filtro", 16, 276, 248, t.mutedFg, 11),
    ],
  };
}

const nodes = [
  panel("b080-fx-dark", "PAP-B-080 · efeitos · escuro", 40, Y, night),
  preview("b080-pv-dark", "PAP-B-080 · prévia · escuro", 400, Y, night),
  panel("b080-fx-light", "PAP-B-080 · efeitos · claro", 40, Y + 600, day),
  preview("b080-pv-light", "PAP-B-080 · prévia · claro", 400, Y + 600, day),
];

try {
  await call("delete_nodes", { workspaceId, ids: nodes.map((n) => n.id) });
} catch {
  console.log("delete skipped");
}

const created = await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-080 effects inspector",
  nodes,
});
console.log(textOf(created).slice(0, 500));

const shots = [
  ["b080-fx-dark", "01-efeitos-escuro.png"],
  ["b080-pv-dark", "02-previa-escuro.png"],
  ["b080-fx-light", "03-efeitos-claro.png"],
  ["b080-pv-light", "04-previa-claro.png"],
];
await saveShots(call, workspaceId, outDir, shots, (rootId, r) => {
  console.error("no image", rootId, textOf(r).slice(0, 400));
});

try {
  const lint = textOf(await call("lint_design", { workspaceId, rootId: "b080-fx-dark" }));
  console.log("lint dark", lint.slice(0, 800));
} catch {
  console.log("lint skipped");
}
