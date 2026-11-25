// Draws PAP-B-052 i18n boards (3 screens × en + pt-BR) over MCP HTTP.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pngFromBase64, shotPath } from "../../scripts/design-board.mjs";

const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../assets/boards/PAP-B-052");
mkdirSync(OUT, { recursive: true });
let rpcId = 0;
let sessionId = "";

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "pap-b-052/1",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(URL_, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data: ")) ?? raw;
  const json = JSON.parse(line.replace(/^data: /, ""));
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

async function call(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  if (r?.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const copy = {
  en: {
    overviewTitle: "Overview · English",
    overviewH1: "Workspaces",
    overviewLead: "1 workspace on this server. The active one is what agents see over MCP.",
    newWs: "New workspace",
    language: "Language",
    active: "active",
    canvasTitle: "Canvas chrome · English",
    pages: "Pages",
    page1: "Page 1",
    layers: "Layers",
    tools: "Select · Rectangle · Text",
    zoom: "Zoom − / + / Fit",
    switchTitle: "Language switch · English",
    switchLead: "Browser language is detected; the choice is remembered in localStorage.",
  },
  pt: {
    overviewTitle: "Visão geral · Português",
    overviewH1: "Workspaces",
    overviewLead: "1 workspace neste servidor. O ativo é o que os agentes enxergam pelo MCP.",
    newWs: "Novo workspace",
    language: "Idioma",
    active: "ativo",
    canvasTitle: "Chrome do canvas · Português",
    pages: "Páginas",
    page1: "Página 1",
    layers: "Camadas",
    tools: "Selecionar · Retângulo · Texto",
    zoom: "Zoom − / + / Enquadrar",
    switchTitle: "Troca de idioma · Português",
    switchLead: "O idioma do navegador é detectado; a escolha fica no localStorage.",
  },
};

function screen(c, mode, x, y) {
  const card = (label, sub, ox, oy) => ({
    type: "frame",
    name: label,
    x: ox,
    y: oy,
    width: 220,
    height: 120,
    fill: mode === "dark" ? "#1c2230" : "#ffffff",
    radius: 12,
    stroke: { color: mode === "dark" ? "#2a3344" : "#e5e0d8", width: 1 },
    children: [
      { type: "text", text: label, x: 14, y: 16, width: 192, height: "hug", fontSize: 15, fontWeight: 650, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
      { type: "text", text: sub, x: 14, y: 44, width: 192, height: "hug", fontSize: 12, color: mode === "dark" ? "#9aa3b5" : "#5c6570" },
      {
        type: "frame",
        name: "badge",
        x: 150,
        y: 10,
        width: 56,
        height: 22,
        fill: "#c43d27",
        radius: 99,
        children: [{ type: "text", text: c.active, x: 8, y: 3, width: 40, height: "hug", fontSize: 11, fontWeight: 600, color: "#ffffff" }],
      },
    ],
  });
  return {
    type: "frame",
    name: c.overviewTitle,
    x,
    y,
    width: 720,
    height: 420,
    fill: mode === "dark" ? "#141827" : "#f7f4ef",
    mode,
    layout: { mode: "none" },
    children: [
      { type: "text", text: "Paprika", x: 24, y: 18, width: 120, height: "hug", fontSize: 14, fontWeight: 700, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
      {
        type: "frame",
        name: "lang",
        x: 560,
        y: 14,
        width: 130,
        height: 28,
        fill: mode === "dark" ? "#1c2230" : "#ffffff",
        radius: 6,
        stroke: { color: mode === "dark" ? "#2a3344" : "#d8d2c8", width: 1 },
        children: [{ type: "text", text: c.language, x: 10, y: 6, width: 110, height: "hug", fontSize: 12, color: mode === "dark" ? "#c8cfdc" : "#3a4050" }],
      },
      { type: "text", text: c.overviewH1, x: 24, y: 64, width: 280, height: "hug", fontSize: 22, fontWeight: 650, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
      { type: "text", text: c.overviewLead, x: 24, y: 96, width: 420, height: "hug", fontSize: 13, color: mode === "dark" ? "#9aa3b5" : "#5c6570" },
      {
        type: "frame",
        name: "cta",
        x: 520,
        y: 72,
        width: 170,
        height: 36,
        fill: "#c43d27",
        radius: 8,
        children: [{ type: "text", text: c.newWs, x: 18, y: 9, width: 140, height: "hug", fontSize: 13, fontWeight: 600, color: "#ffffff" }],
      },
      card("Landing", "12 nodes · now", 24, 160),
      card("Icons", "8 nodes · yesterday", 260, 160),
      {
        type: "frame",
        name: "chrome",
        x: 24,
        y: 300,
        width: 672,
        height: 96,
        fill: mode === "dark" ? "#1c2230" : "#ffffff",
        radius: 10,
        stroke: { color: mode === "dark" ? "#2a3344" : "#e5e0d8", width: 1 },
        children: [
          { type: "text", text: c.pages, x: 16, y: 12, width: 80, height: "hug", fontSize: 11, fontWeight: 700, color: mode === "dark" ? "#9aa3b5" : "#6a7380" },
          { type: "text", text: c.page1, x: 16, y: 34, width: 100, height: "hug", fontSize: 13, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
          { type: "text", text: c.layers, x: 140, y: 12, width: 80, height: "hug", fontSize: 11, fontWeight: 700, color: mode === "dark" ? "#9aa3b5" : "#6a7380" },
          { type: "text", text: c.tools, x: 260, y: 30, width: 260, height: "hug", fontSize: 13, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
          { type: "text", text: c.zoom, x: 540, y: 30, width: 120, height: "hug", fontSize: 12, color: mode === "dark" ? "#9aa3b5" : "#5c6570" },
        ],
      },
    ],
  };
}

function switchScreen(c, mode, x, y) {
  return {
    type: "frame",
    name: c.switchTitle,
    x,
    y,
    width: 480,
    height: 220,
    fill: mode === "dark" ? "#141827" : "#f7f4ef",
    mode,
    children: [
      { type: "text", text: c.switchTitle, x: 24, y: 24, width: 420, height: "hug", fontSize: 18, fontWeight: 650, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" },
      { type: "text", text: c.switchLead, x: 24, y: 64, width: 420, height: "hug", fontSize: 13, color: mode === "dark" ? "#9aa3b5" : "#5c6570" },
      {
        type: "frame",
        name: "select",
        x: 24,
        y: 120,
        width: 160,
        height: 36,
        fill: mode === "dark" ? "#1c2230" : "#ffffff",
        radius: 8,
        stroke: { color: mode === "dark" ? "#2a3344" : "#d8d2c8", width: 1 },
        children: [{ type: "text", text: c.language + " ▾", x: 12, y: 9, width: 130, height: "hug", fontSize: 13, color: mode === "dark" ? "#f4f0ea" : "#1a1a1a" }],
      },
    ],
  };
}

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "pap-b-052", version: "0.1.0" },
});
{
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "pap-b-052/1",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(URL_, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}

const ws = await call("list_workspaces", {});
const list = ws.workspaces ?? ws;
const existing = (Array.isArray(list) ? list : []).find((w) => /PAP-B-052|i18n/i.test(w.name ?? ""));
if (existing) await call("open_workspace", { id: existing.id });
else {
  const created = await call("create_workspace", { name: "PAP-B-052 i18n" });
  const id = created.workspace?.id ?? created.id;
  await call("open_workspace", { id });
}

const page = await call("create_page", { name: "PAP-B-052" });
const pageId = page.page ?? page.created?.[page.created.length - 1];

const nodes = [
  screen(copy.en, "dark", 0, 0),
  screen(copy.pt, "dark", 760, 0),
  screen(copy.en, "light", 0, 460),
  screen(copy.pt, "light", 760, 460),
  switchScreen(copy.en, "dark", 0, 920),
  switchScreen(copy.pt, "dark", 520, 920),
];

const created = await call("create_nodes", { parentId: pageId, nodes });
const ids = created.created ?? [];
console.log("created", ids.length, "roots on", pageId);

const shots = [
  ["01-overview-en-dark.png", ids[0]],
  ["02-overview-pt-dark.png", ids[1]],
  ["03-overview-en-light.png", ids[2]],
  ["04-overview-pt-light.png", ids[3]],
  ["05-switch-en-dark.png", ids[4]],
  ["06-switch-pt-dark.png", ids[5]],
];

for (const [file, rootId] of shots) {
  if (!rootId) continue;
  const r = await rpc("tools/call", { name: "render_screenshot", arguments: { rootId, scale: 1 } });
  const img = (r.content ?? []).find((c) => c.type === "image");
  if (!img?.data) {
    console.warn("no image for", file, r);
    continue;
  }
  writeFileSync(shotPath(OUT, file), pngFromBase64(img.data));
  console.log("wrote", file);
}

console.log("done", OUT);
