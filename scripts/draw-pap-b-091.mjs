#!/usr/bin/env node
// Design boards for PAP-B-091. Talks to the local Paprika MCP. Does not call open_workspace.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/assets/boards/PAP-B-091");
const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";

const sdkPkg = [
  join(root, "packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
  join(root, "../paprika/packages/e2e/node_modules/@modelcontextprotocol/sdk/package.json"),
].find((p) => existsSync(p));
if (!sdkPkg) throw new Error("MCP SDK not installed (packages/e2e)");
const require = createRequire(sdkPkg);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "pap-b-091-design", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  return r;
}

function textOf(r) {
  return (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

function corners(x, y, w, h, rot) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ].map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return { x: +(cx + dx * cos - dy * sin).toFixed(2), y: +(cy + dx * sin + dy * cos).toFixed(2) };
  });
}

const wsRaw = textOf(await call("list_workspaces"));
const parsed = JSON.parse(wsRaw);
const list = parsed.workspaces ?? parsed;
const ui = list.find((w) => w.name === "Paprica · UI");
if (!ui) throw new Error(`workspace Paprica · UI not found: ${list.map((w) => w.name).join(" | ")}`);
const workspaceId = ui.id;
console.log("workspace", workspaceId, ui.name);

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 1 }));
const blocks = outline.split(/\n(?=page#)/);
const pageBlock = blocks.find((b) => /^page#[^\s]+ "Interfaces"/.test(b));
if (!pageBlock) throw new Error(`Interfaces page not in outline:\n${outline.slice(0, 500)}`);
const pageId = (pageBlock.match(/^page#([A-Za-z0-9]+)/) ?? [])[1];
const ys = [...pageBlock.matchAll(/@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const heights = [...pageBlock.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@/g)].map((m) => Number(m[2]));
const maxBottom = ys.reduce((m, y, i) => Math.max(m, y + (heights[i] ?? 0)), 0);
const Y = Math.ceil((maxBottom + 160) / 40) * 40;
console.log("page", pageId, "y", Y, "maxBottom", maxBottom);

const themes = {
  light: {
    bg: "#f4f1ec",
    card: "#ffffff",
    shape: "#e7d7c3",
    stroke: "#1e2336",
    select: "#0b7183",
    ink: "#141827",
    muted: "#5d6478",
    badge: "#0b7183",
    badgeInk: "#ffffff",
    aabb: "#c8401f",
  },
  dark: {
    bg: "#1e2336",
    card: "#272d45",
    shape: "#3a415c",
    stroke: "#eef0f7",
    select: "#4cc7d8",
    ink: "#eef0f7",
    muted: "#a6acc4",
    badge: "#4cc7d8",
    badgeInk: "#0d1220",
    aabb: "#ff8b7a",
  },
};

function handle(id, x, y, t) {
  return {
    type: "rect",
    id,
    x: +(x - 5).toFixed(2),
    y: +(y - 5).toFixed(2),
    width: 10,
    height: 10,
    fill: "#ffffff",
    stroke: { color: t.select, width: 1.5 },
    radius: 1,
    lintIgnore: ["detached-sibling"],
  };
}

function board(id, name, x, y, theme, mode) {
  const t = themes[theme];
  const ox = 150;
  const oy = 108;
  const w = 200;
  const h = 110;
  const rot = 28;
  const c = corners(ox, oy, w, h, rot);
  const [tl, tr, br, bl] = c;
  const mid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const rad = (rot * Math.PI) / 180;
  const knob = { x: +(mid.x + Math.sin(rad) * 28).toFixed(2), y: +(mid.y - Math.cos(rad) * 28).toFixed(2) };
  const children = [
    {
      type: "text",
      id: `${id}-kicker`,
      x: 20,
      y: 16,
      width: 440,
      height: 16,
      text: mode === "after" ? "Seleção segue a caixa rotacionada" : "Hoje a seleção usa a caixa alinhada",
      color: t.muted,
      fontSize: 12,
      fontFamily: "sans-serif",
    },
    {
      type: "rect",
      id: `${id}-shape`,
      x: ox,
      y: oy,
      width: w,
      height: h,
      rotation: rot,
      fill: t.shape,
      stroke: { color: t.stroke, width: 1 },
      radius: 8,
    },
  ];
  if (mode === "before") {
    const minX = Math.min(...c.map((p) => p.x));
    const minY = Math.min(...c.map((p) => p.y));
    const maxX = Math.max(...c.map((p) => p.x));
    const maxY = Math.max(...c.map((p) => p.y));
    children.push(
      {
        type: "rect",
        id: `${id}-aabb`,
        x: minX,
        y: minY,
        width: +(maxX - minX).toFixed(2),
        height: +(maxY - minY).toFixed(2),
        fill: "transparent",
        stroke: { color: t.aabb, width: 1.5 },
      },
      handle(`${id}-hse`, maxX, maxY, { ...t, select: t.aabb }),
    );
  } else {
    children.push(
      {
        type: "rect",
        id: `${id}-outline`,
        x: ox,
        y: oy,
        width: w,
        height: h,
        rotation: rot,
        fill: "transparent",
        stroke: { color: t.select, width: 1.5 },
        radius: 8,
      },
      {
        type: "path",
        id: `${id}-stem`,
        x: 0,
        y: 0,
        d: `M ${mid.x} ${mid.y} L ${knob.x} ${knob.y}`,
        stroke: { color: t.select, width: 1.5 },
      },
      {
        type: "ellipse",
        id: `${id}-knob`,
        x: +(knob.x - 6).toFixed(2),
        y: +(knob.y - 6).toFixed(2),
        width: 12,
        height: 12,
        fill: "#ffffff",
        stroke: { color: t.select, width: 1.5 },
      },
      handle(`${id}-hnw`, tl.x, tl.y, t),
      handle(`${id}-hne`, tr.x, tr.y, t),
      handle(`${id}-hse`, br.x, br.y, t),
      handle(`${id}-hsw`, bl.x, bl.y, t),
      {
        type: "rect",
        id: `${id}-badge`,
        x: ox + 52,
        y: oy + h + 34,
        width: 96,
        height: 20,
        fill: t.badge,
        radius: 3,
      },
      {
        type: "text",
        id: `${id}-size`,
        x: ox + 52,
        y: oy + h + 36,
        width: 96,
        height: 16,
        text: "200 × 110",
        color: t.badgeInk,
        fontSize: 11,
        fontFamily: "sans-serif",
        textAlign: "center",
        lintIgnore: ["contrast"],
      },
    );
  }
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 480,
    height: 340,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children,
  };
}

const nodes = [
  board("b091-before-light", "PAP-B-091 · antes · claro", 40, Y, "light", "before"),
  board("b091-after-light", "PAP-B-091 · depois · claro", 560, Y, "light", "after"),
  board("b091-before-dark", "PAP-B-091 · antes · escuro", 40, Y + 380, "dark", "before"),
  board("b091-after-dark", "PAP-B-091 · depois · escuro", 560, Y + 380, "dark", "after"),
];

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-091 rotation handles",
  nodes,
});

await mkdir(outDir, { recursive: true });
const shots = [
  ["b091-before-light", "antes-claro.png"],
  ["b091-after-light", "depois-claro.png"],
  ["b091-before-dark", "antes-escuro.png"],
  ["b091-after-dark", "depois-escuro.png"],
];
for (const [rootId, file] of shots) {
  const r = await call("render_screenshot", { workspaceId, rootId, scale: 2 });
  const img = (r.content ?? []).find((c) => c.type === "image");
  const b64 = img?.data;
  if (!b64) {
    console.error("no image", rootId, textOf(r).slice(0, 300));
    continue;
  }
  await writeFile(join(outDir, file), Buffer.from(b64, "base64"));
  console.log("wrote", file);
}

const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" });
console.log(textOf(lint).slice(0, 1200));
await client.close();
