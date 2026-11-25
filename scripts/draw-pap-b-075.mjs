#!/usr/bin/env node
// Design boards for PAP-B-075 (pin thread + leave team). Does not call open_workspace.
import { join } from "node:path";
import { openDesignPage, saveShots, textOf } from "./design-board.mjs";

const { root, call, workspaceId, pageId, Y } = await openDesignPage("pap-b-075-design");
const outDir = join(root, "docs/en-US/assets/boards/PAP-B-075");

const themes = {
  light: {
    bg: "#f4f1ec",
    card: "#ffffff",
    night: "#f7f5f2",
    line: "#e4ddd4",
    ink: "#141827",
    muted: "#5d6478",
    accent: "#e04a2b",
    soft: "#f8e4de",
    agent: "#3b82f6",
    danger: "#f3d6d8",
    dangerInk: "#8d1d2c",
    white: "#ffffff",
    badge: "#141827",
    onBadge: "#ffffff",
  },
  dark: {
    bg: "#1e2336",
    card: "#272d45",
    night: "#1a1f33",
    line: "#3a415c",
    ink: "#eef0f7",
    muted: "#a6acc4",
    accent: "#e04a2b",
    soft: "#4a2a28",
    agent: "#3b82f6",
    danger: "#4a2a32",
    dangerInk: "#f3b4bc",
    white: "#ffffff",
    badge: "#141827",
    onBadge: "#ffffff",
  },
};

function text(id, x, y, w, h, value, color, size = 13, weight) {
  return {
    type: "text",
    id,
    x,
    y,
    width: w,
    height: h,
    text: value,
    color,
    fontSize: size,
    fontFamily: "sans-serif",
    ...(weight ? { fontWeight: weight } : {}),
  };
}

