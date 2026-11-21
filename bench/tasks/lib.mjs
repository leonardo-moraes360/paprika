// Shared helpers for the benchmark checkers in bench/tasks/*/check.mjs.
//
// Not a task directory: `tb bench` only reads subdirectories of bench/tasks that contain a
// task.yaml, and this is a plain file. Dependency-free on purpose — a checker has to run on a bare
// `node bench/tasks/<task>/check.mjs <document.json>` with nothing installed.
//
// The rules here mirror what `lint_design` reports on the live server (WCAG AA contrast, small
// text, overflow, missing alt text, hardcoded colors that already exist as tokens), reimplemented
// locally so the score does not depend on a running Paprika or on the build of @paprika/core.

import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve as pathResolve, sep } from "node:path";

/**
 * Resolve a document path given on the command line (Sonar S8707).
 *
 * A checker is pointed at a file by whoever runs it, so the argument is untrusted input: it has to
 * stay inside the current directory. Absolute paths outside it and `../` escapes are refused instead
 * of read, so a typo cannot pull an unrelated file into the score.
 *
 * @param {string} path
 * @returns {string|null} the absolute path, or null when it leaves the current directory.
 */
export function insideCwd(path) {
  const here = process.cwd();
  const abs = pathResolve(here, path);
  const rel = relative(here, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return abs;
}

/** @param {string} file @returns {any} the parsed document, or null with the reason in `report`. */
export function loadDocument(file, report) {
  const safe = insideCwd(file);
  if (safe === null) {
    report.fail(`${file}: the document must be inside the current directory (${process.cwd()})`);
    return null;
  }
  let text;
  try {
    text = readFileSync(safe, "utf8");
  } catch (error) {
    report.fail(`cannot read ${file}: ${error.message}`);
    return null;
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    report.fail(`${file} is not valid JSON: ${error.message}`);
    return null;
  }
  if (doc.format !== "paprika/1") {
    report.fail(`${file}: format must be "paprika/1", got ${JSON.stringify(doc.format)}`);
    return null;
  }
  if (!doc.nodes || typeof doc.nodes !== "object") {
    report.fail(`${file}: missing nodes`);
    return null;
  }
  return doc;
}

export const nodesOf = (doc) => Object.values(doc.nodes ?? {});
export const byId = (doc, id) => doc.nodes?.[id] ?? null;

/** Children of a node, in the order the frame lists them. */
export function childrenOf(doc, node) {
  return (node?.children ?? []).map((id) => byId(doc, id)).filter(Boolean);
}

/** Every node reachable from `root` (inclusive). */
export function descendants(doc, root) {
  const out = [];
  const walk = (node) => {
    out.push(node);
    for (const child of childrenOf(doc, node)) walk(child);
  };
  if (root) walk(root);
  return out;
}

export function textNodes(doc) {
  return nodesOf(doc).filter((n) => n.type === "text");
}

export function images(doc) {
  return nodesOf(doc).filter((n) => n.type === "image");
}

/**
 * Resolve a color or size that may be written as a token reference (`$name`).
 * Token chains are followed at most 8 levels: a loop is reported, not spun on.
 */
export function resolve(value, tokens, seen = new Set()) {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  const name = value.slice(1);
  if (seen.has(name)) return undefined;
  seen.add(name);
  const next = tokens?.[name];
  return next === undefined ? undefined : resolve(next, tokens, seen);
}

/**
 * The color a node is drawn on: its nearest painted ancestor, unless an earlier sibling (drawn
 * under it) covers it — which is how a button label on a rect and a card on a panel work.
 */
export function backgroundOf(doc, node) {
  let current = node;
  while (current) {
    const parent = current.parentId ? byId(doc, current.parentId) : null;
    if (parent) {
      const siblings = childrenOf(doc, parent);
      const at = siblings.findIndex((sibling) => sibling.id === current.id);
      for (let index = at - 1; index >= 0; index--) {
        const sibling = siblings[index];
        const fill = resolve(sibling.fill, doc.tokens);
        if (typeof fill === "string" && fill !== "transparent" && covers(sibling, current)) return fill;
      }
    }
    const fill = resolve(current.fill, doc.tokens);
    if (typeof fill === "string" && fill !== "transparent") return fill;
    current = parent;
  }
  return null;
}

/** Whether `a`'s box contains the center of `b` (both need numeric geometry). */
function covers(a, b) {
  if (!["rect", "ellipse", "frame", "image"].includes(a.type)) return false;
  const aw = numeric(a.width);
  const ah = numeric(a.height);
  const bw = numeric(b.width);
  const bh = numeric(b.height);
  if (aw === null || ah === null || bw === null || bh === null) return false;
  const cx = b.x + bw / 2;
  const cy = b.y + bh / 2;
  return cx >= a.x && cx <= a.x + aw && cy >= a.y && cy <= a.y + ah;
}

/** Parse the CSS colors Paprika allows: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), transparent. */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const body = hex[1];
    const parts = body.length === 3 ? [...body].map((c) => c + c) : body.match(/.{2}/g);
    return { r: Number.parseInt(parts[0], 16), g: Number.parseInt(parts[1], 16), b: Number.parseInt(parts[2], 16), a: parts[3] ? Number.parseInt(parts[3], 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgb) {
    const args = rgb[1].split(/[,\s/]+/).filter(Boolean).map((v) => (v.endsWith("%") ? Number(v.slice(0, -1)) * 2.55 : Number(v)));
    if (args.length < 3 || args.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
    return { r: args[0], g: args[1], b: args[2], a: args[3] === undefined ? 1 : args[3] };
  }
  return null;
}

/** WCAG 2.1 contrast ratio between two colors; the foreground is composited over the background. */
export function contrastRatio(foreground, background) {
  const front = parseColor(foreground);
  const back = parseColor(background);
  if (!front || !back) return null;
  const [r, g, b] = composite(front, back);
  const here = luminance(r, g, b);
  const there = luminance(back.r, back.g, back.b);
  const [light, dark] = here >= there ? [here, there] : [there, here];
  return (light + 0.05) / (dark + 0.05);
}

function composite(front, back) {
  const a = Math.max(0, Math.min(1, front.a));
  return [
    front.r * a + back.r * (1 - a),
    front.g * a + back.g * (1 - a),
    front.b * a + back.b * (1 - a),
    a,
  ];
}

function luminance(r, g, b) {
  const channel = (v) => {
    const c = Math.max(0, Math.min(255, v)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Numeric size of a node, treating `hug`/`fill` as unknown (null). */
export const numeric = (size) => (typeof size === "number" ? size : null);

/**
 * Collects named results and prints them. `ok` decides the exit code: a checker exits 0 only when
 * every check passed, and prints one line per check so a score is readable in the tb report.
 */
export class Report {
  constructor(taskId) {
    this.taskId = taskId;
    this.results = [];
  }

  check(name, condition, detail = "") {
    this.results.push({ name, passed: Boolean(condition), detail });
    return Boolean(condition);
  }

  fail(message) {
    this.results.push({ name: message, passed: false, detail: "" });
  }

  print() {
    const passed = this.results.filter((r) => r.passed).length;
    for (const result of this.results) {
      console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    }
    console.log(`${this.taskId}: ${passed}/${this.results.length} checks passed`);
    return this.results.every((r) => r.passed) ? 0 : 1;
  }
}
