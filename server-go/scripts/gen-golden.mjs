#!/usr/bin/env node
// Generates the parity fixtures for the Go port from the TypeScript reference (@paprika/core).
// Usage (from the repo root, after `pnpm build`): node server-go/scripts/gen-golden.mjs
// Output: server-go/internal/core/testdata/golden.json. The Go tests must reproduce every output.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const core = await import(join(root, "packages/core/dist/index.js"));
const {
  applyOps, createDocument, parseDocument, copyId, History, outline, describeNode, lintDocument, renderHTML,
  exportReact, exportTailwind, exportCssModules, exportAngular, exportSvelte, renderTailwindHTML, renderFrameworkHTML, nodeStyle, cssToString, queryNodes, parsePath, pathBounds, serializePath, pathError,
  parseColor, contrastRatio, Op, Document, groupOps, ungroupOps, addPageOps, duplicateOps, combinePathsOps, importSVG, importHTML, exportSVG,
  diagramOps, shapeOutline, tailwindClassesFor, layout, measureText, FONT_AVG, normalizePath, pathOrigin,
} = core;

const json = (v) => JSON.stringify(v, null, 2);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const err = (f) => {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const base = () => createDocument("Teste", "doc1");
const card = () =>
  applyOps(base(), [
    {
      op: "create",
      node: {
        type: "frame", id: "card", name: "Card", width: 320, height: 200, fill: "#ffffff",
        layout: { mode: "column", gap: 8, padding: 16 },
        children: [
          { type: "text", id: "title", name: "Título", text: "Olá", fontSize: 24, width: "fill", height: "hug" },
          { type: "rect", id: "bar", width: "fill", height: 4, fill: "#ff278c" },
        ],
      },
    },
  ]).doc;

// Theme modes: base tokens, a "dark" mode, the same card light and dark side by side, a chained
// token, a token defined only in a mode, a numeric (font size) token and a mode without tokens.
const themed = () =>
  applyOps(base(), [
    { op: "set_tokens", tokens: { bg: "#ffffff", fg: "#1e2336", "brand.main": "#c43d27", accent: "$brand.main", size: 16, "10": "#000" } },
    { op: "set_tokens", mode: "dark", tokens: { bg: "#14161f", fg: "#f2f2f2", only: "rgba(0,0,0,.5)", size: 18 } },
    { op: "set_tokens", mode: "odd", tokens: { fg: "a;b}<\\/style>" } },
    ...["light", "dark"].map((m, i) => ({
      op: "create",
      node: {
        type: "frame", id: `t-${m}`, name: `Tema ${m}`, x: i * 340, width: 320, height: 160, fill: "$bg", ...(m === "dark" ? { mode: "dark" } : {}),
        layout: { mode: "column", gap: 8, padding: 16 },
        stroke: { color: "$accent", width: 1 }, shadow: { x: 0, y: 2, blur: 4, spread: 0, color: "$only" },
        children: [
          { type: "text", id: `t-${m}-title`, text: "Olá", color: "$fg", fontSize: "$size", width: "fill", height: "hug" },
          { type: "path", id: `t-${m}-icon`, d: "M0 0 L10 10", width: 10, height: 10, fill: "$accent", stroke: { color: "$fg", width: 1 } },
          { type: "frame", id: `t-${m}-inner`, mode: "odd", width: 40, height: 20, fill: "$fg" },
        ],
      },
    })),
    { op: "create", node: { type: "frame", id: "t-ghost", mode: "ghost", x: 700, width: 20, height: 20, fill: "$bg" } },
  ]).doc;

const free = () =>
  applyOps(base(), [
    {
      op: "create",
      node: {
        type: "frame", id: "board", name: "Board", width: 400, height: 300, fill: "#fbf8f4",
        children: [
          { type: "rect", id: "r1", x: 40, y: 50, width: 20, height: 10, fill: "#c43d27" },
          { type: "ellipse", id: "e1", x: 100.5, y: 20.25, width: 30, height: 30, fill: "#1e2336", rotation: 30 },
          { type: "text", id: "t1", x: 10, y: 200, width: "hug", height: "hug", text: "Livre", color: "#1e2336" },
          { type: "path", id: "p1", x: 200, y: 100, d: "M0 0 C 20 -30 60 30 80 0", stroke: { color: "#c43d27", width: 3 } },
        ],
      },
    },
  ]).doc;
const grouped = () => {
  const d = free();
  return applyOps(d, groupOps(d, ["e1", "r1"], { id: "g1", name: "Par" }).ops).doc;
};
const paged = () => {
  const d = grouped();
  const d2 = applyOps(d, addPageOps(d, { id: "pg2", name: "Rascunhos", firstId: "pg1" }).ops).doc;
  return applyOps(d2, [
    { op: "update", id: "pg2", props: { fill: "#101418" } },
    { op: "create", parentId: "pg2", node: { type: "frame", id: "f2", x: 500, y: 600, width: 120, height: 80, fill: "#ffffff",
      children: [{ type: "group", id: "g2", children: [{ type: "rect", id: "r2", x: 10, y: 10, width: 30, height: 20, fill: "#c43d27" }] }] } },
  ]).doc;
};

const comp = () => {
  const d = applyOps(free(), [
    { op: "update", id: "board", props: { width: 1200 } },
    { op: "create", parentId: "board", node: { type: "frame", id: "btn", name: "Botão", component: true, x: 20, y: 240, width: 120, height: 40, radius: 8, fill: "$brand",
      stroke: { color: "#1e2336", width: 1.5 }, shadow: { x: 0, y: 2, blur: 4, color: "#0003" }, layout: { mode: "row", gap: 4, padding: [8, 12, 8, 12], align: "center" },
      children: [
        { type: "text", id: "lbl", text: "Enviar", color: "#ffffff", fontSize: 14, letterSpacing: 0.5, width: "hug", height: "hug" },
        { type: "path", id: "ico", d: "M0 0 L8 8 M8 0 L0 8", width: 8, height: 8, stroke: { color: "#ffffff", width: 1 } },
      ] } },
    { op: "create", parentId: "board", node: { type: "frame", id: "badge", component: true, x: 600, y: 20, width: 60, height: 60, fill: "#ffffff",
      children: [{ type: "group", id: "bg", children: [{ type: "ellipse", id: "dot", x: 5, y: 5, width: 20, height: 20, fill: "#c43d27" }, { type: "rect", id: "bar", x: 30, y: 12, width: 20, height: 6, rotation: 30 }] }] } },
    { op: "create", parentId: "board", node: { type: "frame", id: "i1", name: "Enviar", instanceOf: "btn", x: 200, y: 240 } },
    { op: "create", parentId: "board", node: { type: "frame", id: "i2", instanceOf: "btn", x: 400, y: 240, scale: 1.5, rotation: 10 } },
    { op: "create", parentId: "board", node: { type: "frame", id: "i3", instanceOf: "badge", x: 700, y: 20, scale: 0.75 } },
  ]).doc;
  return applyOps(d, [{ op: "update", id: copyId("i2", "lbl"), props: { text: "Cancelar", color: "#c43d27" } }, { op: "update", id: "i2", props: { fill: "#ffffff" } }]).doc;
};

// Diagrams: shapes of every kind, connectors (straight, elbow, sides, free ends, arrows, dashed),
// one inside a frame, one inside a group, and a component with a connector and a scaled instance.
const diagram = () => {
  const d0 = applyOps(base(), [{ op: "set_tokens", tokens: { ink: "#1e2336", note: "#ffe8a3" } }]).doc;
  const plan = diagramOps(d0, {
    nodes: [
      { id: "start", text: "Início", shape: "ellipse" },
      { id: "ask", text: "Tudo certo?\nRevisar", shape: "diamond", fill: "$note", color: "$ink" },
      { id: "yes", text: "Publicar" },
      { id: "no", text: "Corrigir", radius: 0, stroke: { color: "$ink", width: 3 } },
      { id: "memo", text: "Lembrar <de> revisar", shape: "note", x: 600, y: -20.5, rotation: 5, fontSize: 14 },
    ],
    edges: [
      { from: "start", to: "ask" }, { from: "ask", to: "yes", toSide: "left", label: "sim" }, { from: "ask", to: "no", dashed: true, label: "não <já>" },
      { from: "no", to: "ask", route: "straight", startArrow: "arrow" }, { from: "memo", to: "no", route: "straight", endArrow: "none", stroke: { color: "$ink", width: 1 }, label: "nota" },
    ],
  });
  const d1 = applyOps(d0, plan.ops).doc;
  return applyOps(d1, [
    { op: "create", node: { type: "frame", id: "box", x: 900, y: 0, width: 300, height: 200, fill: "#fbf8f4", children: [
      { type: "shape", id: "in1", x: 20, y: 20, width: 80, height: 40, text: "A" },
      { type: "group", id: "gq", children: [{ type: "shape", id: "in2", x: 180, y: 120, width: 80, height: 50, shape: "ellipse", opacity: 0.5 }] },
      { type: "connector", id: "k1", from: { nodeId: "in1", side: "right" }, to: { nodeId: "in2", side: "top" }, route: "elbow", label: "dentro" },
      { type: "connector", id: "k2", from: { x: 10.5, y: 190 }, to: { nodeId: "in1" }, visible: false },
    ] } },
    { op: "create", parentId: "gq", node: { type: "connector", id: "k3", from: { nodeId: "in2" }, to: { nodeId: "start" }, label: "volta" } },
    { op: "create", node: { type: "frame", id: "flow", component: true, x: 0, y: 500, width: 300, height: 80, children: [
      { type: "shape", id: "c1", x: 0, y: 10, width: 80, height: 50, text: "x" },
      { type: "shape", id: "c2", x: 200, y: 10, width: 80, height: 50, shape: "diamond" },
      { type: "connector", id: "ck", from: { nodeId: "c1" }, to: { nodeId: "c2" }, route: "elbow" },
      { type: "connector", id: "cf", from: { x: 0, y: 0 }, to: { nodeId: "c2", side: "bottom" } },
    ] } },
    { op: "create", node: { type: "frame", id: "flowi", instanceOf: "flow", x: 400, y: 500, scale: 1.5 } },
  ]).doc;
};

const corners = () =>
  applyOps(base(), [
    { op: "set_tokens", tokens: { "radius.md": 12, brand: "#ff0000" } },
    {
      op: "create",
      node: {
        type: "frame", id: "board", name: "Cantos", width: 360, height: 220, fill: "#ffffff", clip: true, radius: [24, 8, 0, 16],
        children: [
          { type: "rect", id: "mix", x: 16, y: 16, width: 120, height: 80, fill: "#c8401f", radius: ["$radius.md", 4, 0, 8] },
          { type: "rect", id: "same", x: 160, y: 16, width: 80, height: 80, fill: "#111111", radius: [8, 8, 8, 8] },
          { type: "image", id: "img", x: 16, y: 120, width: 64, height: 48, src: "data:image/png;base64,aaaa", radius: [0, 12, 12, 0], alt: "a" },
          { type: "frame", id: "btn", component: true, x: 160, y: 120, width: 80, height: 32, fill: "#333333", radius: [10, 0, 4, 8] },
        ],
      },
    },
    { op: "create", node: { type: "frame", id: "inst", instanceOf: "btn", x: 260, y: 120, scale: 2 } },
  ]).doc;

const absflow = () =>
  applyOps(base(), [
    {
      op: "create",
      node: {
        type: "frame", id: "row", x: 10, y: 20, width: "hug", height: "hug", fill: "#ffffff",
        layout: { mode: "row", gap: 8, padding: 0, align: "start" },
        children: [
          { type: "rect", id: "a", width: 40, height: 20, fill: "#111111" },
          { type: "rect", id: "pin", width: 16, height: 16, x: 100, y: 4, fill: "#c43d27", layoutPositioning: "absolute" },
          { type: "rect", id: "b", width: 30, height: 20, fill: "#222222" },
        ],
      },
    },
  ]).doc;

const docs = {
  empty: base(),
  absflow: absflow(),
  comp: comp(),
  card: card(),
  free: free(),
  grouped: grouped(),
  paged: paged(),
  themed: parseDocument(themed()),
  demo: parseDocument(JSON.parse(readFileSync(join(root, "examples/demo.paprika.json"), "utf8"))),
  bezier: parseDocument(JSON.parse(readFileSync(join(root, "examples/bezier.paprika.json"), "utf8"))),
  diagram: diagram(),
  corners: corners(),
};

// ---- operation cases: [baseDoc, ops] ----
const R = (extra) => ({ op: "create", node: { type: "rect", id: "r", ...extra } });
const opCases = [
  ["themed", [{ op: "set_tokens", mode: "dark", tokens: { bg: null, fg: null, only: null, size: null } }]],
  ["themed", [{ op: "set_tokens", mode: "new", tokens: { fg: "#123", gone: null } }]],
  ["themed", [{ op: "set_tokens", mode: "bad mode", tokens: { fg: "#123" } }]],
  ["themed", [{ op: "update", id: "t-light", props: { mode: "dark" } }, { op: "update", id: "t-dark", props: { mode: "x y" } }]],
  ["themed", [{ op: "set_tokens", mode: "odd", tokens: { fg: null } }, { op: "set_tokens", mode: "dark", tokens: { bg: null, fg: null, only: null, size: null } }]],
  ["comp", [{ op: "create", node: { type: "frame", id: "px", instanceOf: "btn", overrides: JSON.parse('{"__proto__":{"text":"x"},"ok":{"fill":"#fff","bad-key":1,"__proto__":2}}') } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { "a b": {}, lbl: { text: "ok" } } } }]],
  ["comp", [{ op: "create", node: { type: "frame", id: "py", instanceOf: "btn", overrides: JSON.parse('{"__proto__":{"text":"x"},"lbl":{"text":"ok","__proto__":2}}') } }]],
  ["card", [{ op: "set_tokens", tokens: JSON.parse('{"__proto__":"#fff","ok":1}') }]],
  ["themed", [{ op: "set_tokens", mode: "__proto__", tokens: { fg: "#123" } }]],
  ["empty", [R({ layoutPositioning: "pinned" })]],
  ["empty", [R({ layoutPositioning: "absolute", x: 3, y: 4 })]],
  ["empty", [R({})]],
  ["empty", [R({ width: "big" })]],
  ["empty", [R({ width: -1 })]],
  ["empty", [R({ opacity: 2 })]],
  ["empty", [R({ fill: "red;" })]],
  ["empty", [R({ fill: "" })]],
  ["empty", [R({ stroke: { color: "#000" } })]],
  ["empty", [R({ stroke: { color: "#000", width: 1, extra: 1 } })]],
  ["empty", [R({ shadow: { x: 1 } })]],
  ["empty", [R({ x: "1", visible: 1, name: 5 })]],
  ["empty", [R({ width: 100001 })]],
  ["empty", [R({ text: "x" })]],
  ["empty", [R({ parentId: "x" })]],
  ["empty", [R({ children: [] })]],
  ["empty", [{ op: "create", node: { type: "rect", id: "a b" } }]],
  ["empty", [{ op: "create", node: { type: "bogus" } }]],
  ["empty", [{ op: "create", node: {} }]],
  ["empty", [{ op: "create", node: { type: "frame", id: "f", children: [{ type: "x" }] } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", fontWeight: 150.5 } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", fontWeight: 50 } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", textAlign: "middle" } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", fontSize: "big" } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", fontSize: "$text.md", text: "a\nb", letterSpacing: 1.5 } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", text: 5, color: 3 } }]],
  ["empty", [{ op: "create", node: { type: "text", id: "t", fontFamily: "x;background:url(http://evil)" } }]],
  ["empty", [{ op: "create", node: { type: "image", id: "i", src: "ftp://x" } }]],
  ["empty", [{ op: "create", node: { type: "image", id: "i" } }]],
  ["empty", [{ op: "create", node: { type: "image", id: "i", src: "https://e.x/a.png", alt: "  " } }]],
  ["empty", [{ op: "create", node: { type: "frame", id: "f", layout: { mode: "grid" } } }]],
  ["empty", [{ op: "create", node: { type: "frame", id: "f", layout: { padding: [1, 2] } } }]],
  ["empty", [{ op: "create", node: { type: "frame", id: "f", layout: { mode: "row", padding: [1, 2, 3, 4], wrap: true, justify: "between", align: "center" } } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p" } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "" } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0 C 10 10 20" } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0", viewBox: [0, 0, 0, 1] } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0", viewBox: [0, 0] } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M2 2 L22 22", viewBox: [0, 0, 24, 24], stroke: { color: "#000", width: 2 } } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "wave", d: "M0 40 C 30 -10 70 90 100 40", stroke: { color: "#c43d27", width: 4 } } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M40 30 L80 30 L60 70 Z", normalize: true, fill: "#c43d27" } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0 L10 10", width: null, height: 5 } }]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0 L10 10", shadow: { x: 1, y: 2, blur: 3, color: "#0008" } } }]],
  ["empty", [{ op: "x" }]],
  ["empty", [{ op: "update" }]],
  ["empty", [{ op: "move", id: "a" }]],
  ["empty", [{ op: "set_tokens", tokens: { "a b": 1 } }]],
  ["empty", [{ op: "set_tokens", tokens: { brand: "#c43d27", "text.md": 16, gone: null } }]],
  ["empty", [{ op: "rename_document", name: "" }]],
  ["empty", [{ op: "rename_document", name: "Novo nome" }]],
  ["empty", [{ ...R({}), index: -1 }]],
  ["empty", [{ ...R({}), index: 1.5 }]],
  ["empty", [5]],
  ["empty", [null]],
  ["card", [{ op: "update", id: "title", props: { text: "Mudou", fontSize: null, color: "#ff0000" } }]],
  ["card", [{ op: "update", id: "title", props: { colour: "#000" } }]],
  ["card", [{ op: "update", id: "title", props: { type: "rect" } }]],
  ["card", [{ op: "update", id: "title", props: { opacity: 2 } }]],
  ["card", [{ op: "update", id: "nao", props: { x: 1 } }]],
  ["card", [{ op: "update", id: "title", props: { text: "ok" } }, { op: "update", id: "nao", props: { x: 1 } }]],
  ["card", [{ op: "delete", id: "card" }]],
  ["card", [{ op: "delete", id: "bar" }]],
  ["card", [{ op: "delete", id: "nao" }]],
  ["card", [{ op: "move", id: "bar", parentId: null }]],
  ["card", [{ op: "move", id: "bar", parentId: "card", index: 0 }]],
  ["card", [{ op: "move", id: "card", parentId: "card" }]],
  ["card", [{ op: "move", id: "card", parentId: "bar" }]],
  ["card", [{ op: "move", id: "title", parentId: "nao" }]],
  ["card", [{ op: "create", parentId: "title", node: { type: "rect", id: "x" } }]],
  ["card", [{ op: "create", parentId: "card", index: 1, node: { type: "ellipse", id: "dot", fill: "$brand", stroke: { color: "$ink", width: 2 } } }]],
  ["card", [{ op: "create", node: { type: "rect", id: "title" } }]],
  ["card", [{ op: "create", parentId: "card", node: { type: "frame", id: "f2", clip: false, children: [{ type: "text", id: "t2", text: "{x} <y>" }, { type: "frame", id: "f3" }] } }]],
  ["card", [{ op: "set_tokens", tokens: { "10": "#000", b: 2, "2": "x", a: "#fff" } }]],
  ["card", [{ op: "restore", nodes: [{ type: "zz" }], rootId: "a", parentId: null, index: 0 }]],
  ["demo", [{ op: "update", id: "login", props: { x: 10, rotation: 12.345, opacity: 0.5, shadow: { x: 0, y: 4, blur: 12, color: "#0003" } } }]],
  // groups
  ["free", [{ op: "create", parentId: "board", node: { type: "group", id: "g", children: [{ type: "rect", id: "a", x: 33.3, y: 7.7, width: 10, height: 10, rotation: 45 }] } }]],
  ["free", [{ op: "create", node: { type: "group", id: "g", width: 5 } }]],
  ["free", [{ op: "create", node: { type: "group", id: "g", fill: "#000" } }]],
  ["free", [{ op: "create", node: { type: "group", id: "g", rotation: 5 } }]],
  ["free", [{ op: "create", parentId: "board", node: { type: "group", id: "g" } }]],
  ["free", [{ op: "create", parentId: "board", node: { type: "group", id: "g" } }, { op: "move", id: "t1", parentId: "g" }, { op: "move", id: "p1", parentId: "g" }]],
  ["grouped", [{ op: "update", id: "r1", props: { x: -10.5, y: -3 } }]],
  ["grouped", [{ op: "update", id: "g1", props: { x: 0, y: 0, opacity: 0.4, visible: false, name: "Movido" } }]],
  ["grouped", [{ op: "update", id: "g1", props: { width: 10 } }]],
  ["grouped", [{ op: "delete", id: "r1" }]],
  ["grouped", [{ op: "delete", id: "r1" }, { op: "delete", id: "e1" }]],
  ["grouped", [{ op: "move", id: "t1", parentId: "g1", index: 0 }]],
  ["grouped", [{ op: "move", id: "g1", parentId: null }]],
  ["grouped", [{ op: "create", parentId: "g1", node: { type: "frame", id: "inner", x: -20, y: 90, width: "hug", height: 10, children: [{ type: "rect", id: "x1" }] } }]],
  ["grouped", [{ op: "create", parentId: "g1", node: { type: "group", id: "g9", children: [{ type: "ellipse", id: "x2", x: 300, y: 300, width: 5, height: 5 }] } }]],
  // pages
  ["free", [{ op: "create", node: { type: "page", id: "pg" } }]],
  ["free", [{ op: "create", index: 0, node: { type: "page", id: "pg", name: "P", fill: "$paper" } }, { op: "move", id: "board", parentId: "pg" }]],
  ["free", [{ op: "create", parentId: "board", node: { type: "page", id: "pg" } }]],
  ["free", [{ op: "create", node: { type: "page", id: "pg", x: 1 } }]],
  ["paged", [{ op: "create", node: { type: "rect", id: "loose" } }]],
  ["paged", [{ op: "move", id: "board", parentId: null }]],
  ["paged", [{ op: "move", id: "pg2", parentId: "pg1" }]],
  ["paged", [{ op: "move", id: "pg2", parentId: null, index: 0 }]],
  ["paged", [{ op: "move", id: "board", parentId: "pg2" }]],
  ["paged", [{ op: "delete", id: "pg1" }]],
  ["paged", [{ op: "delete", id: "pg1" }, { op: "delete", id: "pg2" }, { op: "create", node: { type: "rect", id: "back" } }]],
  ["paged", [{ op: "update", id: "pg1", props: { name: "Home", fill: "#000", notes: "n" } }]],
  ["paged", [{ op: "update", id: "pg1", props: { x: 3 } }]],
  ["paged", [{ op: "restore", nodes: [{ type: "page", id: "pz", children: [] }], rootId: "pz", parentId: "board", index: 0 }]],
  // composite ops, expanded inside the transaction
  ["free", [{ op: "update", id: "r1", props: { x: 0 } }, { op: "group", ids: ["r1", "t1"], id: "g", name: "G" }]],
  ["free", [{ op: "group", ids: ["r1", "board"] }]],
  ["free", [{ op: "group", ids: [] }]],
  ["grouped", [{ op: "update", id: "g1", props: { x: 7, opacity: 0.5 } }, { op: "ungroup", ids: ["g1"] }]],
  ["grouped", [{ op: "ungroup", ids: ["r1"] }]],
  ["free", [{ op: "add_page", id: "p2", firstId: "p1", firstName: "Início", name: "Dois" }]],
  ["paged", [{ op: "add_page", id: "p3" }, { op: "create", parentId: "p3", node: { type: "rect", id: "r3" } }]],
  ["paged", [{ op: "add_page", id: "pg1" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "e1"], operation: "union", id: "cu" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "e1"], operation: "subtract", id: "cs" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "e1"], operation: "intersect", id: "ci" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "e1"], operation: "exclude", id: "ce" }]],
  ["free", [{ op: "combine_paths", ids: ["r1"], operation: "union" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "board"], operation: "union" }]],
  ["free", [{ op: "combine_paths", ids: ["r1", "t1"], operation: "union" }]],
  // components and instances
  ["comp", [{ op: "update", id: "lbl", props: { text: "Salvar", fontSize: 16 } }]],
  ["comp", [{ op: "update", id: "btn", props: { fill: "#000000", radius: 2, layout: { mode: "column", gap: 2 } } }]],
  ["comp", [{ op: "update", id: "i1", props: { scale: 2.5, x: 3 } }]],
  ["comp", [{ op: "update", id: "i1", props: { scale: 0.001 } }]],
  ["comp", [{ op: "update", id: "i1", props: { instanceOf: "badge" } }]],
  ["comp", [{ op: "update", id: "i1", props: { instanceOf: "board" } }]],
  ["comp", [{ op: "update", id: "i1", props: { instanceOf: "nada" } }]],
  ["comp", [{ op: "update", id: "i1", props: { width: 5, radius: 1 } }]],
  ["comp", [{ op: "update", id: "i1", props: { fill: "#00ff00", name: "Verde" } }]],
  ["comp", [{ op: "update", id: "i2", props: { fill: null } }]],
  ["comp", [{ op: "update", id: "i2", props: { fill: "#zzz;" } }]],
  ["comp", [{ op: "update", id: "i1", props: { component: true } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { lbl: { text: "Direto" }, nada: { text: "x" } } } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { lbl: { x: 4 } } } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { lbl: { opacity: 9 } } } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { btn: { fill: "#123456" } } } }]],
  ["comp", [{ op: "update", id: "i1", props: { overrides: { btn: { radius: 3 } } } }]],
  ["comp", [{ op: "update", id: copyId("i1", "lbl"), props: { text: "Ok", visible: false } }]],
  ["comp", [{ op: "update", id: copyId("i2", "lbl"), props: { text: null, color: "#ffffff" } }]],
  ["comp", [{ op: "update", id: copyId("i2", "lbl"), props: { color: 5 } }]],
  ["comp", [{ op: "update", id: copyId("i1", "lbl"), props: { x: 3, fontSize: 2 } }]],
  ["comp", [{ op: "update", id: copyId("i1", "ico"), props: { text: "x" } }]],
  ["comp", [{ op: "update", id: copyId("i1", "ico"), props: { sourceId: "x" } }]],
  ["comp", [{ op: "delete", id: copyId("i1", "lbl") }]],
  ["comp", [{ op: "move", id: copyId("i1", "lbl"), parentId: "board" }]],
  ["comp", [{ op: "move", id: "r1", parentId: "i1" }]],
  ["comp", [{ op: "move", id: "r1", parentId: copyId("i3", "bg") }]],
  ["comp", [{ op: "create", parentId: "i1", node: { type: "rect", id: "x" } }]],
  ["comp", [{ op: "create", parentId: "board", node: { type: "frame", id: "i4", instanceOf: "btn", children: [{ type: "rect", id: "x" }] } }]],
  ["comp", [{ op: "create", parentId: "board", node: { type: "rect", id: "x", sourceId: "lbl" } }]],
  ["comp", [{ op: "create", parentId: "board", node: { type: "frame", id: "a_really_long_instance_identifier_0123456789_abcdef", instanceOf: "badge", scale: 2 } }]],
  ["comp", [{ op: "create", parentId: "btn", node: { type: "frame", id: "i5", instanceOf: "badge" } }]],
  ["comp", [{ op: "delete", id: "btn" }]],
  ["comp", [{ op: "delete", id: "i1" }, { op: "delete", id: "i2" }, { op: "delete", id: "btn" }]],
  ["comp", [{ op: "update", id: "badge", props: { component: null } }]],
  ["comp", [{ op: "update", id: "dot", props: { x: -10, fill: "#00aa00" } }]],
  ["comp", [{ op: "delete", id: "bar" }, { op: "create", parentId: "badge", node: { type: "image", id: "img", src: "https://x.test/a.png", width: 10, height: 10 } }]],
  ["comp", [{ op: "group", ids: ["i1", "i2"], id: "gg" }, { op: "update", id: "i2", props: { scale: 3 } }]],
  ["comp", [{ op: "detach", ids: ["i2"] }]],
  ["comp", [{ op: "update", id: "lbl", props: { text: "Antes" } }, { op: "detach", ids: ["i1", "i1"] }, { op: "update", id: "lbl", props: { text: "Depois" } }]],
  ["comp", [{ op: "detach", ids: ["btn"] }]],
  ["comp", [{ op: "detach", ids: ["zz"] }]],
  ["comp", [{ op: "update", id: copyId("i1", "lbl"), props: { text: "Novo" } }, { op: "detach", ids: ["i1"] }, { op: "update", id: copyId("i1", "lbl"), props: { x: 1 } }]],
  // diagrams
  ["empty", [{ op: "create", node: { type: "shape", id: "s" } }, { op: "create", node: { type: "shape", id: "n", shape: "note", stroke: { color: "#000", width: 1 } } }]],
  ["empty", [{ op: "create", node: { type: "shape", id: "s", width: "hug" } }]],
  ["empty", [{ op: "create", node: { type: "shape", id: "s", shape: "star" } }]],
  ["empty", [{ op: "create", node: { type: "shape", id: "s", shape: 3, text: 4 } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c" } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 1 }, to: { x: 1, y: 2 } } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 1, y: 2, bogus: 1 }, to: { x: 1, y: 2 } } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { nodeId: "a b" }, to: { x: 1, y: 2 } } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, route: "spiral" } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, x: 3 } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 30, y: 40 }, route: "elbow", startArrow: "arrow", stroke: { color: "#c43d27", width: 0.5 } } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 80, y: 40 }, route: "rounded", radius: 12, endArrow: "none" } }]],
  ["empty", [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 80, y: 40 }, route: "curve", control: { x: 40, y: -30 } } }]],
  ["diagram", [{ op: "update", id: "no", props: { x: 333.3, y: 420.7 } }]],
  ["diagram", [{ op: "update", id: "ask", props: { shape: "rect", width: 40 } }, { op: "update", id: "yes", props: { shape: "ellipse" } }]],
  ["diagram", [{ op: "update", id: "ask-to-yes", props: { x: 1 } }]],
  ["diagram", [{ op: "update", id: "ask-to-yes", props: { route: "straight", from: { nodeId: "ask", side: "right" }, endArrow: "none" } }]],
  ["diagram", [{ op: "update", id: "ask-to-yes", props: { to: { nodeId: "ask-to-no" } } }]],
  ["diagram", [{ op: "update", id: "ask-to-yes", props: { to: { nodeId: "zz" } } }]],
  ["diagram", [{ op: "update", id: "ask-to-yes", props: { to: { nodeId: "ask-to-yes" } } }]],
  ["diagram", [{ op: "delete", id: "ask" }]],
  ["diagram", [{ op: "delete", id: "box" }]],
  ["diagram", [{ op: "delete", id: "c1" }]],
  ["diagram", [{ op: "delete", id: "ask" }, { op: "delete", id: "ask-to-yes" }]],
  ["diagram", [{ op: "delete", id: "ask" }, { op: "delete", id: "ask-to-yes" }, { op: "delete", id: "ask-to-yes" }]],
  ["diagram", [{ op: "delete", id: "ask-to-yes" }, { op: "delete", id: "ask-to-yes" }]],
  ["diagram", [{ op: "update", id: "c2", props: { x: 100, y: 40 } }]],
  ["diagram", [{ op: "move", id: "in2", parentId: null }, { op: "update", id: "box", props: { x: 50 } }]],
  ["diagram", [{ op: "ungroup", ids: ["gq"] }]],
  ["diagram", [{ op: "detach", ids: ["flowi"] }, { op: "update", id: "flow", props: { x: -100 } }]],
  ["diagram", [{ op: "update", id: copyId("flowi", "ck"), props: { visible: false } }]],
  // ---- z-order in one call: `index` in move and in update props (PAP-B-014) ----
  ["free", [{ op: "update", id: "r1", props: { index: "front" } }]],
  ["free", [{ op: "update", id: "p1", props: { index: "back", opacity: 0.5 } }]],
  ["free", [{ op: "update", id: "e1", props: { index: "forward" } }]],
  ["free", [{ op: "update", id: "e1", props: { index: "backward" } }]],
  ["free", [{ op: "update", id: "t1", props: { index: 2 } }]],
  ["free", [{ op: "update", id: "board", props: { index: "front" } }]], // único nó do topo: no-op
  ["free", [{ op: "update", id: "r1", props: { index: "sideways" } }]],
  ["free", [{ op: "update", id: "r1", props: { index: -1 } }]],
  ["free", [{ op: "update", id: "r1", props: { index: 1.5 } }]],
  ["free", [{ op: "update", id: "r1", props: { index: null } }]],
  ["free", [{ op: "move", id: "p1", parentId: "board", index: "forward" }]],
  ["free", [{ op: "move", id: "r1", parentId: "board", index: "backward" }]],
  ["grouped", [{ op: "update", id: "e1", props: { index: "front" } }]], // reordena dentro do group (fitGroups)
  ["grouped", [{ op: "move", id: "r1", parentId: "g1", index: "front" }]],
  ["paged", [{ op: "update", id: "pg1", props: { index: "front" } }]], // páginas reordenam no topo
  ["paged", [{ op: "update", id: "r2", props: { index: "forward" } }]], // dentro do group da página 2
  ["diagram", [{ op: "update", id: "k1", props: { index: "front" } }]], // conector reordenado, pontas seguem
  ["comp", [{ op: "update", id: copyId("i1", "lbl"), props: { index: "front" } }]], // cópia: recusa com copyRule
  ["comp", [{ op: "move", id: copyId("i1", "lbl"), parentId: "i1", index: "front" }]],
  ["diagram", [{ op: "update", id: copyId("flowi", "ck"), props: { index: "sideways" } }]], // inválido: direto, não copyRule
  ["empty", [{ op: "set_tokens", tokens: { brand: "#ff0000" } }, { op: "create", node: { type: "rect", id: "r", radius: "$brand" } }]],
  ["empty", [R({ radius: [8, 4, 0, 2] })]],
  ["empty", [R({ radius: [1, 2] })]],
  ["empty", [{ op: "create", node: { type: "ellipse", id: "e", radius: [1, 2, 3, 4] } }]],
  ["empty", [{ op: "set_tokens", tokens: { "radius.md": 12, brand: "#ff0000" } }, { op: "create", node: { type: "rect", id: "r", radius: ["$radius.md", "$brand", 0, 1] } }]],
  ["empty", [{ op: "set_tokens", tokens: { "text.huge": 2000 } }, { op: "create", node: { type: "text", id: "t", text: "a", fontSize: "$text.huge" } }]],
  ["empty", [{ op: "set_tokens", tokens: { "space.md": 8, "radius.md": 12 } }, { op: "create", node: { type: "frame", id: "f", radius: "$radius.md", stroke: { color: "#111", width: "$space.md" }, layout: { mode: "column", gap: "$space.md", padding: ["$space.md", 4, "$space.md", 4] }, children: [{ type: "text", id: "t", text: "a", fontSize: "$space.md", lineHeight: 1.4, letterSpacing: "$space.md" }] } }]],
  ["empty", [{ op: "create", place: "free", node: { type: "frame", id: "a", name: "A", width: 200, height: 100 } }, { op: "create", place: "free", node: { type: "frame", id: "b", name: "B", width: 200, height: 100 } }, { op: "create", place: "free", node: { type: "frame", id: "c", name: "C", width: 2200, height: 100 } }]],
  ["empty", [{ op: "create", node: { type: "frame", id: "light", name: "Light", x: 0, y: 0, width: 400, height: 300, fill: "#ffffff" } }, { op: "create", place: "none", node: { type: "frame", id: "dark", name: "Dark", x: 40, y: 40, width: 400, height: 300, fill: "#111111" } }]],
  ["free", [{ op: "create", place: "right", node: { type: "frame", id: "side", width: 100, height: 80 } }]],
  ["free", [{ op: "create", place: "below", node: { type: "frame", id: "under", width: 100, height: 80 } }]],
  ["free", [{ op: "create", place: { near: "board", side: "right" }, node: { type: "frame", id: "by", width: 50, height: 40 } }]],
  ["free", [{ op: "create", place: { near: "missing", side: "left" }, node: { type: "frame", id: "no", width: 10, height: 10 } }]],
  ["paged", [{ op: "create", place: "free", node: { type: "frame", id: "onpage", name: "On page", width: 80, height: 40 } }]],
  ["empty", [
    { op: "create", node: { type: "frame", id: "card", name: "Card", x: 0, y: 0, width: 220, height: 140, fill: "#f4f1ea", children: [{ type: "text", id: "label", x: 16, y: 16, width: 120, height: 24, text: "Landing page", color: "#111111" }] } },
    { op: "create", node: { type: "frame", id: "modal", name: "Delete", x: 8, y: 8, width: 200, height: 100, fill: "#ffffff" } },
    { op: "update", id: "modal", props: { index: "back" } },
  ]],
  ["empty", [R({
    shadow: [
      { x: 0, y: 8, blur: 16, spread: 0, color: "#00000055" },
      { x: 0, y: 2, blur: 6, color: "#4cc7d8", inner: true },
    ],
    outline: { color: "#4cc7d8", width: 2, style: "dashed", offset: 2 },
    filter: { blur: 1, saturate: 1.2, grayscale: 0, hueRotate: 15 },
    backdropFilter: { blur: 8 },
  })]],
  ["empty", [{ op: "create", node: { type: "path", id: "p", d: "M0 0 L10 10", shadow: [{ x: 1, y: 2, blur: 3, color: "#000" }, { x: 0, y: 0, blur: 4, color: "#fff", inner: true }] } }]],
  ["empty", [R({ filter: {} })]],
  ["empty", [R({ shadow: [] })]],
  ["empty", [R({ shadow: { x: 0, y: 1, blur: 2, color: "#000", inner: true } })]],
];

