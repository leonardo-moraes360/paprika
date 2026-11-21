#!/usr/bin/env node
// Checker for the `login-card` benchmark task.
//
// Usage: node bench/tasks/login-card/check.mjs <document.paprika.json>
// Exit 0 when every rule in task.yaml is satisfied, 1 otherwise; one PASS/FAIL line per rule.
// The rules are the contract the prompt states, so a solver can pass without guessing.
import { Report, backgroundOf, byId, contrastRatio, descendants, loadDocument, nodesOf, numeric, resolve, textNodes } from "../lib.mjs";

const MIN_FONT = 13;
const MIN_INPUT_HEIGHT = 28;
const MIN_TOKENS = 4;
const TOLERANCE = 1;

const report = new Report("login-card");
const argv = process.argv[2];
if (!argv) {
  report.fail("usage: check.mjs <document.paprika.json>");
  process.exit(report.print());
}
const doc = loadDocument(argv, report);
if (!doc) process.exit(report.print());

const roots = (doc.rootIds ?? []).map((id) => byId(doc, id)).filter(Boolean);
const frame = roots.length === 1 && roots[0].type === "frame" ? roots[0] : null;

report.check("exactly one root frame", frame !== null, `roots: ${roots.map((r) => `${r.id}(${r.type})`).join(", ") || "none"}`);
if (!frame) process.exit(report.print());

const width = numeric(frame.width);
const height = numeric(frame.height);
report.check(
  "the frame is card-sized (300-480 wide, at least 380 tall)",
  width !== null && height !== null && width >= 300 && width <= 480 && height >= 380,
  `${width} x ${height}`,
);

const inside = descendants(doc, frame);
const texts = textNodes(doc);
const rects = nodesOf(doc).filter((node) => node.type === "rect");
report.check("at least 3 texts and 2 rects inside the card", texts.length >= 3 && rects.length >= 2, `${texts.length} texts, ${rects.length} rects`);

const tooSmall = texts.filter((node) => {
  const size = numeric(resolve(node.fontSize, doc.tokens));
  return size === null || size < MIN_FONT;
});
report.check(`every text is at least ${MIN_FONT}px`, tooSmall.length === 0, tooSmall.map((t) => `${t.id}:${resolve(t.fontSize, doc.tokens)}`).join(", "));

const referenced = new Set(
  nodesOf(doc)
    .flatMap((node) => [node.fill, node.color, node.stroke?.color])
    .filter((value) => typeof value === "string" && value.startsWith("$"))
    .map((value) => value.slice(1)),
);
const missingTokens = [...referenced].filter((name) => !(name in (doc.tokens ?? {})));
report.check(`at least ${MIN_TOKENS} distinct tokens are used`, referenced.size >= MIN_TOKENS, `${referenced.size} used: ${[...referenced].join(", ")}`);
report.check("every referenced token exists", missingTokens.length === 0, missingTokens.join(", "));

// A button is a small painted shape: tall enough to tap, nowhere near the size of the card itself,
// which stops the card frame from being mistaken for one.
const buttons = nodesOf(doc).filter(
  (node) =>
    ["rect", "frame"].includes(node.type) &&
    Number(node.radius) >= 8 &&
    resolve(node.fill, doc.tokens) !== undefined &&
    (numeric(node.width) ?? 0) >= 80 &&
    (numeric(node.height) ?? 0) >= 28 &&
    (numeric(node.height) ?? 0) <= 80,
);
report.check("a rect or frame with radius >= 8 and a fill is the button", buttons.length >= 1, `${buttons.length} candidates`);

const labelsOn = (button) => {
  const bx = numeric(button.width) ?? 0;
  const by = numeric(button.height) ?? 0;
  const insideFrame = new Set(descendants(doc, button).filter((node) => node.type === "text").map((node) => node.id));
  return texts.filter((label) => {
    if (insideFrame.has(label.id)) return true;
    const cx = label.x + (numeric(label.width) ?? 0) / 2;
    const cy = label.y + (numeric(label.height) ?? 0) / 2;
    return cx >= button.x && cx <= button.x + bx && cy >= button.y && cy <= button.y + by;
  });
};

const labelled = buttons.filter((button) => labelsOn(button).length >= 1);
report.check("the button has a label on it", labelled.length >= 1, `${labelled.length} candidates`);

const readable = labelled.filter((button) =>
  labelsOn(button).every((label) => {
    const ratio = contrastRatio(resolve(label.color, doc.tokens), resolve(button.fill, doc.tokens));
    return ratio !== null && ratio >= 4.5;
  }),
);
report.check("the button label passes WCAG AA against the button fill", readable.length === labelled.length && readable.length >= 1, `${readable.length}/${labelled.length}`);

const inputs = rects.filter((node) => (node.stroke?.width ?? 0) >= 1 && (numeric(node.height) ?? 0) >= MIN_INPUT_HEIGHT);
report.check(`two rects with a stroke are the inputs (height >= ${MIN_INPUT_HEIGHT})`, inputs.length >= 2, `${inputs.length} candidates`);

const outside = inside.filter((node) => {
  if (node.id === frame.id) return false;
  const w = numeric(node.width);
  const h = numeric(node.height);
  if (w === null || h === null) return false;
  return node.x < -TOLERANCE || node.y < -TOLERANCE || node.x + w > width + TOLERANCE || node.y + h > height + TOLERANCE;
});
report.check("everything is inside the card", outside.length === 0, outside.map((n) => `${n.id}@${n.x},${n.y}`).join(", "));

const unreadable = texts
  .map((node) => ({ node, ratio: contrastRatio(resolve(node.color, doc.tokens), backgroundOf(doc, node)) }))
  .filter(({ node, ratio }) => backgroundOf(doc, node) !== null && resolve(node.color, doc.tokens) !== undefined && (ratio === null || ratio < 4.5) && node.visible !== false);
report.check("every text keeps WCAG AA contrast against its background", unreadable.length === 0, unreadable.map(({ node, ratio }) => `${node.id}:${ratio === null ? "unresolved" : ratio.toFixed(2)}`).join(", "));

process.exit(report.print());
