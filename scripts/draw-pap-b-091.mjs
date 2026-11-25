#!/usr/bin/env node
// Design boards for PAP-B-091. Talks to the local Paprika MCP. Does not call open_workspace.
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, client, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-091-design");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-091");

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

const shots = [
  ["b091-before-light", "antes-claro.png"],
  ["b091-after-light", "depois-claro.png"],
  ["b091-before-dark", "antes-escuro.png"],
  ["b091-after-dark", "depois-escuro.png"],
];
await saveShots(call, workspaceId, outDir, shots, (rootId, r) => {
  console.error("no image", rootId, textOf(r).slice(0, 300));
});

const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" });
console.log(textOf(lint).slice(0, 1200));
await client.close();