// ---- composite operations (groups, pages): the generated primitive ops ----
const structureCases = [
  ["free", "group", { ids: ["e1", "r1"], id: "g", name: "Par" }],
  ["free", "group", { ids: ["t1"], id: "g" }],
  ["free", "group", { ids: [] }],
  ["free", "group", { ids: ["zz", "r1", "yy"] }],
  ["free", "group", { ids: ["board", "r1"] }],
  ["card", "group", { ids: ["title"] }],
  ["paged", "group", { ids: ["pg1"] }],
  ["grouped", "ungroup", { ids: ["g1"] }],
  ["paged", "ungroup", { ids: ["g2", "g1", "g2"] }],
  ["grouped", "ungroup", { ids: ["r1"] }],
  ["grouped", "ungroup", { ids: ["nope"] }],
  ["grouped", "ungroup", { ids: [] }],
  ["free", "page", { id: "pn", name: "Nova", firstId: "pf" }],
  ["empty", "page", { id: "pn" }],
  ["paged", "page", { id: "pn" }],
  ["card", "duplicate", { ids: ["card"] }],
  ["card", "duplicate", { ids: ["card"], offset: 0, scale: 2, props: { fill: "#101010" } }],
  ["card", "duplicate", { ids: ["card"], parentId: null, offset: -12.5 }],
  ["card", "duplicate", { ids: ["card", "title", "card"] }],
  ["card", "duplicate", { ids: ["title", "bar"], offset: 10, scale: 0.5 }],
  ["themed", "duplicate", { ids: ["t-light"], offset: 680, props: { mode: "dark", name: "Tema dark" } }],
  ["free", "duplicate", { ids: ["e1", "r1"], scale: 1.5 }],
  ["free", "duplicate", { ids: ["p1"], scale: 2 }],
  ["grouped", "duplicate", { ids: ["g1"], scale: 2, offset: 5 }],
  ["paged", "duplicate", { ids: ["board"], parentId: "pg2", offset: 0 }],
  ["comp", "duplicate", { ids: ["i1"], scale: 2 }],
  ["comp", "duplicate", { ids: ["i1", "i2"], props: { name: "Cópia" } }],
  ["diagram", "duplicate", { ids: ["box"] }],
  ["diagram", "duplicate", { ids: ["box", "start"], scale: 2 }],
  ["diagram", "duplicate", { ids: ["start", "ask", "yes"], offset: 0 }],
  ["diagram", "duplicate", { ids: ["gq"], props: { opacity: 0.5 } }],
  ["diagram", "duplicate", { ids: ["flow"], scale: 0.5 }],
  ["diagram", "duplicate", { ids: ["flowi"], scale: 2 }],
  ["diagram", "duplicate", { ids: ["flowi", "flow"] }],
  ["diagram", "duplicate", { ids: ["k1"] }],
  ["paged", "duplicate", { ids: ["pg1"] }],
  ["comp", "duplicate", { ids: [copyId("i1", "lbl")] }],
  ["card", "duplicate", { ids: [] }],
  ["card", "duplicate", { ids: ["card", "zz", "yy"] }],
  ["card", "duplicate", { ids: ["card"], scale: 0 }],
  ["card", "duplicate", { ids: ["card"], scale: -2 }],
  ["card", "duplicate", { ids: ["card"], props: { id: "x", children: [] } }],
  ["card", "duplicate", { ids: ["card"], props: { width: 5 } }],
  ["card", "duplicate", { ids: ["card"], parentId: "nope" }],
  ["free", "combine", { ids: ["r1", "e1"], operation: "union", id: "cu" }],
  ["free", "combine", { ids: ["r1", "e1"], operation: "subtract", id: "cs" }],
  ["free", "combine", { ids: ["r1"], operation: "union" }],
];
const structure = structureCases.map(([docName, kind, args]) => {
  const d = docs[docName];
  const r = err(() => {
    if (kind === "group") {
      const p = groupOps(d, args.ids, { id: args.id, name: args.name });
      return { ops: p.ops, id: p.id };
    }
    if (kind === "ungroup") return ungroupOps(d, args.ids);
    if (kind === "duplicate") {
      const p = duplicateOps(d, args.ids, args);
      return { ops: p.ops, map: p.map };
    }
    if (kind === "combine") {
      const p = combinePathsOps(d, args.ids, { operation: args.operation, id: args.id, name: args.name });
      return { ops: p.ops, id: p.id };
    }
    const p = addPageOps(d, { id: args.id, name: args.name, firstId: args.firstId });
    return { ops: p.ops, id: p.id };
  });
  if (!r.ok) return { doc: docName, kind, args, ok: false, error: r.error };
  const applied = err(() => applyOps(d, r.value.ops));
  const pairs = Object.entries(r.value.map ?? {});
  const derived = applied.ok
    ? Object.values(applied.value.doc.nodes).flatMap((n) =>
        typeof n.sourceId === "string" ? pairs.filter(([, to]) => n.id === copyId(to, n.sourceId)).map(([from, to]) => [n.id, `@${from}~${n.sourceId}`]) : [])
    : [];
  const stable = (text) => [...derived, ...pairs.map(([from, to]) => [to, `@${from}`])].reduce((acc, [from, to]) => acc.split(from).join(to), text);
  return {
    doc: docName, kind, args, ok: true, ops: stable(JSON.stringify(r.value.ops)), id: r.value.id, released: r.value.released,
    result: applied.ok ? stable(json(applied.value.doc)) : undefined, applyError: applied.ok ? undefined : stable(applied.error),
  };
});

