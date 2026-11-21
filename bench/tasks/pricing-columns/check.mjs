#!/usr/bin/env node
// Checker for the `pricing-columns` benchmark task: a three-column pricing section built with
// auto-layout instead of hand-placed coordinates.
//
// Usage: node bench/tasks/pricing-columns/check.mjs <document.paprika.json>
// Exit 0 when every rule in task.yaml is satisfied, 1 otherwise.
//
// Positions are not checked on purpose: an auto-layout frame decides where its children go, so the
// stored x/y of a laid-out child is meaningless. What is checked is the layout configuration, the
// content of each column and the colors.
import { Report, backgroundOf, byId, childrenOf, contrastRatio, descendants, loadDocument, nodesOf, numeric, resolve, textNodes } from "../lib.mjs";

const MIN_WIDTH = 900;
const MIN_COLUMN_GAP = 16;
const MIN_COLUMN_PADDING = 12;
const MIN_TEXTS_PER_COLUMN = 5;
const PRICE_MIN_FONT = 28;
const MIN_FONT = 12;

const report = new Report("pricing-columns");
const argv = process.argv[2];
if (!argv) {
  report.fail("usage: check.mjs <document.paprika.json>");
  process.exit(report.print());
}
const doc = loadDocument(argv, report);
if (!doc) process.exit(report.print());

const roots = (doc.rootIds ?? []).map((id) => byId(doc, id)).filter(Boolean);
const frame = roots.length === 1 && roots[0].type === "frame" ? roots[0] : null;
report.check("exactly one root frame", frame !== null, `roots: ${roots.map((r) => r.id).join(", ") || "none"}`);
if (!frame) process.exit(report.print());

report.check(
  "the section lays its children out in a row, with gap and padding",
  frame.layout?.mode === "row" && (frame.layout?.gap ?? 0) >= MIN_COLUMN_GAP && paddingAtLeast(frame.layout, MIN_COLUMN_PADDING) && (numeric(frame.width) ?? 0) >= MIN_WIDTH,
  `width ${frame.width}, layout ${JSON.stringify(frame.layout ?? null)}`,
);

const columns = childrenOf(doc, frame).filter((node) => node.type === "frame");
report.check("the row holds exactly three columns", columns.length === 3, `${columns.length} columns`);
if (columns.length !== 3) process.exit(report.print());

const laidOut = columns.filter((column) => column.layout?.mode === "column" && (column.layout?.gap ?? 0) > 0 && paddingAtLeast(column.layout, MIN_COLUMN_PADDING));
report.check("every column stacks its children in a column with gap and padding", laidOut.length === 3, `${laidOut.length}/3`);

const widths = columns.map((column) => column.width);
const sameWidth = widths.every((w) => w === widths[0]);
report.check("the three columns are the same width", sameWidth, widths.map((w) => JSON.stringify(w)).join(", "));

const thin = columns.filter((column) => textNodesIn(doc, column).length < MIN_TEXTS_PER_COLUMN);
report.check(`every column has at least ${MIN_TEXTS_PER_COLUMN} texts`, thin.length === 0, thin.map((c) => `${c.id}:${textNodesIn(doc, c).length}`).join(", "));

const prices = columns.map((column) => {
  const candidates = textNodesIn(doc, column).filter((node) => /\d/.test(node.text ?? ""));
  const biggest = candidates.sort((a, b) => fontSize(b, doc) - fontSize(a, doc))[0] ?? null;
  return biggest && fontSize(biggest, doc) >= PRICE_MIN_FONT ? biggest : null;
});
report.check(`each column shows one price in a >= ${PRICE_MIN_FONT}px text that contains a number`, prices.every(Boolean), prices.map((p) => (p ? `${p.id}:${fontSize(p, doc)}` : "none")).join(", "));

const fills = columns.map((column) => resolve(column.fill, doc.tokens));
const featured = columns.filter((column, index) => fills[index] !== null && fills[index] !== fills[(index + 1) % 3] && fills[index] !== fills[(index + 2) % 3]);
report.check("exactly one column is highlighted with a fill the others do not have", featured.length === 1, `${featured.map((c) => c.id).join(", ") || "none"} (fills: ${fills.join(", ")})`);

const featuredIsToken = featured.length === 1 && typeof featured[0].fill === "string" && featured[0].fill.startsWith("$");
report.check("the highlight comes from a token, not a literal color", featuredIsToken, featured[0]?.fill ?? "n/a");

const rawColors = nodesOf(doc)
  .flatMap((node) => [node.fill, node.color, node.stroke?.color])
  .filter((value) => typeof value === "string" && value !== "" && !value.startsWith("$"));
report.check("every color in the document is a token reference", rawColors.length === 0, rawColors.length ? `${rawColors.length} literal colors: ${[...new Set(rawColors)].join(", ")}` : "none literal");

const small = textNodes(doc).filter((node) => fontSize(node, doc) < MIN_FONT);
report.check(`every text is at least ${MIN_FONT}px`, small.length === 0, small.map((t) => `${t.id}:${fontSize(t, doc)}`).join(", "));

const unreadable = textNodes(doc)
  .map((node) => ({ node, ratio: contrastRatio(resolve(node.color, doc.tokens), backgroundOf(doc, node)) }))
  .filter(({ node, ratio }) => backgroundOf(doc, node) !== null && (ratio === null || ratio < 4.5) && node.visible !== false);
report.check("every text keeps WCAG AA contrast against its column", unreadable.length === 0, unreadable.map(({ node, ratio }) => `${node.id}:${ratio === null ? "unresolved" : ratio.toFixed(2)}`).join(", "));

function textNodesIn(document, root) {
  return descendants(document, root).filter((node) => node.type === "text");
}

function fontSize(node, document) {
  const size = resolve(node.fontSize, document.tokens);
  return typeof size === "number" ? size : 0;
}

function paddingAtLeast(layout, minimum) {
  const padding = layout?.padding ?? 0;
  if (typeof padding === "number") return padding >= minimum;
  return Array.isArray(padding) && padding.every((value) => value >= minimum);
}

process.exit(report.print());
