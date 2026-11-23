#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/assets/boards/PAP-B-087");
const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";

const require = createRequire(join(root, "packages/e2e/package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "pap-b-087-design", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  return r;
}

function textOf(r) {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

const wsRaw = textOf(await call("list_workspaces"));
let parsed;
try {
  parsed = JSON.parse(wsRaw);
} catch {
  parsed = {};
}
const list = parsed.workspaces ?? parsed;
const ui = (Array.isArray(list) ? list : []).find((w) => w.name === "Paprica · UI");
if (!ui?.id) throw new Error(`workspace Paprica · UI not found in ${wsRaw.slice(0, 500)}`);
const workspaceId = ui.id;
console.log("workspace", workspaceId, ui.name);

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 1 }));
const pageId = (outline.match(/page#(interfaces)\b/) ?? outline.match(/page#([^\s"]+)/) ?? [])[1];
if (!pageId) throw new Error(`no page in outline:\n${outline.slice(0, 800)}`);
const ys = [...outline.matchAll(/@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const heights = [...outline.matchAll(/(\d{1,8}(?:\.\d{1,8})?)×(\d{1,8}(?:\.\d{1,8})?)\s+@/g)].map((m) => Number(m[2]));
const bottoms = ys.map((y, i) => y + (heights[i] ?? 0));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Math.ceil((maxBottom + 160) / 40) * 40;
console.log("page", pageId, "y", Y);

const light = {
  bg: "#f2f3f8",
  panel: "#ffffff",
  muted: "#e7e9f0",
  fg: "#141827",
  mutedFg: "#5d6478",
  border: "#d3d7e3",
  ring: "#0b7183",
  field: "#ffffff",
  accent: "#e7f6f8",
};

function label(id, text, x, y, w, color, size = 11) {
  return { type: "text", id, text, x, y, width: w, height: 16, fontSize: size, fontWeight: 600, color, textAlign: "left" };
}

function field(id, x, y, w, caption, value) {
  return {
    type: "frame",
    id,
    name: caption,
    x,
    y,
    width: w,
    height: 28,
    fill: light.field,
    stroke: { color: light.border, width: 1 },
    radius: 6,
    clip: true,
    layout: { mode: "row", gap: 8, padding: [6, 8, 6, 8], align: "center" },
    children: [
      { type: "text", id: `${id}-k`, text: caption, width: 72, height: 16, fontSize: 11, color: light.mutedFg },
      { type: "text", id: `${id}-v`, text: value, width: w - 96, height: 16, fontSize: 12, color: light.fg },
    ],
  };
}

const inspector = {
  type: "frame",
  id: "b087-inspector",
  name: "PAP-B-087 · inspetor raiz",
  x: 40,
  y: Y,
  width: 280,
  height: 360,
  fill: light.panel,
  stroke: { color: light.border, width: 1 },
  radius: 10,
  clip: true,
  children: [
    { type: "rect", id: "b087-insp-bar", x: 0, y: 0, width: 280, height: 36, fill: light.bg },
    label("b087-insp-title", "Frame raiz", 12, 10, 160, light.fg, 13),
    field("b087-href", 12, 52, 256, "Link", "/docs"),
    field("b087-min", 12, 88, 256, "Larg. mín.", "320"),
    field("b087-max", 12, 124, 256, "Larg. máx.", "960"),
    label("b087-insp-note", "O export vira <a> e a largura segue a janela.", 12, 168, 256, light.mutedFg, 11),
  ],
};

const image = {
  type: "frame",
  id: "b087-image",
  name: "PAP-B-087 · imagem",
  x: 360,
  y: Y,
  width: 280,
  height: 220,
  fill: light.panel,
  stroke: { color: light.border, width: 1 },
  radius: 10,
  clip: true,
  children: [
    { type: "rect", id: "b087-img-bar", x: 0, y: 0, width: 280, height: 36, fill: light.bg },
    label("b087-img-title", "Imagem", 12, 10, 160, light.fg, 13),
    field("b087-src", 12, 52, 256, "URL", "$mark"),
    {
      type: "frame",
      id: "b087-deco",
      x: 12,
      y: 88,
      width: 256,
      height: 28,
      fill: light.accent,
      radius: 6,
      clip: true,
      layout: { mode: "row", gap: 8, padding: [6, 8, 6, 8], align: "center" },
      children: [
        { type: "rect", id: "b087-deco-box", width: 14, height: 14, fill: light.ring, radius: 3 },
        { type: "text", id: "b087-deco-t", text: "Decorativa", width: 120, height: 16, fontSize: 12, color: light.fg },
      ],
    },
    label("b087-img-note", "Sem aviso de alt. O src aponta para um asset do documento.", 12, 132, 256, light.mutedFg, 11),
  ],
};

const menu = {
  type: "frame",
  id: "b087-menu",
  name: "PAP-B-087 · menu de contexto",
  x: 680,
  y: Y,
  width: 280,
  height: 220,
  fill: light.bg,
  radius: 10,
  clip: true,
  children: [
    { type: "rect", id: "b087-shape", name: "Retângulo", x: 24, y: 28, width: 88, height: 56, fill: "#d9d4cf", radius: 8, stroke: { color: light.ring, width: 2 } },
    {
      type: "frame",
      id: "b087-pop",
      name: "Menu",
      x: 96,
      y: 72,
      width: 168,
      height: 36,
      fill: light.panel,
      stroke: { color: light.border, width: 1 },
      radius: 8,
      shadow: { x: 0, y: 4, blur: 12, spread: 0, color: "#14182722" },
      clip: true,
      layout: { mode: "row", padding: [8, 10, 8, 10], align: "center" },
      children: [
        { type: "text", id: "b087-pop-t", text: "Converter em caminho", width: 148, height: 16, fontSize: 12, color: light.fg },
      ],
    },
  ],
};

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-087 web semantics boards",
  nodes: [inspector, image, menu],
});

await mkdir(outDir, { recursive: true });
const shots = [
  ["b087-inspector", "01-inspetor-raiz.png"],
  ["b087-image", "02-imagem.png"],
  ["b087-menu", "03-menu-contexto.png"],
];
for (const [rootId, file] of shots) {
  const r = await call("render_screenshot", { workspaceId, rootId, scale: 2 });
  const img = (r.content ?? []).find((c) => c.type === "image");
  const b64 = img?.data;
  if (!b64) throw new Error(`no image for ${rootId}: ${textOf(r).slice(0, 400)}`);
  await writeFile(join(outDir, file), Buffer.from(b64, "base64"));
  console.log("wrote", file);
}

const lint = textOf(await call("lint_design", { workspaceId, rootIds: ["b087-inspector", "b087-image", "b087-menu"] }));
console.log(lint.slice(0, 1200));
await client.close();
