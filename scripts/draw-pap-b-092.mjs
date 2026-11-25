#!/usr/bin/env node
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, client, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-092-design");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-092");

const themes = {
  light: {
    bg: "#f4f1ec",
    card: "#ffffff",
    shape: "#e7d7c3",
    shapeB: "#d7c4aa",
    stroke: "#1e2336",
    select: "#0b7183",
    ink: "#141827",
    muted: "#5d6478",
    badge: "#0b7183",
    badgeInk: "#ffffff",
  },
  dark: {
    bg: "#1e2336",
    card: "#272d45",
    shape: "#3a415c",
    shapeB: "#4a5378",
    stroke: "#eef0f7",
    select: "#4cc7d8",
    ink: "#eef0f7",
    muted: "#a6acc4",
    badge: "#4cc7d8",
    badgeInk: "#0d1220",
  },
};

function corner(id, x, y, t) {
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
    lintIgnore: ["detached-sibling", "near-gap"],
  };
}

function pill(id, x, y, axis, t) {
  const w = axis === "x" ? 8 : 22;
  const h = axis === "x" ? 22 : 8;
  return {
    type: "rect",
    id,
    x: +(x - w / 2).toFixed(2),
    y: +(y - h / 2).toFixed(2),
    width: w,
    height: h,
    fill: "#ffffff",
    stroke: { color: t.select, width: 1.5 },
    radius: 4,
    lintIgnore: ["detached-sibling", "near-gap"],
  };
}

function board(id, name, x, y, theme, mode) {
  const t = themes[theme];
  const fx = 72;
  const fy = 78;
  const fw = 320;
  const fh = 148;
  const pad = 16;
  const gap = 16;
  const cw = (fw - pad * 2 - gap) / 2;
  const ch = fh - pad * 2;
  const ax = fx + pad;
  const ay = fy + pad;
  const bx = ax + cw + gap;
  const children = [
    {
      type: "text",
      id: `${id}-kicker`,
      x: 20,
      y: 16,
      width: 440,
      height: 18,
      text: mode === "after" ? "Arraste gap e padding no canvas" : "Gap e padding só no inspector",
      color: t.muted,
      fontSize: 13,
      fontFamily: "sans-serif",
    },
    {
      type: "frame",
      id: `${id}-card`,
      x: fx,
      y: fy,
      width: fw,
      height: fh,
      fill: t.card,
      stroke: { color: t.stroke, width: 1 },
      radius: 10,
      clip: true,
      layout: { mode: "row", gap, padding: pad, align: "stretch", justify: "start" },
      children: [
        { type: "rect", id: `${id}-a`, name: "A", width: cw, height: "fill", fill: t.shape, radius: 6 },
        { type: "rect", id: `${id}-b`, name: "B", width: cw, height: "fill", fill: t.shapeB, radius: 6 },
      ],
    },
    {
      type: "rect",
      id: `${id}-outline`,
      x: fx,
      y: fy,
      width: fw,
      height: fh,
      fill: "transparent",
      stroke: { color: t.select, width: 1.5 },
      radius: 10,
      lintIgnore: ["detached-sibling"],
    },
    corner(`${id}-nw`, fx, fy, t),
    corner(`${id}-ne`, fx + fw, fy, t),
    corner(`${id}-se`, fx + fw, fy + fh, t),
    corner(`${id}-sw`, fx, fy + fh, t),
  ];
  if (mode === "after") {
    children.push(
      pill(`${id}-pt`, fx + fw / 2, fy + pad, "y", t),
      pill(`${id}-pr`, fx + fw - pad, fy + fh / 2, "x", t),
      pill(`${id}-pb`, fx + fw / 2, fy + fh - pad, "y", t),
      pill(`${id}-pl`, fx + pad, fy + fh / 2, "x", t),
      pill(`${id}-gap`, (ax + cw + bx) / 2, fy + fh / 2, "x", t),
    );
  }
  children.push(
    {
      type: "rect",
      id: `${id}-badge`,
      x: 150,
      y: 268,
      width: 180,
      height: 22,
      fill: t.badge,
      radius: 3,
    },
    {
      type: "text",
      id: `${id}-size`,
      x: 150,
      y: 271,
      width: 180,
      height: 16,
      text: mode === "after" ? "um desfazer por arraste" : "sem alças de espaço",
      color: t.badgeInk,
      fontSize: 12,
      fontFamily: "sans-serif",
      textAlign: "center",
      lintIgnore: ["contrast"],
    },
  );
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 480,
    height: 320,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children,
  };
}

const nodes = [
  board("b092-before-light", "PAP-B-092 · antes · claro", 40, Y, "light", "before"),
  board("b092-after-light", "PAP-B-092 · depois · claro", 560, Y, "light", "after"),
  board("b092-before-dark", "PAP-B-092 · antes · escuro", 40, Y + 360, "dark", "before"),
  board("b092-after-dark", "PAP-B-092 · depois · escuro", 560, Y + 360, "dark", "after"),
];

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-092 spacing handles",
  nodes,
});

const shots = [
  ["b092-before-light", "antes-claro.png"],
  ["b092-after-light", "depois-claro.png"],
  ["b092-before-dark", "antes-escuro.png"],
  ["b092-after-dark", "depois-escuro.png"],
];
await saveShots(call, workspaceId, outDir, shots, (rootId, r) => {
  console.error("no image", rootId, textOf(r).slice(0, 300));
});

const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" });
console.log(textOf(lint).slice(0, 1500));
await client.close();
