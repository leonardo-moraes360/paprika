#!/usr/bin/env node
// Checker for the `fix-lint-findings` benchmark task: the starting document ships with real design
// defects, and the agent has to fix them in place.
//
// Usage: node bench/tasks/fix-lint-findings/check.mjs <document.paprika.json>
// Exit 0 when every finding is gone, 1 otherwise.
//
// The document is not rebuilt from scratch: the task says to repair it, so the node ids and the
// canvas size are pinned here. Changing them is a failed run, not a creative answer.
import { Report, backgroundOf, byId, contrastRatio, loadDocument, nodesOf, numeric, resolve, textNodes } from "../lib.mjs";

const MIN_FONT = 12;
const MIN_ALT_LENGTH = 3;
const TOLERANCE = 1;
const AA = 4.5;

/** Nodes the starting document already has; the fix keeps them (types included). */
const REQUIRED = [
  ["hero", "frame"],
  ["headline", "text"],
  ["sub", "text"],
  ["caption", "text"],
  ["logo", "image"],
  ["accent", "rect"],
  ["cta", "frame"],
  ["cta-label", "text"],
];

/** The canvas the task starts with; the fix must not resize it. */
const CANVAS = { id: "hero", width: 800, height: 400 };

const report = new Report("fix-lint-findings");
const argv = process.argv[2];
if (!argv) {
  report.fail("usage: check.mjs <document.paprika.json>");
  process.exit(report.print());
}
const doc = loadDocument(argv, report);
if (!doc) process.exit(report.print());

const missing = REQUIRED.filter(([id, type]) => byId(doc, id)?.type !== type);
report.check("the document still has the nodes it started with", missing.length === 0, missing.map(([id, type]) => `${id}(${type})`).join(", "));
if (missing.length) process.exit(report.print());

const canvas = byId(doc, CANVAS.id);
report.check(
  `the canvas keeps its ${CANVAS.width}x${CANVAS.height} size`,
  numeric(canvas.width) === CANVAS.width && numeric(canvas.height) === CANVAS.height,
  `${canvas.width} x ${canvas.height}`,
);

const small = textNodes(doc).filter((node) => !Number.isFinite(smallSize(node, doc)) || smallSize(node, doc) < MIN_FONT);
report.check(`no text is smaller than ${MIN_FONT}px`, small.length === 0, small.map((t) => `${t.id}:${resolve(t.fontSize, doc.tokens)}`).join(", "));

const low = textNodes(doc)
  .map((node) => ({ node, ratio: contrastRatio(resolve(node.color, doc.tokens), backgroundOf(doc, node)) }))
  .filter(({ node, ratio }) => node.visible !== false && backgroundOf(doc, node) !== null && resolve(node.color, doc.tokens) !== undefined && (ratio === null || ratio < AA));
report.check("every text reaches WCAG AA contrast against its background", low.length === 0, low.map(({ node, ratio }) => `${node.id}:${ratio === null ? "unresolved" : ratio.toFixed(2)}`).join(", "));

const blankAlt = nodesOf(doc).filter((node) => node.type === "image" && (node.alt ?? "").trim().length < MIN_ALT_LENGTH);
report.check("every image has alt text", blankAlt.length === 0, blankAlt.map((n) => n.id).join(", "));

const overflowing = nodesOf(doc)
  .filter((node) => node.parentId)
  .map((node) => ({ node, parent: byId(doc, node.parentId) }))
  .filter(({ parent }) => parent)
  .filter(({ node, parent }) => {
    const w = numeric(node.width);
    const h = numeric(node.height);
    const pw = numeric(parent.width);
    const ph = numeric(parent.height);
    if (w === null || h === null || pw === null || ph === null) return false;
    return node.x < -TOLERANCE || node.y < -TOLERANCE || node.x + w > pw + TOLERANCE || node.y + h > ph + TOLERANCE;
  });
report.check("nothing hangs out of its parent", overflowing.length === 0, overflowing.map(({ node, parent }) => `${node.id} in ${parent.id}`).join(", "));

const tokenValues = new Map(Object.entries(doc.tokens ?? {}).map(([name, value]) => [typeof value === "string" ? value.toLowerCase() : String(value), name]));
const hardcoded = nodesOf(doc)
  .flatMap((node) => [
    { node, field: "fill", value: node.fill },
    { node, field: "color", value: node.color },
    { node, field: "stroke.color", value: node.stroke?.color },
  ])
  .filter(({ value }) => typeof value === "string" && !value.startsWith("$") && tokenValues.has(value.toLowerCase()));
report.check("a color that exists as a token is referenced through that token", hardcoded.length === 0, hardcoded.map(({ node, field, value }) => `${node.id}.${field}=${value} ($${tokenValues.get(value.toLowerCase())})`).join(", "));

const unresolved = nodesOf(doc)
  .flatMap((node) => [node.fill, node.color, node.stroke?.color])
  .filter((value) => typeof value === "string" && value.startsWith("$") && resolve(value, doc.tokens) === undefined);
report.check("every token reference resolves", unresolved.length === 0, unresolved.join(", "));

function smallSize(node, document) {
  const size = resolve(node.fontSize, document.tokens);
  return typeof size === "number" ? size : Number.NaN;
}

process.exit(report.print());
