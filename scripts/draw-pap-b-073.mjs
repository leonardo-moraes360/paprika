#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/assets/boards/PAP-B-073");
const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
const sdkRoot = process.env.PAPRIKA_SDK ?? "/home/leonardo/workspace/pessoal/paprika/packages/e2e/package.json";

const require = createRequire(sdkRoot);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "pap-b-073-design", version: "0" });
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
let workspaces;
try {
  workspaces = JSON.parse(wsRaw);
} catch {
  const m = wsRaw.match(/\{[\s\S]*\}/);
  workspaces = m ? JSON.parse(m[0]) : { workspaces: [] };
}
const list = workspaces.workspaces ?? workspaces;
const ui = list.find((w) => w.name === "Paprica · UI");
if (!ui?.id) throw new Error(`workspace Paprica · UI not found: ${list.map((w) => w.name).join(", ")}`);
const workspaceId = ui.id;
console.log("workspace", workspaceId, ui.name);

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 2 }));
const pageLine = outline.split("\n").find((line) => /page#interfaces\b/.test(line))
  ?? outline.split("\n").find((line) => /page#/.test(line) && /interface/i.test(line));
const pageId = (pageLine?.match(/page#([A-Za-z0-9_-]+)/) ?? [])[1];
if (!pageId) throw new Error(`Interfaces page not found\n${outline.slice(0, 1500)}`);
console.log("page", pageId, pageLine);

const pageOutline = textOf(await call("get_document_outline", { workspaceId, rootId: pageId, depth: 1 }));
const bottoms = [...pageOutline.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[3]) + Number(m[2]));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Math.ceil((maxBottom + 160) / 40) * 40;
console.log("placing at y=", Y, "maxBottom=", maxBottom);

const night = { bg: "#1e2336", panel: "#272d45", fg: "#eef0f7", muted: "#c5cadb", line: "#3a4260", canvas: "#141827", card: "#e7e9f0", ink: "#141827" };
const day = { bg: "#f2f3f8", panel: "#ffffff", fg: "#141827", muted: "#5d6478", line: "#d3d7e3", canvas: "#e7e9f0", card: "#ffffff", ink: "#141827" };
const blue = "#3b82f6";
const green = "#10b981";
const amber = "#f59e0b";
const pink = "#ec4899";

function text(id, value, x, y, color, extra = {}) {
  return {
    type: "text",
    id,
    text: value,
    x,
    y,
    width: extra.width ?? 200,
    height: "hug",
    color,
    textAlign: extra.align ?? "left",
    fontSize: extra.fontSize ?? 13,
    fontWeight: extra.fontWeight ?? 400,
    fontFamily: "Inter, system-ui, sans-serif",
  };
}

function dot(id, x, y, color) {
  return { type: "ellipse", id, x, y, width: 8, height: 8, fill: color };
}

function pageRow(id, theme, y, name, colors) {
  const t = theme;
  return {
    type: "frame",
    id,
    x: 12,
    y,
    width: 176,
    height: 28,
    fill: colors.length ? "#3a426033" : "transparent",
    radius: 6,
    children: [
      text(`${id}-n`, name, 8, 6, t.fg, { width: 120, fontSize: 13, fontWeight: 600 }),
      ...colors.map((c, i) => dot(`${id}-d${i}`, 148 + i * 12, 10, c)),
    ],
  };
}

function agentRow(id, theme, y, name, verb, color, faded) {
  const t = theme;
  return {
    type: "frame",
    id,
    x: 12,
    y,
    width: 236,
    height: 28,
    fill: "transparent",
    opacity: faded ? 0.45 : 1,
    children: [
      dot(`${id}-d`, 0, 10, color),
      text(`${id}-n`, name, 16, 6, t.fg, { width: 140, fontSize: 13, fontWeight: 600 }),
      text(`${id}-v`, verb, 150, 6, t.muted, { width: 80, fontSize: 12 }),
    ],
  };
}

function board(id, theme, title, expanded) {
  const t = theme === "light" ? day : night;
  const pages = [
    pageRow(`${id}-p1`, t, 40, "Página 1", [blue]),
    pageRow(`${id}-p2`, t, 72, "Página 2", [green, amber]),
    pageRow(`${id}-p3`, t, 104, "Capa", []),
  ];
  const pill = {
    type: "frame",
    id: `${id}-pill`,
    name: "3 ativos",
    x: 470,
    y: 64,
    width: expanded ? 168 : 148,
    height: 32,
    fill: t.panel,
    stroke: { color: t.line, width: 1 },
    radius: 16,
    children: [
      text(`${id}-pill-t`, "3 ativos", 12, 8, t.fg, { width: 70, fontSize: 13, fontWeight: 600 }),
      dot(`${id}-pill-a`, 88, 12, blue),
      dot(`${id}-pill-b`, 102, 12, green),
      dot(`${id}-pill-c`, 116, 12, amber),
    ],
  };
  const expandedPanel = expanded
    ? {
        type: "frame",
        id: `${id}-pop`,
        name: "Ativos e ociosos",
        x: 388,
        y: 104,
        width: 260,
        height: 248,
        fill: t.panel,
        stroke: { color: t.line, width: 1 },
        radius: 12,
        children: [
          text(`${id}-h1`, "Ativos", 12, 10, t.muted, { width: 80, fontSize: 12, fontWeight: 700 }),
          text(`${id}-g1`, "cursor-composer ×2", 12, 32, t.fg, { width: 200, fontSize: 12, fontWeight: 600 }),
          text(`${id}-w`, "Escrevendo", 12, 54, t.muted, { width: 100, fontSize: 12 }),
          agentRow(`${id}-r1`, t, 72, "cursor-composer", "escrevendo", blue, false),
          text(`${id}-rd`, "Lendo", 12, 108, t.muted, { width: 80, fontSize: 12 }),
          agentRow(`${id}-r2`, t, 126, "cursor-composer 2", "lendo", green, false),
          agentRow(`${id}-r3`, t, 158, "outro", "escrevendo", amber, false),
          text(`${id}-h2`, "Ociosos", 12, 196, t.muted, { width: 80, fontSize: 12, fontWeight: 700 }),
          agentRow(`${id}-r4`, t, 214, "cursor-composer 3", "lendo", pink, true),
        ],
      }
    : null;
  return {
    type: "frame",
    id,
    name: title,
    width: 960,
    height: 620,
    fill: t.bg,
    radius: 16,
    clip: true,
    children: [
      text(`${id}-title`, title, 24, 18, t.fg, { width: 700, fontSize: 18, fontWeight: 700 }),
      text(`${id}-sub`, "A pílula fica no canto do canvas, abaixo da toolbar e fora dos painéis.", 24, 46, t.muted, { width: 860, fontSize: 13 }),
      {
        type: "frame",
        id: `${id}-side`,
        name: "Páginas",
        x: 24,
        y: 84,
        width: 200,
        height: 508,
        fill: t.panel,
        stroke: { color: t.line, width: 1 },
        radius: 12,
        children: [text(`${id}-side-h`, "Páginas", 12, 12, t.muted, { width: 160, fontSize: 12, fontWeight: 700 }), ...pages],
      },
      {
        type: "frame",
        id: `${id}-canvas`,
        name: "Canvas",
        x: 240,
        y: 84,
        width: 696,
        height: 508,
        fill: t.canvas,
        stroke: { color: t.line, width: 1 },
        radius: 12,
        children: [
          {
            type: "frame",
            id: `${id}-bar`,
            name: "Toolbar",
            x: 220,
            y: 12,
            width: 256,
            height: 40,
            fill: t.panel,
            stroke: { color: t.line, width: 1 },
            radius: 12,
            children: [text(`${id}-bar-t`, "Toolbar no topo", 16, 12, t.muted, { width: 220, fontSize: 13, align: "center" })],
          },
          {
            type: "frame",
            id: `${id}-frame`,
            name: "Tela",
            x: 36,
            y: 96,
            width: 280,
            height: 340,
            fill: theme === "light" ? "#ffffff" : t.card,
            stroke: { color: blue, width: 2 },
            radius: 10,
            children: [text(`${id}-frame-n`, "Tela em edição", 16, 16, t.ink, { width: 240, fontSize: 14, fontWeight: 600 })],
          },
          {
            type: "rect",
            id: `${id}-workbg`,
            x: 36,
            y: 64,
            width: 92,
            height: 22,
            fill: blue,
            radius: 6,
          },
          text(`${id}-work`, "escrevendo", 44, 68, "#ffffff", { width: 76, fontSize: 12, fontWeight: 600 }),
          pill,
          ...(expandedPanel ? [expandedPanel] : []),
        ],
      },
    ],
  };
}

const dark = board("b073dark", "dark", "Roster condensado · escuro", true);
const light = board("b073light", "light", "Roster condensado · claro", false);
dark.x = 0;
dark.y = Y;
light.x = 0;
light.y = Y + 680;

await mkdir(outDir, { recursive: true });
const created = await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  place: "none",
  label: "roster condensado",
  batch: "pap-b-073-design",
  nodes: [dark, light],
});
console.log(textOf(created).slice(0, 500));

for (const [id, file] of [["b073dark", "escuro.png"], ["b073light", "claro.png"]]) {
  const shot = await call("render_screenshot", { workspaceId, rootId: id, scale: 2 });
  const image = (shot.content ?? []).find((c) => c.type === "image");
  if (!image?.data) throw new Error(`no image for ${id}: ${textOf(shot).slice(0, 300)}`);
  const dest = join(outDir, file);
  await writeFile(dest, Buffer.from(image.data, "base64"));
  console.log("wrote", dest, textOf(shot).slice(0, 180));
}

for (const id of ["b073dark", "b073light"]) {
  const lint = textOf(await call("lint_design", { workspaceId, rootId: id }));
  console.log("lint", id, lint.slice(0, 800));
}

await client.close();
