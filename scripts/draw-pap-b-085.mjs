// Design-first boards for PAP-B-085 (rich text runs). Local Paprika MCP.
// Addresses the workspace by id. Does not call open_workspace.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pngFromBase64, shotPath } from "./design-board.mjs";

const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../docs/assets/boards/PAP-B-085");
mkdirSync(OUT, { recursive: true });
let rpcId = 0;
let sessionId = "";

async function rpc(method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "pap-b-085/1",
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
    return { json: JSON.parse(text), text, raw: r };
  } catch {
    return { json: null, text, raw: r };
  }
}

await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "pap-b-085", version: "0.1.0" },
});
{
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "user-agent": "pap-b-085/1",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(URL_, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
}

const ws = await call("list_workspaces", {});
const list = ws.json?.workspaces ?? ws.json ?? [];
const ui = (Array.isArray(list) ? list : []).find((w) => w.name === "Paprica · UI");
if (!ui?.id) throw new Error(`workspace Paprica · UI not found: ${ws.text.slice(0, 500)}`);
const workspaceId = ui.id;
console.log("workspace", workspaceId, ui.name);

const outline = (await call("get_document_outline", { workspaceId, depth: 2 })).text;
const pageIds = [...outline.matchAll(/page#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
let pageId = pageIds.find((id) => id === "interfaces") ?? pageIds[0];
if (!pageId) throw new Error("no page in outline");
const pageOutline = (await call("get_document_outline", { workspaceId, rootId: pageId, depth: 1 })).text;
const bottoms = [];
for (const m of pageOutline.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
  bottoms.push(Number(m[4]) + Number(m[2]));
}
const y = bottoms.length ? Math.ceil((Math.max(...bottoms) + 160) / 40) * 40 : 4000;
console.log("page", pageId, "y", y, "bottoms", bottoms.length);

const ink = "#1e2336";
const muted = "#5c6570";
const paper = "#f7f4ef";
const card = "#ffffff";
const line = "#e5e0d8";
const brand = "#c43d27";
const select = "#0b7183";

function t(text, x, y, extra) {
  return {
    type: "text",
    text,
    x,
    y,
    width: extra.width ?? 200,
    height: "hug",
    color: extra.color ?? ink,
    fontSize: extra.fontSize ?? 14,
    fontWeight: extra.fontWeight ?? 400,
    fontFamily: extra.fontFamily,
  };
}

function painted() {
  return {
    type: "frame",
    id: "b085-painted",
    name: "Texto com runs",
    x: 0,
    y,
    width: 560,
    height: 240,
    fill: paper,
    radius: 12,
    children: [
      t("Texto com runs", 24, 18, { width: 400, fontSize: 13, fontWeight: 650, color: muted }),
      t("O plano ", 24, 78, { width: 92, fontSize: 22 }),
      t("Pro", 112, 78, { width: 52, fontSize: 22, fontWeight: 700, color: brand }),
      t(" custa ", 164, 82, { width: 78, fontSize: 18 }),
      t("R$ 40", 242, 70, { width: 92, fontSize: 32, fontWeight: 700 }),
      t(" por mês", 338, 82, { width: 110, fontSize: 18, fontFamily: "Georgia, serif" }),
      {
        type: "rect",
        x: 338,
        y: 108,
        width: 92,
        height: 1,
        fill: select,
      },
      t("peso · cor · tamanho · itálico · link", 24, 168, { width: 480, fontSize: 13, color: muted }),
    ],
  };
}

function editor() {
  const tool = (label, x, on) => ({
    type: "frame",
    name: label,
    x,
    y: 16,
    width: label.length > 2 ? 88 : 32,
    height: 32,
    fill: on ? "#e7f4f6" : card,
    radius: 6,
    stroke: { color: on ? select : line, width: 1 },
    children: [t(label, 8, 7, { width: label.length > 2 ? 72 : 20, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? select : ink })],
  });
  return {
    type: "frame",
    id: "b085-editor",
    name: "Editor no canvas",
    x: 600,
    y,
    width: 640,
    height: 280,
    fill: paper,
    radius: 12,
    children: [
      t("Editor no canvas", 24, 16, { width: 400, fontSize: 13, fontWeight: 650, color: muted }),
      {
        type: "frame",
        name: "barra",
        x: 24,
        y: 48,
        width: 592,
        height: 64,
        fill: card,
        radius: 8,
        stroke: { color: line, width: 1 },
        children: [
          tool("B", 12, true),
          tool("I", 52, false),
          {
            type: "frame",
            name: "tamanho",
            x: 96,
            y: 16,
            width: 72,
            height: 32,
            fill: card,
            radius: 6,
            stroke: { color: line, width: 1 },
            children: [t("22", 10, 7, { width: 40, fontSize: 13 })],
          },
          {
            type: "rect",
            x: 180,
            y: 22,
            width: 20,
            height: 20,
            fill: brand,
            radius: 4,
            stroke: { color: line, width: 1 },
          },
          {
            type: "frame",
            name: "link",
            x: 214,
            y: 16,
            width: 220,
            height: 32,
            fill: card,
            radius: 6,
            stroke: { color: line, width: 1 },
            children: [t("https://paprika.dev", 10, 7, { width: 200, fontSize: 12, color: select })],
          },
        ],
      },
      {
        type: "frame",
        name: "caixa",
        x: 24,
        y: 136,
        width: 520,
        height: 112,
        fill: card,
        radius: 8,
        stroke: { color: select, width: 1, style: "dashed" },
        children: [
          t("O plano ", 16, 36, { width: 92, fontSize: 22 }),
          {
            type: "frame",
            name: "seleção",
            x: 104,
            y: 32,
            width: 52,
            height: 32,
            fill: "#d7eef2",
            radius: 4,
            children: [t("Pro", 6, 4, { width: 42, fontSize: 22, fontWeight: 700, color: brand })],
          },
          t(" custa R$ 40", 164, 40, { width: 180, fontSize: 18 }),
        ],
      },
    ],
  };
}

function inspector() {
  return {
    type: "frame",
    id: "b085-inspector",
    name: "Inspector",
    x: 1280,
    y,
    width: 320,
    height: 280,
    fill: card,
    radius: 12,
    stroke: { color: line, width: 1 },
    children: [
      t("Conteúdo", 16, 16, { width: 280, fontSize: 12, fontWeight: 650, color: muted }),
      {
        type: "frame",
        name: "campo",
        x: 16,
        y: 44,
        width: 288,
        height: 88,
        fill: paper,
        radius: 8,
        stroke: { color: line, width: 1 },
        children: [t("O plano Pro custa R$ 40 por mês", 12, 12, { width: 260, fontSize: 13 })],
      },
      t("3 trechos · duplo clique no canvas", 16, 148, { width: 280, fontSize: 12, color: muted }),
      t("Peso 400", 16, 188, { width: 120, fontSize: 13 }),
      t("Tamanho 16", 150, 188, { width: 140, fontSize: 13 }),
      t("Cor #1e2336", 16, 220, { width: 200, fontSize: 13 }),
    ],
  };
}

const created = await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  nodes: [painted(), editor(), inspector()],
});
console.log(created.text.slice(0, 800));
const roots = created.json?.roots ?? [];
const ids = roots.map((r) => r.id);
if (ids.length < 3) throw new Error("expected 3 roots");

const shots = [
  ["01-texto-com-runs.png", ids[0]],
  ["02-editor-no-canvas.png", ids[1]],
  ["03-inspector.png", ids[2]],
];
for (const [file, rootId] of shots) {
  const r = await rpc("tools/call", {
    name: "render_screenshot",
    arguments: { workspaceId, rootId, scale: 2 },
  });
  const img = (r.content ?? []).find((c) => c.type === "image");
  if (!img?.data) throw new Error(`no image for ${file}: ${JSON.stringify(r).slice(0, 400)}`);
  writeFileSync(shotPath(OUT, file), pngFromBase64(img.data));
  console.log("wrote", file, rootId);
}
console.log("done", OUT);