function board(id, name, x, y, theme) {
  const t = themes[theme];
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 920,
    height: 520,
    fill: t.bg,
    clip: true,
    scaledMock: true,
    children: [
      text(`${id}-kicker`, 28, 20, 860, 18, "PAP-B-075 · thread do apontamento e sair do time", t.muted, 13),
      {
        type: "frame",
        id: `${id}-pin`,
        name: "Apontamento",
        x: 28,
        y: 56,
        width: 420,
        height: 432,
        fill: t.card,
        stroke: { color: t.line, width: 1 },
        radius: 16,
        clip: true,
        children: [
          {
            type: "frame",
            id: `${id}-badge`,
            name: "Número",
            x: 16,
            y: 16,
            width: 28,
            height: 28,
            fill: t.badge,
            radius: 14,
            clip: true,
            children: [text(`${id}-num`, 0, 5, 28, 18, "1", t.onBadge, 13, 700)],
          },
          text(`${id}-who`, 52, 14, 240, 18, "Você", t.ink, 13, 700),
          text(`${id}-when`, 52, 32, 120, 16, "agora", t.muted, 12),
          text(`${id}-ask`, 16, 56, 388, 40, "Aumente este título para 32px", t.ink, 15),
          {
            type: "frame",
            id: `${id}-chip`,
            name: "Aberto",
            x: 16,
            y: 104,
            width: 72,
            height: 22,
            fill: t.soft,
            radius: 11,
            clip: true,
            children: [text(`${id}-chip-t`, 12, 2, 48, 16, "Aberto", t.ink, 11, 700)],
          },
          text(`${id}-target`, 96, 106, 180, 16, "Título", t.muted, 12),
          {
            type: "frame",
            id: `${id}-a1`,
            name: "Resposta do agente",
            x: 16,
            y: 142,
            width: 388,
            height: 72,
            fill: t.night,
            stroke: { color: t.line, width: 1 },
            radius: 10,
            clip: true,
            children: [
              text(`${id}-a1-who`, 12, 8, 360, 16, "claude-code", t.ink, 12, 700),
              text(`${id}-a1-body`, 12, 28, 360, 32, "Título em 32px.", t.ink, 13),
            ],
          },
          {
            type: "frame",
            id: `${id}-h1`,
            name: "Resposta da pessoa",
            x: 16,
            y: 224,
            width: 388,
            height: 72,
            fill: t.night,
            stroke: { color: t.line, width: 1 },
            radius: 10,
            clip: true,
            children: [
              text(`${id}-h1-who`, 12, 8, 360, 16, "Você", t.ink, 12, 700),
              text(`${id}-h1-body`, 12, 28, 360, 32, "Pode ser semibold?", t.ink, 13),
            ],
          },
          {
            type: "frame",
            id: `${id}-box`,
            name: "Responder",
            x: 16,
            y: 310,
            width: 388,
            height: 64,
            fill: t.night,
            stroke: { color: t.line, width: 1 },
            radius: 10,
            clip: true,
            children: [text(`${id}-ph`, 12, 10, 360, 18, "Responder no fio…", t.muted, 13)],
          },
          {
            type: "frame",
            id: `${id}-send`,
            name: "Enviar resposta",
            x: 280,
            y: 386,
            width: 124,
            height: 32,
            fill: t.badge,
            radius: 8,
            clip: true,
            children: [text(`${id}-send-t`, 16, 7, 96, 18, "Responder", t.onBadge, 13, 700)],
          },
        ],
      },
      {
        type: "frame",
        id: `${id}-team`,
        name: "Time",
        x: 472,
        y: 56,
        width: 420,
        height: 432,
        fill: t.card,
        stroke: { color: t.line, width: 1 },
        radius: 16,
        clip: true,
        children: [
          text(`${id}-team-h`, 20, 18, 380, 22, "Pessoas e agentes", t.ink, 16, 700),
          {
            type: "frame",
            id: `${id}-ava`,
            name: "Ana",
            x: 20,
            y: 64,
            width: 36,
            height: 36,
            fill: t.badge,
            radius: 18,
            clip: true,
            children: [text(`${id}-ini`, 0, 8, 36, 20, "A", t.onBadge, 14, 700)],
          },
          text(`${id}-name`, 68, 62, 220, 20, "Ana (você)", t.ink, 14, 700),
          text(`${id}-sub`, 68, 84, 220, 16, "este dispositivo · fundador(a)", t.muted, 12),
          {
            type: "frame",
            id: `${id}-bruno`,
            name: "Bruno",
            x: 20,
            y: 124,
            width: 380,
            height: 72,
            fill: t.night,
            radius: 12,
            clip: true,
            children: [
              {
                type: "frame",
                id: `${id}-bava`,
                name: "Bruno",
                x: 12,
                y: 18,
                width: 36,
                height: 36,
                fill: t.badge,
                radius: 18,
                clip: true,
                children: [text(`${id}-bini`, 0, 8, 36, 20, "B", t.onBadge, 14, 700)],
              },
              text(`${id}-bname`, 60, 16, 160, 20, "Bruno (você)", t.ink, 14, 700),
              text(`${id}-bsub`, 60, 38, 160, 16, "este dispositivo", t.muted, 12),
              {
                type: "frame",
                id: `${id}-leave`,
                name: "Sair do time",
                x: 236,
                y: 20,
                width: 128,
                height: 32,
                fill: t.danger,
                radius: 8,
                clip: true,
                children: [text(`${id}-leave-t`, 14, 7, 104, 18, "Sair do time", t.dangerInk, 13, 700)],
              },
            ],
          },
          text(`${id}-note`, 20, 216, 380, 72, "Quem entrou sai sozinho. A fundadora continua: ela remove os outros. Não há papéis de aprovação.", t.muted, 13),
        ],
      },
    ],
  };
}

const nodes = [
  board("b075-light", "PAP-B-075 · claro", 40, Y, "light"),
  board("b075-dark", "PAP-B-075 · escuro", 1000, Y, "dark"),
];

try {
  await call("delete_nodes", { workspaceId, ids: ["b075-light", "b075-dark"] });
} catch (err) {
  console.log("delete skipped", err.message);
}

await call("create_nodes", {
  workspaceId,
  parentId: pageId,
  label: "PAP-B-075 pin thread and leave team",
  nodes,
});

const lint = await call("lint_design", { workspaceId, rootIds: ["b075-light", "b075-dark"] });
console.log(textOf(lint).slice(0, 800));

await saveShots(call, workspaceId, outDir, [
  ["b075-light", "thread-claro.png"],
  ["b075-dark", "thread-escuro.png"],
]);
