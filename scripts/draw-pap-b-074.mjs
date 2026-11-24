#!/usr/bin/env node
import { join } from "node:path";
import { connectBoard, saveShots, textOf } from "./design-board.mjs";

const sdkRoot = process.env.PAPRIKA_SDK ?? "/home/leonardo/workspace/pessoal/paprika/packages/e2e/package.json";
const { root, client, call } = await connectBoard("pap-b-074-design", sdkRoot);
const outDir = join(root, "docs/assets/boards/PAP-B-074");

const night = { bg: "#1e2336", panel: "#272d45", fg: "#eef0f7", muted: "#c5cadb", line: "#3a4260", canvas: "#141827", card: "#e7e9f0", ink: "#141827" };
const day = { bg: "#f2f3f8", panel: "#ffffff", fg: "#141827", muted: "#5d6478", line: "#d3d7e3", canvas: "#e7e9f0", card: "#ffffff", ink: "#141827" };
const blue = "#3b82f6";
const inkOnBlue = "#141827";

function text(id, value, x, y, color, extra = {}) {
  const font = extra.fontFamily ?? "Inter, system-ui, sans-serif";
  const weight = extra.fontWeight ?? 400;
  const size = extra.fontSize ?? 13;
  const align = extra.align ?? "left";
  const width = extra.width ?? 200;
  return { type: "text", id, text: value, x, y, width, height: "hug", color, textAlign: align, fontSize: size, fontWeight: weight, fontFamily: font };
}

function shell(id, title, fill, height, children) {
  return { clip: true, radius: 16, fill, height, width: 960, name: title, id, type: "frame", children };
}

const rawList = textOf(await call("list_workspaces"));
const parsedList = JSON.parse(rawList.slice(rawList.indexOf("{"), rawList.lastIndexOf("}") + 1));
const workspaces = parsedList.workspaces ?? parsedList;
const ui = workspaces.find((item) => item.name === "Paprica · UI");
if (!ui?.id) throw new Error(`workspace Paprica · UI not found: ${workspaces.map((item) => item.name).join(", ")}`);
const workspaceId = ui.id;
const outline = textOf(await call("get_document_outline", { workspaceId, depth: 2 }));
const pageId = (outline.match(/page#(interfaces)\b/) ?? outline.match(/page#([A-Za-z0-9_-]+)[^\n]*interface/i) ?? [])[1];
if (!pageId) throw new Error(`Interfaces page not found\n${outline.slice(0, 1500)}`);
const placed = textOf(await call("get_document_outline", { workspaceId, rootId: pageId, depth: 1 }));
const lowest = [...placed.matchAll(/×(\d+(?:\.\d+)?)[^\n]*?,(-?\d+(?:\.\d+)?)/g)].reduce((max, hit) => Math.max(max, Number(hit[1]) + Number(hit[2])), 0);
const Y = Math.ceil((lowest + 160) / 40) * 40;
console.log("workspace", workspaceId, "page", pageId, "y", Y);

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
  return shell(id, title, t.bg, 560, [
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
    ]);
}

const dark = board("b074dark", "dark", "Construção ao vivo · escuro", false);
const light = board("b074light", "light", "Construção ao vivo · claro", true);
dark.x = 0;
dark.y = Y;
light.x = 0;
light.y = Y + 620;

const created = await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  place: "none",
  label: "construção ao vivo",
  batch: "pap-b-074-design",
  nodes: [dark, light],
});
console.log(textOf(created).slice(0, 400));

await saveShots(call, workspaceId, outDir, [["b074dark", "escuro.png"], ["b074light", "claro.png"]]);

for (const id of ["b074dark", "b074light"]) {
  const lint = textOf(await call("lint_design", { workspaceId, rootId: id }));
  console.log("lint", id, lint.slice(0, 900));
}

await client.close();
