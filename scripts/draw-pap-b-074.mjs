#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/assets/boards/PAP-B-074");
const mcpUrl = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
const sdkRoot = process.env.PAPRIKA_SDK ?? "/home/leonardo/workspace/pessoal/paprika/packages/e2e/package.json";

const require = createRequire(sdkRoot);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const client = new Client({ name: "pap-b-074-design", version: "0" });
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

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 2 }));
const pageLine = outline.split("\n").find((line) => /page#interfaces\b/.test(line))
  ?? outline.split("\n").find((line) => /page#/.test(line) && /interface/i.test(line));
const pageId = (pageLine?.match(/page#([A-Za-z0-9_-]+)/) ?? [])[1];
if (!pageId) throw new Error(`Interfaces page not found\n${outline.slice(0, 1500)}`);

const pageOutline = textOf(await call("get_document_outline", { workspaceId, rootId: pageId, depth: 1 }));
const bottoms = [...pageOutline.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[3]) + Number(m[2]));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Math.ceil((maxBottom + 160) / 40) * 40;
console.log("workspace", workspaceId, "page", pageId, "y", Y);

const night = { bg: "#1e2336", panel: "#272d45", fg: "#eef0f7", muted: "#c5cadb", line: "#3a4260", canvas: "#141827", card: "#e7e9f0", ink: "#141827" };
const day = { bg: "#f2f3f8", panel: "#ffffff", fg: "#141827", muted: "#5d6478", line: "#d3d7e3", canvas: "#e7e9f0", card: "#ffffff", ink: "#141827" };
const blue = "#3b82f6";
const inkOnBlue = "#141827";

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
    fontFamily: extra.fontFamily ?? "Inter, system-ui, sans-serif",
  };
}

function board(id, theme, title, codeOpen) {
  const t = theme === "light" ? day : night;
  const screenFill = theme === "light" ? "#ffffff" : "#e7e9f0";
  const code = codeOpen
    ? {
        type: "frame",
        id: `${id}-code`,
        name: "Código",
        x: 16,
        y: 72,
        width: 220,
        height: 360,
        fill: theme === "light" ? "#141827cc" : "#0d1020cc",
        stroke: { color: t.line, width: 1 },
        radius: 12,
        children: [
          text(`${id}-c1`, "export function Tela() {", 12, 16, "#d6dbef", { width: 196, fontSize: 12, fontFamily: "ui-monospace, monospace" }),
          text(`${id}-c2`, "return (", 12, 40, "#d6dbef", { width: 196, fontSize: 12, fontFamily: "ui-monospace, monospace" }),
          text(`${id}-c3`, "<div>", 24, 64, "#9eb6ff", { width: 180, fontSize: 12, fontFamily: "ui-monospace, monospace" }),
          text(`${id}-c4`, "Playlist", 36, 88, "#eef0f7", { width: 160, fontSize: 12, fontFamily: "ui-monospace, monospace" }),
          text(`${id}-c5`, "</div>", 24, 112, "#9eb6ff", { width: 180, fontSize: 12, fontFamily: "ui-monospace, monospace" }),
        ],
      }
    : null;
  return {
    type: "frame",
    id,
    name: title,
    width: 960,
    height: 560,
    fill: t.bg,
    radius: 16,
    clip: true,
    children: [
      text(`${id}-title`, title, 24, 18, t.fg, { width: 800, fontSize: 18, fontWeight: 700 }),
      text(`${id}-sub`, "O rótulo fica sobre o frame. O contorno passa de um nó ao seguinte. O código nasce desligado.", 24, 46, t.muted, { width: 880, fontSize: 13 }),
      {
        type: "frame",
        id: `${id}-canvas`,
        name: "Canvas",
        x: 24,
        y: 84,
        width: 912,
        height: 448,
        fill: t.canvas,
        stroke: { color: t.line, width: 1 },
        radius: 12,
        children: [
          {
            type: "frame",
            id: `${id}-toggle`,
            name: "Código",
            x: 16,
            y: 16,
            width: codeOpen ? 220 : 88,
            height: 32,
            fill: codeOpen ? blue : t.panel,
            stroke: { color: codeOpen ? blue : t.line, width: 1 },
            radius: 8,
            children: [
              text(`${id}-toggle-t`, codeOpen ? "Ocultar código" : "Código", 12, 8, codeOpen ? inkOnBlue : t.fg, { width: codeOpen ? 196 : 64, fontSize: 13, fontWeight: 600 }),
            ],
          },
          ...(code ? [code] : []),
          {
            type: "frame",
            id: `${id}-badge`,
            name: "trabalhando",
            x: 360,
            y: 56,
            width: 118,
            height: 24,
            fill: blue,
            radius: 6,
            children: [
              text(`${id}-badge-t`, "trabalhando", 10, 4, inkOnBlue, { width: 98, fontSize: 12, fontWeight: 600 }),
            ],
          },
          {
            type: "frame",
            id: `${id}-screen`,
            name: "Tela",
            x: 340,
            y: 88,
            width: 280,
            height: 320,
            fill: screenFill,
            stroke: { color: blue, width: 2 },
            radius: 12,
            children: [
              {
                type: "rect",
                id: `${id}-done`,
                x: 16,
                y: 16,
                width: 248,
                height: 36,
                fill: theme === "light" ? "#e7e9f0" : "#c5cadb",
                radius: 6,
              },
              text(`${id}-done-t`, "Playlist", 28, 24, t.ink, { width: 200, fontSize: 14, fontWeight: 600 }),
              {
                type: "rect",
                id: `${id}-now`,
                x: 16,
                y: 68,
                width: 248,
                height: 48,
                fill: "transparent",
                stroke: { color: blue, width: 1.5 },
                radius: 6,
              },
              {
                type: "rect",
                id: `${id}-next`,
                x: 16,
                y: 132,
                width: 248,
                height: 28,
                fill: theme === "light" ? "#f2f3f8" : "#2a3148",
                radius: 6,
                opacity: 0.35,
              },
            ],
          },
          {
            type: "frame",
            id: `${id}-cursor`,
            name: "Cursor",
            x: 560,
            y: 300,
            width: 148,
            height: 28,
            fill: blue,
            radius: 6,
            children: [
              text(`${id}-cursor-t`, "e2e-agent criando", 8, 6, inkOnBlue, { width: 132, fontSize: 12, fontWeight: 600 }),
            ],
          },
        ],
      },
    ],
  };
}

const dark = board("b074dark", "dark", "Construção ao vivo · escuro", false);
const light = board("b074light", "light", "Construção ao vivo · claro", true);
dark.x = 0;
dark.y = Y;
light.x = 0;
light.y = Y + 620;

await mkdir(outDir, { recursive: true });
const created = await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  place: "none",
  label: "construção ao vivo",
  batch: "pap-b-074-design",
  nodes: [dark, light],
});
console.log(textOf(created).slice(0, 400));

for (const [id, file] of [["b074dark", "escuro.png"], ["b074light", "claro.png"]]) {
  const shot = await call("render_screenshot", { workspaceId, rootId: id, scale: 2 });
  const image = (shot.content ?? []).find((c) => c.type === "image");
  if (!image?.data) throw new Error(`no image for ${id}: ${textOf(shot).slice(0, 300)}`);
  const dest = join(outDir, file);
  await writeFile(dest, Buffer.from(image.data, "base64"));
  console.log("wrote", dest);
}

for (const id of ["b074dark", "b074light"]) {
  const lint = textOf(await call("lint_design", { workspaceId, rootId: id }));
  console.log("lint", id, lint.slice(0, 900));
}

await client.close();
