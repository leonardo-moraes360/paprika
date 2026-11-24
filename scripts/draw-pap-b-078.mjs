#!/usr/bin/env node
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-078-design");
const outDir = join(root, "docs/assets/boards/PAP-B-078");
const select = "#4cc7d8";
const day = { bg: "#f2f3f8", canvas: "#e7e9f0", card: "#ffffff", fg: "#141827", muted: "#5d6478", line: "#d3d7e3", photo: "#e7b89a", ink: "#141827" };
const night = { bg: "#1e2336", canvas: "#141827", card: "#272d45", fg: "#eef0f7", muted: "#c5cadb", line: "#3a4260", photo: "#c43d27", ink: "#fff7f2" };

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

function photo(id, x, y, w, h, theme) {
  const t = theme === "light" ? day : night;
  return {
    type: "frame",
    id,
    name: "foto.png",
    x,
    y,
    width: w,
    height: h,
    fill: t.photo,
    radius: 8,
    clip: true,
    children: [
      text(`${id}-cap`, "foto.png", 12, 12, t.ink, { width: w - 24, fontSize: 12, fontWeight: 700 }),
      text(`${id}-alt`, "data:image/png", 12, 32, t.ink, { width: w - 24, fontSize: 12 }),
    ],
  };
}

function board(id, theme, mode) {
  const t = theme === "light" ? day : night;
  const paste = mode === "paste";
  const title = paste ? "Colar imagem" : "Soltar imagem";
  const sub = paste
    ? "Ctrl+V de PNG, JPEG, WebP, AVIF ou GIF. O nó image nasce no centro da vista, dentro do frame selecionado. O src é a data URI."
    : "Soltar o arquivo no canvas cria o nó image no ponto. GIF animado segue animado. .fig e PDF são recusados com o motivo.";
  const canvasKids = paste
    ? [
        {
          type: "frame",
          id: `${id}-card`,
          name: "Cartão",
          x: 180,
          y: 70,
          width: 520,
          height: 280,
          fill: t.card,
          stroke: { color: select, width: 2 },
          radius: 12,
          children: [
            text(`${id}-sel`, "Frame selecionado", 16, 14, t.muted, { width: 240, fontSize: 12 }),
            photo(`${id}-img`, 150, 70, 220, 140, theme),
          ],
        },
      ]
    : [
        {
          type: "frame",
          id: `${id}-chip`,
          name: "Arquivo",
          x: 560,
          y: 36,
          width: 140,
          height: 36,
          fill: t.card,
          stroke: { color: select, width: 1 },
          radius: 8,
          children: [text(`${id}-file`, "foto.png", 12, 8, t.fg, { width: 116, fontSize: 13, fontWeight: 700 })],
        },
        photo(`${id}-img`, 200, 120, 240, 150, theme),
        text(`${id}-no`, ".fig e PDF não entram", 24, 300, t.muted, { width: 280, fontSize: 12 }),
      ];
  return {
    type: "frame",
    id,
    name: title,
    x: paste ? 0 : 1000,
    y: theme === "light" ? 0 : 600,
    width: 960,
    height: 520,
    fill: t.bg,
    clip: true,
    radius: 16,
    children: [
      text(`${id}-title`, title, 24, 18, t.fg, { width: 800, fontSize: 18, fontWeight: 700 }),
      text(`${id}-sub`, sub, 24, 48, t.muted, { width: 900, fontSize: 13 }),
      {
        type: "frame",
        id: `${id}-canvas`,
        name: "Canvas",
        x: 24,
        y: 96,
        width: 912,
        height: 400,
        fill: t.canvas,
        stroke: { color: paste ? t.line : select, width: paste ? 1 : 2 },
        radius: 12,
        children: canvasKids,
      },
    ],
  };
}

const nodes = [
  board("b078-paste-light", "light", "paste"),
  board("b078-drop-light", "light", "drop"),
  board("b078-paste-dark", "dark", "paste"),
  board("b078-drop-dark", "dark", "drop"),
];

const created = await call("create_nodes", { workspaceId, parentId: pageId, x: 0, y: Y, nodes });
console.log(textOf(created).slice(0, 500));
const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id) });
console.log(textOf(lint).slice(0, 800));
await saveShots(call, workspaceId, outDir, [
  ["b078-paste-light", "colar-claro.png"],
  ["b078-drop-light", "soltar-claro.png"],
  ["b078-paste-dark", "colar-escuro.png"],
  ["b078-drop-dark", "soltar-escuro.png"],
]);
console.log("done", workspaceId, pageId, Y);
