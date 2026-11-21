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
  applyOps, createDocument, parseDocument, History, outline, describeNode, lintDocument, renderHTML,
  exportReact, nodeStyle, cssToString, queryNodes, parsePath, pathBounds, serializePath, pathError,
  parseColor, contrastRatio, Op, Document,
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

const docs = {
  empty: base(),
  card: card(),
  demo: parseDocument(JSON.parse(readFileSync(join(root, "examples/demo.paprika.json"), "utf8"))),
  bezier: parseDocument(JSON.parse(readFileSync(join(root, "examples/bezier.paprika.json"), "utf8"))),
};

// ---- operation cases: [baseDoc, ops] ----
const R = (extra) => ({ op: "create", node: { type: "rect", id: "r", ...extra } });
const opCases = [
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
];

const opResults = opCases.map(([docName, ops]) => {
  const r = err(() => applyOps(docs[docName], ops));
  return r.ok
    ? { doc: docName, ops, ok: true, result: json(r.value.doc), inverse: JSON.stringify(r.value.inverse), created: r.value.created }
    : { doc: docName, ops, ok: false, error: r.error };
});

// ---- Op schema errors (ZodError#message, used by the WebSocket and /api/ops) ----
const zodCases = [{ op: "x" }, { op: "update", id: 1, props: {} }, 5, { op: "create", node: { type: "rect" }, index: -1 },
  { op: "set_tokens", tokens: { "a b": 1, ok: true } }, { op: "restore", nodes: [{ type: "zz" }], rootId: "a", parentId: null, index: 0 },
  { op: "rename_document", name: "x".repeat(201) }, { op: "move", id: "a", parentId: 3 }];
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
    react: Object.fromEntries(ids.map((id) => [id, exportReact(doc, id)])),
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
for (let run = 0; run < 25; run++) {
  const rand = rng(run + 1);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const h = new History(run % 2 ? docs.demo : docs.bezier);
  const steps = [];
  let n = 0;
  for (let k = 0; k < 20; k++) {
    const ids = Object.keys(h.doc.nodes);
    const frames = ids.filter((id) => h.doc.nodes[id].type === "frame");
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
            { type: "frame", id: `n${run}_${n++}`, layout: { mode: pick(["row", "column", "none"]), gap: 4 }, children: [{ type: "ellipse", id: `n${run}_${n++}` }] }]) });
        else if (t < 0.5) ops.push({ op: "update", id, props: pick([{ x: Math.round(rand() * 500) - 50 }, { name: "Renomeado" }, { fill: null }, { opacity: rand() }, { width: "fill" }, { visible: false }, { bogus: 1 }]) });
        else if (t < 0.65) ops.push({ op: "delete", id: pick(ids) });
        else if (t < 0.85) ops.push({ op: "move", id, parentId: rand() < 0.3 ? null : pick(frames) ?? null, ...(rand() < 0.5 ? { index: Math.floor(rand() * 3) } : {}) });
        else ops.push({ op: "set_tokens", tokens: { [pick(["brand", "ink", "novo", "10"])]: pick(["#123456", 12, null]) } });
      }
      step = { kind: "apply", ops };
    }
    const res = err(() => (step.kind === "undo" ? h.undo() : step.kind === "redo" ? h.redo() : h.apply(step.ops, "fuzz", "")));
    steps.push({ ...step, error: res.ok ? undefined : res.error, sha256: sha(json(h.doc)), canUndo: h.canUndo, canRedo: h.canRedo });
  }
  randomRuns.push({ base: run % 2 ? "demo" : "bezier", steps });
}

const out = { randomRuns, opResults, zodResults, history, views, paths, colors, contrast, badDocs, created: createDocument("Sem título", "abc") };
const dest = join(here, "../internal/core/testdata/golden.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
console.log(`golden: ${opResults.length} op cases, ${views.length} documents, ${paths.length} paths → ${dest}`);
void Document;
