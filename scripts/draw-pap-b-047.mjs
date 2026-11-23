#!/usr/bin/env node
/**
 * Design-first boards for PAP-B-047 (FontPicker). Talks to a local Paprika MCP over HTTP.
 * Usage: node scripts/draw-pap-b-047.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connectBoard, textOf } from "./design-board.mjs";

const { root, client, call } = await connectBoard("pap-b-047-design");
const outDir = join(root, "docs/assets/boards/PAP-B-047");

const wsRaw = textOf(await call("list_workspaces"));
let workspaces;
try {
  workspaces = JSON.parse(wsRaw);
} catch {
  workspaces = { workspaces: [] };
}
const list = workspaces.workspaces ?? workspaces;
console.log(
  "workspaces",
  list.map((w) => `${w.id}:${w.name}`),
);
const ui = list.find((w) => /UI/i.test(w.name ?? ""));
if (ui?.id) {
  await call("open_workspace", { id: ui.id });
  console.log("opened", ui.name);
}

const outline = textOf(await call("get_document_outline", { depth: 1 }));
const ys = [...outline.matchAll(/@-?\d+(?:\.\d+)?,\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const heights = [...outline.matchAll(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)\s+@/g)].map((m) => Number(m[2]));
const bottoms = ys.map((y, i) => y + (heights[i] ?? 0));
const maxBottom = bottoms.length ? Math.max(...bottoms) : 0;
const Y = Number(process.env.BOARD_Y ?? String(Math.ceil((maxBottom + 200) / 100) * 100 || 14000));
const pageId = (outline.match(/page#([^\s"]+)/) ?? [])[1] ?? "interfaces-pap020";
console.log("placing at y=", Y, "maxBottom=", maxBottom, "page=", pageId);

const night = {
  bg: "#1e2336",
  panel: "#272d45",
  muted: "#2c3350",
  fg: "#eef0f7",
  mutedFg: "#a6acc4",
  border: "#2c3350",
  ring: "#4cc7d8",
  field: "#1e2336",
};
const light = {
  bg: "#f2f3f8",
  panel: "#ffffff",
  muted: "#e7e9f0",
  fg: "#141827",
  mutedFg: "#5d6478",
  border: "#d3d7e3",
  ring: "#0b7183",
  field: "#ffffff",
};

function frame(id, name, x, y, theme, open) {
  const t = theme === "light" ? light : night;
  const families = ["Inter", "system-ui", "Georgia", "monospace", "Roboto"];
  const items = families.map((f, i) => ({
    type: "frame",
    id: `${id}-row-${i}`,
    name: f,
    x: 12,
    y: 92 + i * 32,
    width: 256,
    height: 28,
    fill: i === 0 && open ? t.muted : "transparent",
    radius: 4,
    children: [
      {
        type: "text",
        id: `${id}-row-${i}-t`,
        text: f,
        x: 8,
        y: 5,
        width: "fill",
        height: "hug",
        color: t.fg,
        fontSize: 13,
        fontFamily: f === "system-ui" || f === "monospace" ? f : `${f}, sans-serif`,
        fontWeight: i === 0 && open ? 600 : 400,
      },
    ],
  }));
  return {
    type: "frame",
    id,
    name,
    x,
    y,
    width: 320,
    height: open ? 320 : 160,
    fill: t.bg,
    radius: 8,
    clip: true,
    children: [
      {
        type: "text",
        id: `${id}-title`,
        text: name,
        x: 16,
        y: 12,
        width: 288,
        height: "hug",
        color: t.fg,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "sans-serif",
      },
      {
        type: "frame",
        id: `${id}-field`,
        name: "field",
        x: 16,
        y: 40,
        width: 288,
        height: 28,
        fill: t.muted,
        radius: 6,
        children: [
          {
            type: "text",
            id: `${id}-field-label`,
            text: "Fonte",
            x: 8,
            y: 6,
            width: 48,
            height: "hug",
            color: t.mutedFg,
            fontSize: 12,
            fontFamily: "sans-serif",
          },
          {
            type: "text",
            id: `${id}-field-value`,
            text: "Inter, system-ui, sans-serif",
            x: 56,
            y: 6,
            width: 200,
            height: "hug",
            color: t.fg,
            fontSize: 12,
            fontFamily: "Inter, system-ui, sans-serif",
          },
        ],
      },
      ...(open
        ? [
            {
              type: "frame",
              id: `${id}-pop`,
              name: "popover",
              x: 16,
              y: 72,
              width: 288,
              height: 220,
              fill: t.panel,
              radius: 8,
              stroke: { color: t.border, width: 1 },
              shadow: { x: 0, y: 8, blur: 24, spread: 0, color: "rgba(9,12,22,0.45)" },
              children: [
                {
                  type: "frame",
                  id: `${id}-search`,
                  name: "search",
                  x: 8,
                  y: 8,
                  width: 272,
                  height: 28,
                  fill: t.field,
                  radius: 6,
                  stroke: { color: t.ring, width: 1 },
                  children: [
                    {
                      type: "text",
                      id: `${id}-search-t`,
                      text: "Buscar fonte…",
                      x: 8,
                      y: 6,
                      width: "fill",
                      height: "hug",
                      color: t.mutedFg,
                      fontSize: 12,
                      fontFamily: "sans-serif",
                    },
                  ],
                },
                ...items,
                {
                  type: "frame",
                  id: `${id}-sys`,
                  name: "system",
                  x: 12,
                  y: 92 + families.length * 32 + 4,
                  width: 256,
                  height: 28,
                  fill: "transparent",
                  children: [
                    {
                      type: "text",
                      id: `${id}-sys-t`,
                      text: "Usar fontes do sistema…",
                      x: 8,
                      y: 5,
                      width: "fill",
                      height: "hug",
                      color: t.ring,
                      fontSize: 12,
                      fontFamily: "sans-serif",
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ],
  };
}

const nodes = [
  frame("b047-closed-dark", "PAP-B-047 · fechado · escuro", 40, Y, "dark", false),
  frame("b047-open-dark", "PAP-B-047 · aberto · escuro", 400, Y, "dark", true),
  frame("b047-closed-light", "PAP-B-047 · fechado · claro", 40, Y + 400, "light", false),
  frame("b047-open-light", "PAP-B-047 · aberto · claro", 400, Y + 400, "light", true),
];

await call("create_nodes", {
  parentId: pageId,
  label: "PAP-B-047 FontPicker boards",
  nodes,
});

await mkdir(outDir, { recursive: true });
const shots = [
  ["b047-closed-dark", "01-fechado-escuro.png"],
  ["b047-open-dark", "02-aberto-escuro.png"],
  ["b047-closed-light", "03-fechado-claro.png"],
  ["b047-open-light", "04-aberto-claro.png"],
];
for (const [rootId, file] of shots) {
  const r = await call("render_screenshot", { rootId, scale: 2 });
  const img = (r.content ?? []).find((c) => c.type === "image" || c.mimeType?.includes?.("png"));
  let b64 = img?.data ?? img?.blob;
  if (!b64) {
    const t = textOf(r);
    const m = t.match(/iVBOR[\w+/=]+/) || t.match(/base64,([\w+/=]+)/);
    b64 = m?.[1] ?? m?.[0];
  }
  if (!b64) {
    console.error("no image for", rootId, JSON.stringify(r).slice(0, 500));
    continue;
  }
  await writeFile(join(outDir, file), Buffer.from(b64, "base64"));
  console.log("wrote", file);
}

const lint = await call("lint_design", { rootIds: nodes.map((n) => n.id) });
console.log("lint", textOf(lint).slice(0, 800));
await client.close();
console.log("done", outDir);
