#!/usr/bin/env node
// Design boards for PAP-B-094. Talks to the local Paprika MCP. Does not call open_workspace.
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, client, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-094-design");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-094");

const themes = {
  light: {
    bg: "#f4f1ec",
    card: "#ffffff",
    tile: "#efe8df",
    shape: "#e7d7c3",
    shapeB: "#0b7183",
    stroke: "#1e2336",
    ink: "#141827",
    muted: "#5d6478",
    line: "#e4ddd4",
    accent: "#c43d27",
  },
  dark: {
    bg: "#1e2336",
    card: "#272d45",
    tile: "#1a1f33",
    shape: "#3a415c",
    shapeB: "#4cc7d8",
    stroke: "#eef0f7",
    ink: "#eef0f7",
    muted: "#a6acc4",
    line: "#3a415c",
    accent: "#e07a5f",
  },
};

function label(id, x, y, w, h, text, color, size = 14) {
  return { type: "text", id, x, y, width: w, height: h, text, color, fontSize: size, fontFamily: "sans-serif" };
}

function card(id, x, y, name, meta, t, shapes) {
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 220,
    height: 168,
    fill: t.card,
    radius: 12,
    stroke: { color: t.line, width: 1 },
    clip: true,
    children: [
      {
        type: "frame",
        id: `${id}-tile`,
        name: "Miniatura",
        x: 0,
        y: 0,
        width: 220,
        height: 96,
        fill: t.tile,
        clip: true,
        children: shapes,
      },
      label(`${id}-name`, 14, 108, 192, 20, name, t.ink, 15),
      label(`${id}-meta`, 14, 132, 192, 18, meta, t.muted, 13),
    ],
  };
}

function thumbShapes(id, t) {
  return [
    { type: "rect", id: `${id}-a`, x: 18, y: 16, width: 86, height: 64, fill: t.shape, radius: 6 },
    { type: "rect", id: `${id}-b`, x: 114, y: 16, width: 86, height: 40, fill: t.shapeB, radius: 6 },
    { type: "rect", id: `${id}-c`, x: 114, y: 62, width: 40, height: 18, fill: t.accent, radius: 4 },
  ];
}

function letterTile(id, t, letter) {
  return [label(`${id}-letter`, 90, 32, 40, 36, letter, t.muted, 28)];
}

function overview(id, name, x, y, theme) {
  const t = themes[theme];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 760,
    height: 560,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children: [
      label(`${id}-title`, 28, 24, 360, 28, "Workspaces", t.ink, 22),
      label(`${id}-lead`, 28, 56, 420, 20, "Pastas e miniatura ao vivo do conteúdo", t.muted, 14),
      {
        type: "frame",
        id: `${id}-new-ws`,
        name: "Novo workspace",
        x: 470,
        y: 28,
        width: 140,
        height: 36,
        fill: t.accent,
        radius: 8,
        clip: true,
        children: [label(`${id}-new-ws-t`, 12, 8, 116, 20, "Novo workspace", theme === "dark" ? "#141827" : "#fffaf7", 13)],
      },
      {
        type: "frame",
        id: `${id}-new-fd`,
        name: "Nova pasta",
        x: 620,
        y: 28,
        width: 112,
        height: 36,
        fill: t.card,
        radius: 8,
        stroke: { color: t.line, width: 1 },
        clip: true,
        children: [label(`${id}-new-fd-t`, 12, 8, 88, 20, "Nova pasta", t.ink, 13)],
      },
      label(`${id}-folder`, 28, 108, 220, 22, "Produto", t.ink, 16),
      label(`${id}-rename`, 120, 110, 140, 18, "renomear", t.muted, 13),
      card(`${id}-c1`, 28, 144, "Login", "12 nós · agora", t, thumbShapes(`${id}-c1`, t)),
      card(`${id}-c2`, 264, 144, "Ícones", "4 nós · hoje", t, thumbShapes(`${id}-c2`, t)),
      label(`${id}-loose`, 28, 336, 220, 22, "Sem pasta", t.ink, 16),
      card(`${id}-c3`, 28, 368, "Rascunho", "vazio", t, letterTile(`${id}-c3`, t, "R")),
    ],
  };
}

