#!/usr/bin/env node
import { join } from "node:path";
import { connectBoard, saveShots } from "./design-board.mjs";

const sdkRoot = process.env.PAPRIKA_SDK ?? "/home/leonardo/workspace/pessoal/paprika/packages/e2e/package.json";
const { root, call } = await connectBoard("pap-b-084-design", sdkRoot);
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-084");

function textOf(result) {
  const parts = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n");
}

const wsRaw = textOf(await call("list_workspaces"));
let workspaces;
try {
  workspaces = JSON.parse(wsRaw);
} catch {
  const start = wsRaw.indexOf("{");
  const end = wsRaw.lastIndexOf("}");
  workspaces = start >= 0 && end > start ? JSON.parse(wsRaw.slice(start, end + 1)) : { workspaces: [] };
}
const list = workspaces.workspaces ?? workspaces;
const ui = list.find((w) => w.name === "Paprica · UI") ?? list.find((w) => /paprica/i.test(w.name ?? "") && /ui/i.test(w.name ?? ""));
if (!ui?.id) throw new Error(`workspace Paprica · UI not found: ${list.map((w) => w.name).join(", ")}`);
const workspaceId = ui.id;
console.log("workspace", workspaceId, ui.name);

const outline = textOf(await call("get_document_outline", { workspaceId, depth: 2 }));
const pageLine = outline.split("\n").find((line) => /page#/.test(line) && /interface/i.test(line));
const pageId = (pageLine?.match(/page#([A-Za-z0-9_-]+)/) ?? [])[1];
if (!pageId) throw new Error(`Interfaces page not found\n${outline.slice(0, 1500)}`);
console.log("page", pageId, pageLine);

const pageOutline = textOf(await call("get_document_outline", { workspaceId, rootId: pageId, depth: 1 }));
const bottoms = [...pageOutline.matchAll(/(\d{1,8}(?:\.\d{1,8})?)×(\d{1,8}(?:\.\d{1,8})?)\s+@-?\d{1,8}(?:\.\d{1,8})?,\s*(-?\d{1,8}(?:\.\d{1,8})?)/g)].map((m) => Number(m[3]) + Number(m[2]));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Math.ceil((maxBottom + 160) / 40) * 40;
console.log("placing at y=", Y, "maxBottom=", maxBottom);

const night = {
  bg: "#1e2336",
  panel: "#272d45",
  fg: "#eef0f7",
  mutedFg: "#a6acc4",
  border: "#2c3350",
  active: "#c8401f",
  activeFg: "#ffffff",
  canvas: "#e7e9f0",
};
const light = {
  bg: "#f2f3f8",
  panel: "#ffffff",
  fg: "#141827",
  mutedFg: "#5d6478",
  border: "#d3d7e3",
  active: "#c8401f",
  activeFg: "#ffffff",
  canvas: "#e7e9f0",
};

function text(id, value, x, y, color, extra = {}) {
  return {
    type: "text",
    id,
    text: value,
    x,
    y,
    width: extra.width ?? 240,
    height: "hug",
    color,
    textAlign: extra.align ?? "left",
    fontSize: extra.fontSize ?? 12,
    fontWeight: extra.fontWeight ?? 400,
    fontFamily: "Inter, system-ui, sans-serif",
  };
}

function pills(id, theme, y, labels, active) {
  const t = theme === "light" ? light : night;
  return labels.map((label, i) => {
    const on = i === active;
    return {
      type: "frame",
      id: `${id}-${i}`,
      name: label,
      x: 12 + i * 62,
      y,
      width: 58,
      height: 26,
      fill: on ? t.active : t.panel,
      stroke: on ? undefined : { color: t.border, width: 1 },
      radius: 6,
      clip: true,
      children: [text(`${id}-${i}-t`, label, 0, 6, on ? t.activeFg : t.fg, { width: 58, fontSize: 12, fontWeight: on ? 600 : 400, align: "center" })],
    };
  });
}

function inspector(id, name, x, y, theme, hActive, vActive) {
  const t = theme === "light" ? light : night;
  const hLabels = ["Esq.", "Centro", "Dir.", "Escala"];
  const vLabels = ["Topo", "Centro", "Base", "Escala"];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 280,
    height: 248,
    fill: t.bg,
    radius: 12,
    clip: true,
    children: [
      text(`${id}-kicker`, "PAP-B-084", 16, 14, t.mutedFg, { fontSize: 12, fontWeight: 600, width: 248 }),
      text(`${id}-title`, "Constraints", 16, 32, t.fg, { fontSize: 14, fontWeight: 700, width: 248 }),
      text(`${id}-h`, "Horizontal", 16, 64, t.mutedFg, { fontSize: 12, width: 248 }),
      ...pills(`${id}-h`, theme, 82, hLabels, hActive),
      text(`${id}-v`, "Vertical", 16, 122, t.mutedFg, { fontSize: 12, width: 248 }),
      ...pills(`${id}-v`, theme, 140, vLabels, vActive),
      text(`${id}-hint`, "Fora do fluxo. Aplica quando o pai muda de tamanho.", 16, 182, t.mutedFg, { fontSize: 12, width: 248 }),
    ],
  };
}

function card(id, caption, x, y, parentW, childX, childW) {
  return {
    type: "frame",
    id,
    name: caption,
    x,
    y,
    width: parentW + 24,
    height: 150,
    fill: "transparent",
    children: [
      text(`${id}-cap`, caption, 0, 0, "#5d6478", { fontSize: 12, fontWeight: 600, width: parentW + 24 }),
      {
        type: "frame",
        id: `${id}-parent`,
        name: "pai",
        x: 0,
        y: 22,
        width: parentW,
        height: 112,
        fill: "#ffffff",
        stroke: { color: "#d3d7e3", width: 1 },
        radius: 8,
        clip: true,
        children: [
          {
            type: "rect",
            id: `${id}-child`,
            name: "filho",
            x: childX,
            y: 36,
            width: childW,
            height: 40,
            fill: "#c8401f",
            radius: 4,
          },
        ],
      },
    ],
  };
}

const behavior = {
  type: "frame",
  id: "papb084-behavior",
  name: "PAP-B-084 · quando o pai alarga",
  x: 600,
  y: Y,
  width: 560,
  height: 430,
  fill: "#e7e9f0",
  radius: 12,
  clip: true,
  children: [
    text("papb084-behavior-kicker", "PAP-B-084", 20, 16, "#5d6478", { fontSize: 12, fontWeight: 600, width: 520 }),
    text("papb084-behavior-title", "Quando o pai alarga", 20, 34, "#141827", { fontSize: 16, fontWeight: 700, width: 520 }),
    text("papb084-behavior-sub", "Direita: a margem direita fica. Escala: x e largura acompanham.", 20, 58, "#5d6478", { fontSize: 12, width: 520 }),
    card("papb084-right-before", "Direita · antes", 20, 88, 180, 128, 36),
    card("papb084-right-after", "Direita · depois", 230, 88, 260, 208, 36),
    card("papb084-scale-before", "Escala · antes", 20, 250, 180, 18, 48),
    card("papb084-scale-after", "Escala · depois", 230, 250, 260, 26, 69),
  ],
};

const nodes = [
  inspector("papb084-inspector-dark", "PAP-B-084 · inspector · escuro", 40, Y, "dark", 2, 0),
  inspector("papb084-inspector-light", "PAP-B-084 · inspector · claro", 40, Y + 280, "light", 3, 1),
  behavior,
];

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  place: "none",
  label: "PAP-B-084 constraints boards",
  nodes,
});

const lint = textOf(await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" }));
console.log("lint", lint.slice(0, 2000));

const shots = [
  ["papb084-inspector-dark", "01-inspector-dark.png"],
  ["papb084-inspector-light", "02-inspector-light.png"],
  ["papb084-behavior", "03-parent-resize.png"],
];
await saveShots(call, workspaceId, outDir, shots);

console.log("done", workspaceId, pageId);
