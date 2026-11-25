#!/usr/bin/env node
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, client, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-093-design");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-093");

const themes = {
  light: {
    bg: "#f4f1ec",
    card: "#ffffff",
    shape: "#e7d7c3",
    stroke: "#1e2336",
    select: "#0b7183",
    ink: "#141827",
    muted: "#5d6478",
    field: "#f7f5f2",
    pip: "#ffffff",
  },
  dark: {
    bg: "#1e2336",
    card: "#272d45",
    shape: "#3a415c",
    stroke: "#eef0f7",
    select: "#4cc7d8",
    ink: "#eef0f7",
    muted: "#a6acc4",
    field: "#1a1f33",
    pip: "#272d45",
  },
};

const cloudD = "M40 72 C18 72 10 54 26 46 C16 28 40 14 62 28 C74 8 112 8 122 28 C148 16 168 38 152 56 C172 76 146 96 114 84 C100 98 54 96 40 72 Z";
const paraD = "M42 10 L150 10 L118 90 L10 90 Z";

function label(id, x, y, w, text, color) {
  return {
    type: "text",
    id,
    x,
    y,
    width: w,
    height: 18,
    text,
    color,
    fontSize: 13,
    fontFamily: "sans-serif",
  };
}

function shapesBoard(id, name, x, y, theme) {
  const t = themes[theme];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 560,
    height: 280,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children: [
      label(`${id}-kicker`, 24, 18, 500, "Novas formas de diagrama", t.muted),
      {
        type: "frame",
        id: `${id}-cyl`,
        name: "Cilindro",
        x: 36,
        y: 56,
        width: 150,
        height: 150,
        fill: "transparent",
        clip: false,
        children: [
          { type: "rect", id: `${id}-cyl-body`, x: 16, y: 28, width: 118, height: 96, fill: t.shape, stroke: { color: t.stroke, width: 2 } },
          { type: "ellipse", id: `${id}-cyl-bot`, x: 16, y: 108, width: 118, height: 32, fill: t.shape, stroke: { color: t.stroke, width: 2 } },
          { type: "ellipse", id: `${id}-cyl-top`, x: 16, y: 12, width: 118, height: 32, fill: t.shape, stroke: { color: t.stroke, width: 2 } },
        ],
      },
      label(`${id}-cyl-name`, 36, 214, 150, "Cilindro", t.ink),
      {
        type: "path",
        id: `${id}-para`,
        name: "Paralelogramo",
        x: 210,
        y: 68,
        width: 160,
        height: 100,
        d: paraD,
        fill: t.shape,
        stroke: { color: t.stroke, width: 2 },
        normalize: true,
      },
      label(`${id}-para-name`, 210, 214, 160, "Paralelogramo", t.ink),
      {
        type: "path",
        id: `${id}-cloud`,
        name: "Nuvem",
        x: 390,
        y: 64,
        width: 140,
        height: 110,
        d: cloudD,
        fill: t.shape,
        stroke: { color: t.stroke, width: 2 },
        normalize: true,
      },
      label(`${id}-cloud-name`, 390, 214, 140, "Nuvem", t.ink),
    ],
  };
}

function knob(id, x, y, t) {
  return {
    type: "ellipse",
    id,
    x: x - 6,
    y: y - 6,
    width: 12,
    height: 12,
    fill: t.pip,
    stroke: { color: t.select, width: 1.5 },
    lintIgnore: ["detached-sibling", "near-gap"],
  };
}

function interactBoard(id, name, x, y, theme) {
  const t = themes[theme];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 560,
    height: 320,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children: [
      label(`${id}-kicker`, 24, 16, 500, "Conta-gotas e pontas da seta", t.muted),
      {
        type: "frame",
        id: `${id}-picker`,
        name: "Seletor",
        x: 24,
        y: 48,
        width: 220,
        height: 236,
        fill: t.card,
        stroke: { color: t.stroke, width: 1 },
        radius: 12,
        clip: true,
        children: [
          label(`${id}-cor`, 14, 12, 180, "Cor", t.muted),
          { type: "rect", id: `${id}-sv`, x: 14, y: 38, width: 192, height: 96, fill: "#c4553a", radius: 6 },
          { type: "rect", id: `${id}-hue`, x: 14, y: 144, width: 192, height: 10, fill: "#c4553a", radius: 5 },
          {
            type: "frame",
            id: `${id}-hexrow`,
            x: 14,
            y: 168,
            width: 192,
            height: 36,
            fill: t.field,
            radius: 6,
            clip: true,
            layout: { mode: "row", gap: 8, padding: 6, align: "center", justify: "start" },
            children: [
              { type: "text", id: `${id}-hex`, width: "fill", height: 18, text: "#C4553A", color: t.ink, fontSize: 13, fontFamily: "sans-serif" },
              {
                type: "frame",
                id: `${id}-pip`,
                name: "Conta-gotas",
                width: 24,
                height: 24,
                fill: t.pip,
                stroke: { color: t.select, width: 1.5 },
                radius: 6,
                clip: true,
                children: [
                  { type: "ellipse", id: `${id}-pip-dot`, x: 7, y: 7, width: 10, height: 10, fill: t.select },
                ],
              },
            ],
          },
          label(`${id}-hint`, 14, 210, 192, "API ou amostra no canvas", t.muted),
        ],
      },
      {
        type: "frame",
        id: `${id}-boxa`,
        name: "Origem",
        x: 280,
        y: 64,
        width: 100,
        height: 64,
        fill: t.shape,
        stroke: { color: t.stroke, width: 2 },
        radius: 8,
        clip: true,
        children: [label(`${id}-an`, 8, 22, 84, "Origem", t.ink)],
      },
      {
        type: "frame",
        id: `${id}-boxb`,
        name: "Destino",
        x: 420,
        y: 176,
        width: 110,
        height: 64,
        fill: t.shape,
        stroke: { color: t.stroke, width: 2 },
        radius: 8,
        clip: true,
        children: [label(`${id}-bn`, 8, 22, 94, "Destino", t.ink)],
      },
      {
        type: "path",
        id: `${id}-arrow`,
        name: "Seta",
        x: 330,
        y: 96,
        width: 145,
        height: 112,
        d: "M0 0 L90 0 L90 80",
        fill: "none",
        stroke: { color: t.stroke, width: 2 },
        normalize: true,
        lintIgnore: ["detached-sibling"],
      },
      knob(`${id}-from`, 330, 96, t),
      knob(`${id}-to`, 420, 176, t),
      label(`${id}-drag`, 280, 258, 250, "Arraste a ponta: prende ou solta", t.ink),
    ],
  };
}

const nodes = [
  shapesBoard("b093-shapes-light", "PAP-B-093 · formas · claro", 40, Y, "light"),
  shapesBoard("b093-shapes-dark", "PAP-B-093 · formas · escuro", 640, Y, "dark"),
  interactBoard("b093-interact-light", "PAP-B-093 · interação · claro", 40, Y + 320, "light"),
  interactBoard("b093-interact-dark", "PAP-B-093 · interação · escuro", 640, Y + 320, "dark"),
];

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-093 eyedropper shapes connector",
  nodes,
});

const shots = [
  ["b093-shapes-light", "formas-claro.png"],
  ["b093-shapes-dark", "formas-escuro.png"],
  ["b093-interact-light", "interacao-claro.png"],
  ["b093-interact-dark", "interacao-escuro.png"],
];
await saveShots(call, workspaceId, outDir, shots, (rootId, r) => {
  console.error("no image", rootId, textOf(r).slice(0, 400));
});

const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" });
console.log(textOf(lint).slice(0, 2000));
await client.close();