function reference(id, name, x, y, theme) {
  const t = themes[theme];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 760,
    height: 420,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children: [
      label(`${id}-kicker`, 28, 20, 700, 20, "Referência travada sob o frame, e a captura ao lado da imagem", t.muted, 14),
      {
        type: "frame",
        id: `${id}-frame`,
        name: "Tela",
        x: 28,
        y: 56,
        width: 280,
        height: 320,
        fill: t.card,
        radius: 12,
        stroke: { color: t.stroke, width: 1 },
        clip: true,
        children: [
          {
            type: "rect",
            id: `${id}-ref`,
            name: "Referência",
            x: 20,
            y: 20,
            width: 240,
            height: 180,
            fill: t.shape,
            opacity: 0.5,
            radius: 8,
          },
          {
            type: "frame",
            id: `${id}-btn`,
            name: "Botão",
            x: 36,
            y: 210,
            width: 140,
            height: 40,
            fill: t.shapeB,
            radius: 8,
            clip: true,
            children: [label(`${id}-btn-t`, 16, 10, 108, 20, "Entrar", t.bg, 14)],
          },
          label(`${id}-lock`, 36, 268, 210, 20, "Camada travada · 50%", t.muted, 13),
        ],
      },
      {
        type: "frame",
        id: `${id}-shot`,
        name: "Captura",
        x: 340,
        y: 56,
        width: 180,
        height: 240,
        fill: t.card,
        radius: 12,
        stroke: { color: t.line, width: 1 },
        clip: true,
        children: [
          { type: "rect", id: `${id}-shot-a`, x: 16, y: 16, width: 148, height: 120, fill: t.shape, radius: 8 },
          { type: "rect", id: `${id}-shot-b`, x: 16, y: 148, width: 100, height: 32, fill: t.shapeB, radius: 6 },
          label(`${id}-shot-l`, 16, 196, 148, 20, "Captura", t.ink, 13),
        ],
      },
      {
        type: "frame",
        id: `${id}-cmp`,
        name: "Comparar",
        x: 544,
        y: 56,
        width: 180,
        height: 240,
        fill: t.card,
        radius: 12,
        stroke: { color: t.line, width: 1 },
        clip: true,
        children: [
          { type: "rect", id: `${id}-cmp-a`, x: 16, y: 16, width: 148, height: 160, fill: t.shape, opacity: 0.55, radius: 8 },
          label(`${id}-cmp-l`, 16, 196, 148, 20, "Comparar", t.ink, 13),
        ],
      },
      label(`${id}-side`, 340, 316, 384, 40, "render_screenshot com compare: as duas imagens na mesma altura, lado a lado", t.muted, 14),
    ],
  };
}

const nodes = [
  overview("b094-overview-light", "PAP-B-094 · overview · claro", 40, Y, "light"),
  overview("b094-overview-dark", "PAP-B-094 · overview · escuro", 840, Y, "dark"),
  reference("b094-reference-light", "PAP-B-094 · referência · claro", 40, Y + 560, "light"),
  reference("b094-reference-dark", "PAP-B-094 · referência · escuro", 840, Y + 560, "dark"),
];

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-094 folders thumbnails reference",
  nodes,
});

const shots = [
  ["b094-overview-light", "overview-claro.png"],
  ["b094-overview-dark", "overview-escuro.png"],
  ["b094-reference-light", "referencia-claro.png"],
  ["b094-reference-dark", "referencia-escuro.png"],
];
await saveShots(call, workspaceId, outDir, shots);

const lint = await call("lint_design", { workspaceId, rootIds: nodes.map((n) => n.id), minSeverity: "warning" });
console.log(textOf(lint).slice(0, 2500));
await client.close();