const opResults = opCases.map(([docName, ops]) => {
  const r = err(() => applyOps(docs[docName], ops));
  return r.ok
    ? { doc: docName, ops, ok: true, result: json(r.value.doc), inverse: JSON.stringify(r.value.inverse), created: r.value.created }
    : { doc: docName, ops, ok: false, error: r.error };
});

// ---- Op schema errors (ZodError#message, used by the WebSocket and /api/ops) ----
const zodCases = [{ op: "x" }, { op: "update", id: 1, props: {} }, 5, { op: "create", node: { type: "rect" }, index: -1 },
  { op: "set_tokens", tokens: { "a b": 1, ok: true } }, { op: "restore", nodes: [{ type: "zz" }], rootId: "a", parentId: null, index: 0 },
  { op: "rename_document", name: "x".repeat(201) }, { op: "move", id: "a", parentId: 3 }, { op: "group", ids: [] }, { op: "ungroup" },
  { op: "add_page", name: 3 }, { op: "move", id: "a", parentId: null, index: "sideways" }, { op: "move", id: "a", parentId: null, index: 1.5 },
  { op: "move", id: "a", parentId: null, index: 0 }, { op: "move", id: "a", parentId: null, index: "front" }];
// ---- draw_diagram plans ----
const diagramCases = [
  ["empty", { nodes: [{ id: "a", text: "A" }, { id: "b", shape: "note" }, { id: "c", shape: "diamond", width: 100, height: 100 }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "a", to: "c" }, { from: "c", to: "a", id: "back" }] }],
  ["empty", { direction: "right", gap: 30, x: 10, y: 20, nodes: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d", x: 5, y: 6 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "a" }] }],
  ["free", { nodes: [{ id: "a", text: "x" }], edges: [{ from: "a", to: "r1", fromSide: "left", toSide: "bottom", route: "straight", dashed: true }] }],
  ["free", { parentId: "board", nodes: [{ id: "a" }] }],
  ["paged", { nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b", id: "ab" }, { from: "a", to: "b", id: "ab" }] }],
  ["diagram", { nodes: [{ id: "x" }], edges: [{ from: "x", to: "start" }, { from: "x", to: "start" }] }],
  ["empty", { nodes: [] }],
  ["free", { nodes: [{ id: "r1" }] }],
  ["empty", { nodes: [{ id: "a" }, { id: "a" }] }],
  ["empty", { nodes: [{ id: "a" }], edges: [{ from: "a", to: "zz" }] }],
  ["free", { parentId: "r1", nodes: [{ id: "a" }] }],
  ["free", { parentId: "nope", nodes: [{ id: "a" }] }],
  ["empty", { nodes: [{ id: "" }] }],
];
const diagrams = diagramCases.map(([docName, input]) => {
  const r = err(() => diagramOps(docs[docName], input));
  if (!r.ok) return { doc: docName, input, ok: false, error: r.error };
  const applied = err(() => applyOps(docs[docName], r.value.ops));
  return { doc: docName, input, ok: true, plan: JSON.stringify(r.value), result: applied.ok ? json(applied.value.doc) : undefined, applyError: applied.ok ? undefined : applied.error };
});
const outlines = [
  ...["rect", "ellipse", "diamond", "note"].flatMap((shape) => [
    { shape, width: 160, height: 80, radius: 8, stroke: { color: "#000", width: 2 } },
    { shape, width: 30.5, height: 10, radius: 40 },
    { shape, width: 1, height: 1, radius: 0, stroke: { color: "#000", width: 5 } },
  ]),
].map((n) => ({ n, out: shapeOutline(n) }));

const zodResults = zodCases.map((input) => ({ input, error: Op.safeParse(input).error?.message ?? null }));

// ---- history ----
const history = (() => {
  const h = new History(docs.card);
  const steps = [];
  const snap = (label) => steps.push({ label, doc: json(h.doc), canUndo: h.canUndo, canRedo: h.canRedo });
  h.apply([{ op: "update", id: "title", props: { text: "A" } }], "user", "a");
  snap("apply a");
  h.apply([{ op: "delete", id: "bar" }, { op: "set_tokens", tokens: { ink: "#111" } }], "agent", "b");
  snap("apply b");
  h.undo();
  snap("undo");
  h.undo();
  snap("undo 2");
  h.redo();
  snap("redo");
  h.apply([{ op: "move", id: "title", parentId: null }], "user", "c");
  snap("apply c (clears redo)");
  h.undo();
  snap("undo c");
  return steps;
})();

// ---- views of every document (base docs + successful op results) ----
const viewDocs = { ...Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d])) };
opResults.forEach((r, i) => {
  if (r.ok) viewDocs[`op${i}`] = JSON.parse(r.result);
});
const views = Object.entries(viewDocs).map(([name, doc]) => {
  const ids = Object.keys(doc.nodes);
  return {
    name,
    doc: json(doc),
    outline: outline(doc),
    outlineDepth0: outline(doc, { depth: 0 }),
    outlineDepth1: outline(doc, { depth: 1 }),
    lint: JSON.stringify(lintDocument(doc)),
    lintRoots: Object.fromEntries(doc.rootIds.map((id) => [id, JSON.stringify(lintDocument(doc, { rootId: id }))])),
    html: renderHTML(doc).html,
    htmlRoots: Object.fromEntries(doc.rootIds.map((id) => [id, renderHTML(doc, { rootId: id, background: "transparent" }).html])),
    htmlPages: Object.fromEntries(doc.rootIds.filter((id) => doc.nodes[id].type === "page").map((id) => [id, renderHTML(doc, { rootId: id }).html])),
    react: Object.fromEntries(ids.map((id) => {
      const r = err(() => exportReact(doc, id));
      return [id, r.ok ? r.value : `ERROR: ${r.error}`];
    })),
    htmlVars: renderHTML(doc, { cssVariables: true }).html,
    htmlVarsRoots: Object.fromEntries(ids.map((id) => [id, renderHTML(doc, { rootId: id, cssVariables: true }).html])),
    reactVars: Object.fromEntries(ids.map((id) => {
      const r = err(() => exportReact(doc, id, { cssVariables: true }));
      return [id, r.ok ? r.value : `ERROR: ${r.error}`];
    })),
    tailwind: Object.fromEntries(ids.map((id) => {
      const r = err(() => exportTailwind(doc, id));
      return [id, r.ok ? r.value : `ERROR: ${r.error}`];
    })),
    tailwindVars: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportTailwind(doc, id, { cssVariables: true }));
      return [id, r.ok ? r.value : `ERROR: ${r.error}`];
    })),
    tailwindHtml: renderTailwindHTML(doc).html,
    tailwindHtmlVars: renderTailwindHTML(doc, { cssVariables: true }).html,
    tailwindHtmlRoots: Object.fromEntries(doc.rootIds.map((id) => [id, renderTailwindHTML(doc, { rootId: id, cssVariables: true }).html])),
    cssModules: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportCssModules(doc, id));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    cssModulesVars: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportCssModules(doc, id, { cssVariables: true }));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    angular: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportAngular(doc, id));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    angularVars: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportAngular(doc, id, { cssVariables: true }));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    svelte: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportSvelte(doc, id));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    svelteVars: Object.fromEntries(doc.rootIds.map((id) => {
      const r = err(() => exportSvelte(doc, id, { cssVariables: true }));
      return [id, r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error}`];
    })),
    frameworkHtml: renderFrameworkHTML(doc).html,
    frameworkHtmlVars: renderFrameworkHTML(doc, { cssVariables: true }).html,
    describe: Object.fromEntries(ids.map((id) => [id, describeNode(doc.nodes[id])])),
    style: Object.fromEntries(ids.map((id) => [id, cssToString(nodeStyle(doc, doc.nodes[id]))])),
    find: {
      text: queryNodes(doc, { type: "text" }).map((n) => n.id),
      nameA: queryNodes(doc, { name: "A", limit: 3 }).map((n) => n.id),
      textE: queryNodes(doc, { text: "E" }).map((n) => n.id),
      within: doc.rootIds[0] ? queryNodes(doc, { within: doc.rootIds[0] }).map((n) => n.id) : [],
    },
  };
});

// ---- path ----
const pathCases = [
  "m10 10 20 0 h10 v10 c0 10 10 10 10 0 s10 -10 10 0 q5 5 10 0 t10 0 z",
  "M0,0A5 5 0 1110 0L.5.5-1e1-2",
  "L 0 0", "M0 0 C 1 2 3", "M0 0 X 1", "M0 0 Z 4", "M0 0 A 1 1 0 2 0 3 3", "M0 0 L 1 1 url(#x)", "M0 0 C 0 -10 10 -10 10 0",
  "M0 0 C 0 -40 100 -40 100 0", "M0 0 Q 50 100 100 0", "M0 50 A 50 50 0 0 1 100 50", "M10 10 A 30 20 45 1 0 80 60 Z",
  "M0 0 L 1e8 0", "", "   ", "M 1. 2.5e1 l -3.25 .75 Z m 5 5 h 1", "M0 0 A 0 5 0 0 1 10 10", "M0 0 L 3 4 5", "M0 0 L 1 1",
  "M12 2 C 6.48 2 2 6.48 2 12 s 4.48 10 10 10 10 -4.48 10 -10 S 17.52 2 12 2 z",
];
const paths = pathCases.map((d) => {
  const e = pathError(d);
  if (e) return { d, error: e };
  const segs = parsePath(d);
  return { d, normalized: serializePath(segs), bounds: pathBounds(segs), cmds: segs.map((s) => s.cmd).join("") };
});

// ---- colors ----
const colors = ["#fff", "#ffffff80", "#abcd", "rgb(1, 2, 3)", "rgba(10 20 30 / 50%)", "rgba(1,2,3,0.25)", "white", " Black ", "transparent",
  "#12345", "linear-gradient(red, blue)", "hsl(1 2 3)"].map((c) => ({ c, rgba: parseColor(c) ?? null }));
const contrast = [["#777777", "#ffffff"], ["#000000", "#ffffff"], ["#c43d27", "#fbf8f4"]].map(([a, b]) => ({ a, b, ratio: contrastRatio(parseColor(a), parseColor(b)), fixed: contrastRatio(parseColor(a), parseColor(b)).toFixed(2) }));

// ---- invalid documents ----
const badDocs = [
  {},
  { format: "paprika/2", id: "x" },
  { format: "paprika/1", id: "x", rootIds: ["a"] },
  { format: "paprika/1", id: "x", nodes: { a: { type: "rect", id: "a" } } },
  { format: "paprika/1", id: "x", rootIds: ["a", "a"], nodes: { a: { type: "rect", id: "a" } } },
  { format: "paprika/1", id: "x", rootIds: ["a"], nodes: { a: { type: "rect", id: "a", parentId: "z" } } },
  { format: "paprika/1", id: "x", tokens: { "bad key": 1, ok: [] } },
].map((input) => {
  const r = err(() => parseDocument(input));
  return { input, ok: r.ok, error: r.ok ? undefined : r.error, doc: r.ok ? json(r.value) : undefined };
});

// ---- randomized sequences through History (seeded, so the fixture is stable) ----
function rng(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const randomRuns = [];
// Runs 25+ start from documents with groups and pages and also create groups and pages.
const runBase = (run) => (run < 25 ? (run % 2 ? "demo" : "bezier") : run >= 45 ? "diagram" : run >= 35 ? "comp" : run % 2 ? "paged" : "grouped");
for (let run = 0; run < 52; run++) {
  const rand = rng(run + 1);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const h = new History(docs[runBase(run)]);
  const extra = run >= 25;
  const steps = [];
  let n = 0;
  for (let k = 0; k < 20; k++) {
    const ids = Object.keys(h.doc.nodes);
    const frames = ids.filter((id) => (extra ? ["frame", "group", "page"] : ["frame"]).includes(h.doc.nodes[id].type));
    const r = rand();
    let step;
    if (r < 0.12) step = { kind: "undo" };
    else if (r < 0.2) step = { kind: "redo" };
    else {
      const id = pick(ids);
      const ops = [];
      const count = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < count; j++) {
        const t = rand();
        if (t < 0.25) ops.push({ op: "create", parentId: rand() < 0.7 ? pick(frames) ?? null : null, ...(rand() < 0.3 ? { index: Math.floor(rand() * 4) } : {}),
          node: pick([{ type: "rect", id: `n${run}_${n++}`, width: Math.round(rand() * 200), fill: pick(["#ff0000", "$brand", "$paper", "rgba(0,0,0,0.5)"]) },
            { type: "text", id: `n${run}_${n++}`, text: pick(["Olá", "", "Texto longo ".repeat(8)]), fontSize: pick([10, 16, 24, "$text.md"]), color: pick(["$ink", "#777", "#fff"]) },
            { type: "path", id: `n${run}_${n++}`, d: pick(["M0 0 L10 10", "M0 0 C 0 -40 100 -40 100 0", "M0 0 Q 50 100 100 0 Z", "M0 0 C 1"]) },
            { type: "frame", id: `n${run}_${n++}`, layout: { mode: pick(["row", "column", "none"]), gap: 4 }, children: [{ type: "ellipse", id: `n${run}_${n++}` }] },
            ...(extra ? [{ type: "group", id: `n${run}_${n++}`, children: [{ type: "rect", id: `n${run}_${n++}`, x: -7.5, y: 12, width: 9, height: 4, rotation: 15 }] },
              { type: "page", id: `n${run}_${n++}`, name: "Pg" }] : []),
            ...(run >= 45 ? [{ type: "shape", id: `n${run}_${n++}`, shape: pick(["rect", "ellipse", "diamond", "note"]), text: pick(["", "Oi", "Dois\nlinhas"]), x: Math.round(rand() * 400), y: Math.round(rand() * 300) },
              { type: "connector", id: `n${run}_${n++}`, from: { nodeId: pick(ids) }, to: pick([{ nodeId: pick(ids), side: pick(["auto", "top", "left"]) }, { x: 10, y: -20 }]), route: pick(["straight", "elbow"]) }] : [])]) });
        else if (t < 0.5) ops.push({ op: "update", id, props: pick([{ x: Math.round(rand() * 500) - 50 }, { name: "Renomeado" }, { fill: null }, { opacity: rand() }, { width: "fill" }, { visible: false }, { bogus: 1 },
          { index: pick(["front", "back", "forward", "backward"]) }, { index: Math.floor(rand() * 3) },
          ...(extra ? [{ y: -Math.round(rand() * 80) }, { rotation: Math.round(rand() * 90) }] : []),
          ...(run >= 35 ? [{ scale: pick([0.5, 2, 1.25]) }, { text: "Trocado" }, { color: "#00ff00" }, { component: true }, { instanceOf: pick(["btn", "badge"]) }] : [])]) });
        else if (run >= 35 && t < 0.55) ops.push(pick([{ op: "detach", ids: [pick(["i1", "i2", "i3", id])] },
          { op: "create", parentId: pick(frames) ?? null, node: { type: "frame", id: `n${run}_${n++}`, instanceOf: pick(["btn", "badge"]), scale: pick([1, 2]) } }]));
        else if (t < 0.65) ops.push({ op: "delete", id: pick(ids) });
        else if (t < 0.85) ops.push({ op: "move", id, parentId: rand() < 0.3 ? null : pick(frames) ?? null, ...(rand() < 0.5 ? { index: pick([0, 1, 2, "front", "back", "forward", "backward"]) } : {}) });
        else ops.push({ op: "set_tokens", tokens: { [pick(["brand", "ink", "novo", "10"])]: pick(["#123456", 12, null]) } });
      }
      step = { kind: "apply", ops };
    }
    const res = err(() => (step.kind === "undo" ? h.undo() : step.kind === "redo" ? h.redo() : h.apply(step.ops, "fuzz", "")));
    steps.push({ ...step, error: res.ok ? undefined : res.error, sha256: sha(json(h.doc)), canUndo: h.canUndo, canRedo: h.canRedo });
  }
  randomRuns.push({ base: runBase(run), steps });
}

// ---- import SVG/HTML and export SVG ----
const svgCases = [
  ['<svg viewBox="0 0 24 24" width="48" height="48"><path d="M2 2 L22 2 L12 20 Z" fill="#c43d27"/></svg>', {}],
  ['<svg xmlns="http://www.w3.org/2000/svg"><title>Ícone</title><rect x="1" y="2" width="30" height="20" rx="4" fill="#ff0000" stroke="#000" stroke-width="2"/><circle cx="10" cy="10" r="5" fill-opacity="0.5" fill="#00ff00"/></svg>', { x: 100, y: 50 }],
  ['<svg><g transform="rotate(30 10 10)" fill="blue"><rect width="20" height="10"/><ellipse cx="5" cy="5" rx="4" ry="2"/></g></svg>', {}],
  ['<svg><g id="grupo" opacity="0.5" transform="translate(5,5) scale(2)"><line x1="0" y1="0" x2="10" y2="10" stroke="red" stroke-linecap="round"/><polyline points="0,0 5,5 10,0" fill="none" stroke="#333" stroke-linejoin="bevel"/></g><polygon points="0 0 10 0 5 8" fill-rule="evenodd"/></svg>', { name: "Meu SVG" }],
  ['<svg><path d="M0 0 A10 10 0 0 1 20 0 A5 8 30 1 0 30 10 Z" transform="skewX(10) matrix(1 0 0 1 3 4)" stroke="currentColor"/></svg>', {}],
  ['<svg><defs><linearGradient id="g"/></defs><style>.a{fill:red}</style><rect width="10" height="10" fill="url(#g)" style="stroke: #123; stroke-width: 3"/><text>oi</text><image href="x.png"/><rect width="5" height="5" display="none"/><path d="M0 0 L" /><path d="M0 0 L5 5" clip-path="url(#c)" transform="bogus(1)"/></svg>', {}],
  ['<svg viewBox="10 10 100 50" width="200" height="200"><svg x="5" y="5"><rect x="10" y="10" width="20" height="20" rx="3" ry="6"/></svg><rect x="20" y="20" width="10" height="10" transform="scale(2 1)" rx="2"/></svg>', {}],
  ['<div>sem svg</div>', {}],
  ['<svg><g><g></g></g></svg>', {}],
  ['<svg opacity="0.4"><rect width="1" height="1" fill="rgba(1,2,3,0.5)" fill-opacity=".5" stroke="#abc" stroke-opacity="0.2"/></svg>', {}],
  ['<SVG><RECT WIDTH="4" HEIGHT="4" FILL="#fff"/><!-- c --><![CDATA[x]]><?pi?></SVG>', {}],
];
const htmlCases = [
  '<div style="display: flex; flex-direction: column; gap: 8px; padding: 16px 24px; background: #fff; border-radius: 8px; width: 320px"><h1>Título</h1><p style="color: #555; font-size: 14px; line-height: 20px">Um parágrafo <b>com negrito</b><br>e quebra.</p><button style="background: #c43d27; color: white; padding: 8px 16px; border-radius: 6px; text-align: center">Entrar</button><img src="https://x.test/a.png" width="40" height="30" alt="a"></div>',
  '<body><section class="x" style="position: absolute; left: 10px; top: 20px; width: 100px; height: 50px; opacity: 0.5; box-shadow: 0px 2px 4px 1px rgba(0,0,0,.2); border: 1px solid #ddd; transform: rotate(15deg)"><span style="font-weight: 600; letter-spacing: 1px; white-space: pre">  pre  texto </span></section><svg viewBox="0 0 10 10" width="20" height="20"><circle cx="5" cy="5" r="5"/></svg><script>x()</script></body>',
  '<div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap"><div style="flex: 1; height: 100%">a</div><div style="width: 50%; align-self: stretch">b</div><div style="width: max-content; font-size: 2em">c</div><img src="javascript:alert(1)"></div>',
  '<div style="display:flex; gap:8px"><span>Olá</span><span>mundo</span></div>',
  'texto solto',
  '',
  '<div data-paprika-type="rect" style="position:absolute;left:0px;top:0px;width:100px;height:80px;background:#fff;box-shadow:0px 8px 16px 0px #00000055, inset 0px 2px 4px 0px #4cc7d8;outline:2px dashed #4cc7d8;outline-offset:2px;filter:blur(1px) saturate(1.2) hue-rotate(15deg);backdrop-filter:blur(8px)"></div>',
];
for (const [name, doc] of Object.entries(docs)) {
  htmlCases.push(renderHTML(doc).html);
  for (const id of doc.rootIds) htmlCases.push(renderHTML(doc, { rootId: id }).html);
  void name;
}
const imports = {
  svg: svgCases.map(([src, opts]) => ({ src, opts, result: err(() => JSON.stringify(importSVG(src, opts))) })),
  html: htmlCases.map((src) => ({ src, result: err(() => JSON.stringify(importHTML(src, { x: src.length % 3, y: 0 }))) })),
};
const fakeMeasure = (doc) => {
  const boxes = {};
  const lines = {};
  Object.keys(doc.nodes).forEach((id, i) => {
    if (i % 7 === 6) return; // some nodes stay unmeasured (hidden)
    boxes[id] = [i * 10.123, i * 5.5, 50 + i, 20 + i / 3];
    const n = doc.nodes[id];
    if ((n.type === "text" || n.type === "shape") && i % 2) lines[id] = [{ t: n.text.slice(0, 5), x: 1.5, y: 12.25 }, { t: "<&>", x: 0, y: 30 }];
  });
  return { boxes, lines };
};
const svgExports = Object.entries(docs).map(([name, doc]) => {
  const targets = [undefined, ...Object.keys(doc.nodes)];
  const measure = fakeMeasure(doc);
  return {
    name,
    plain: Object.fromEntries(targets.map((id) => [id ?? "", err(() => JSON.stringify(exportSVG(doc, { rootId: id })))])),
    measured: Object.fromEntries(targets.map((id) => [id ?? "", err(() => JSON.stringify(exportSVG(doc, { rootId: id, measure })))])),
    measure: JSON.stringify(measure),
  };
});

const tailwindMapCases = [
  ["boxSizing", "border-box"], ["boxSizing", "content-box"], ["boxSizing", "initial"], ["position", "absolute"], ["position", "weird"],
  ["left", "0px"], ["top", "calc(1px + 2px)"], ["width", "100%"], ["width", "fit-content"], ["width", "320px"], ["height", "auto"],
  ["minWidth", "0"], ["minHeight", "0px"], ["minWidth", "10px"], ["maxWidth", "50%"], ["maxHeight", "9px"], ["flex", "1 1 0"],
  ["flexShrink", 0], ["flexShrink", 2], ["flexGrow", 1], ["flexGrow", "2"], ["alignItems", "center"], ["alignItems", "weird"],
  ["alignSelf", "auto"], ["justifyContent", "space-evenly"], ["flexDirection", "column-reverse"], ["flexWrap", "wrap"], ["flexWrap", "wrap-reverse"],
  ["gap", "8px"], ["padding", "16px"], ["padding", "1px 2px"], ["padding", "1px 2px 3px 4px"], ["padding", "1px 2px 3px"], ["padding", "  4px  "],
  ["margin", 0], ["margin", "auto"], ["display", "none"], ["display", "table"], ["opacity", 0.5], ["transform", "rotate(-12.5deg)"], ["transform", "scale(2)"],
  ["background", "var(--bg)"], ["background", "rgba(0, 0, 0, 0.5)"], ["backgroundColor", "#fff"], ["border", "1px solid #c43d27"], ["border", "2px dashed red"],
  ["border", "1px groove red"], ["border", "thin solid red"], ["borderRadius", "50%"], ["boxShadow", "0px 2px 4px 0px rgba(0,0,0,.2)"],
  ["filter", "drop-shadow(0px 1px 2px #000)"], ["filter", "blur(2px)"], ["overflow", "hidden"], ["overflow", "clip"], ["color", "#111"],
  ["fontFamily", "Inter, sans-serif"], ["fontFamily", "a_b c"], ["fontFamily", "a]b"], ["fontFamily", "a;b"], ["fontSize", "16px"], ["fontWeight", "normal"],
  ["fontWeight", "bold"], ["fontWeight", 600], ["lineHeight", 1.4], ["letterSpacing", "0.5px"], ["textAlign", "justify"], ["textAlign", "weird"],
  ["whiteSpace", "pre-wrap"], ["overflowWrap", "anywhere"], ["overflowWrap", "break-word"], ["overflowWrap", "normal"], ["objectFit", "scale-down"],
  ["objectFit", "weird"], ["unknownProp", "1"],
].map(([key, value]) => ({ key, value, classes: tailwindClassesFor(key, value) ?? null }));

const stableLayout = (doc, opts) => {
  const boxes = layout(doc, opts);
  return JSON.stringify(Object.fromEntries(Object.keys(boxes).sort((a, b) => a.localeCompare(b)).map((id) => [id, boxes[id]])));
};
const layouts = Object.entries(docs).map(([name, doc]) => ({
  name,
  layout: err(() => stableLayout(doc)),
  byRoot: Object.fromEntries(
    doc.rootIds.slice(0, 8).map((id) => [id, err(() => stableLayout(doc, { rootId: id }))]),
  ),
}));
const textMetrics = [
  { text: "Olá", fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
  { text: "Olá", fontSize: 32, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
  { text: "a\nb", fontSize: 10, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
  { text: "wrap me please", fontSize: 14, fontWeight: 600, lineHeight: 1.2, letterSpacing: 0.5, maxWidth: 40 },
  { text: "", fontSize: 12, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
].map((c) => ({
  ...c,
  fontAvg: FONT_AVG,
  result: measureText(c.text, c.fontSize, {
    fontWeight: c.fontWeight,
    lineHeight: c.lineHeight,
    letterSpacing: c.letterSpacing,
    maxWidth: c.maxWidth,
  }),
}));
const pathNorm = ["M40 30 L80 30 L60 70 Z", "M0 0 L10 10", "M10 10 C 20 0 30 0 40 10"].map((d) => {
  const segs = parsePath(d);
  const n = normalizePath(segs);
  return { d, origin: pathOrigin(segs), normalized: serializePath(n.segs), bounds: n.bounds };
});

const out = { randomRuns, structure, opResults, diagrams, outlines, zodResults, history, views, paths, colors, contrast, badDocs, imports, svgExports, layouts, textMetrics, pathNorm, created: createDocument("Untitled", "abc"), tailwindMapCases };
const dest = join(here, "../internal/core/testdata/golden.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
console.log(`golden: ${opResults.length} op cases, ${views.length} documents, ${paths.length} paths, ${layouts.length} layouts → ${dest}`);
void Document;
