import { parseModernColor } from "./color.js";
import { layout } from "./layout.js";
import { round4 } from "./num.js";
import { placeNum, placementLint } from "./placement.js";
import { isContainer, listShadows, type Document, type Node } from "./schema.js";
import { modeOf, resolveLength, resolveValue, resolvedFontWeight, tokenValue } from "./style.js";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, RGBA> = {
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  magenta: { r: 255, g: 0, b: 255, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
};

/** Converte hex/rgb()/oklch()/color-mix()/color() e nomes básicos. Gradientes ficam de fora. */
export function parseColor(input: string): RGBA | undefined {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return undefined;
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4]);
    return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a };
  }
  return parseModernColor(s, parseColor);
}

function blend(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

function luminance(c: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** Razão de contraste WCAG 2.x entre duas cores opacas. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Cor de fundo efetiva atrás de um nó: compõe os fills dos ancestrais sobre branco. */
export function effectiveBackground(doc: Document, node: Node): RGBA | undefined {
  const layers: RGBA[] = [];
  let cur: Node | undefined = node.type === "text" || node.type === "shape" ? node : node.parentId ? doc.nodes[node.parentId] : undefined;
  while (cur) {
    if (cur.type !== "group" && cur.type !== "connector" && "gradient" in cur && cur.gradient) return undefined;
    if (cur.type !== "group" && cur.type !== "connector" && cur.fill) {
      const c = parseColor(String(resolveValue(doc, cur.fill, modeOf(doc, cur))));
      if (!c) return undefined;
      layers.push(c);
      if (c.a >= 1) break;
    }
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  let bg: RGBA = NAMED.white!;
  for (const layer of layers.reverse()) bg = blend(layer, bg);
  return bg;
}

export type Severity = "error" | "warning" | "info";

export interface LintIssue {
  rule: string;
  severity: Severity;
  nodeId: string;
  message: string;
}

function tokenRefs(node: Node): string[] {
  const refs: string[] = [];
  const check = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("$")) refs.push(v.slice(1));
  };
  if (node.type === "group") return refs;
  if (node.type === "connector") {
    check(node.stroke.color);
    check(node.stroke.width);
    return refs;
  }
  check(node.fill);
  if ("gradient" in node && node.gradient) {
    for (const stop of node.gradient.stops) check(stop.color);
  }
  if (node.type === "page") return refs;
  check(node.stroke?.color);
  check(node.stroke?.width);
  for (const s of listShadows(node.shadow)) {
    check(s.color);
    check(s.x);
    check(s.y);
    check(s.blur);
    check(s.spread);
  }
  if (node.outline) {
    check(node.outline.color);
    check(node.outline.width);
    check(node.outline.offset);
  }
  check(node.filter?.blur);
  check(node.backdropFilter?.blur);
  if (Array.isArray(node.radius)) node.radius.forEach(check);
  else check(node.radius);
  if (node.type === "frame" && node.layout) {
    check(node.layout.gap);
    const p = node.layout.padding;
    if (Array.isArray(p)) p.forEach(check);
    else check(p);
  }
  if (node.type === "text" || node.type === "shape") {
    check(node.color);
    check(node.fontSize);
    check(node.lineHeight);
  }
  if (node.type === "text") {
    check(node.letterSpacing);
    for (const run of node.runs ?? []) {
      check(run.color);
      check(run.fontSize);
    }
  }
  return refs;
}

export interface LintOptions {
  rootId?: string;
  rootIds?: string[];
  minSeverity?: Severity;
  minFontSize?: number;
}

export interface LintGroup {
  rule: string;
  severity: Severity;
  count: number;
  nodeIds: string[];
  message: string;
}

const SEV_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Regras de qualidade pensadas para agentes: cada problema vem com o id do nó e uma mensagem
 * acionável, para o agente corrigir com `update_nodes` sem precisar de screenshot.
 */
export function lintDocument(doc: Document, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = scopeIds(doc, opts);
  const minFont = opts.minFontSize ?? 12;
  const hasColorTokens = Object.values(doc.tokens).some((v) => typeof v === "string" && !!parseColor(v));

  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const mode = modeOf(doc, node);
    if ((node.type === "frame" || node.type === "page") && node.mode && !(doc.modes && Object.hasOwn(doc.modes, node.mode)))
      issues.push({ rule: "unknown-mode", severity: "warning", nodeId: id, message: `mode "${node.mode}" has no tokens (set_tokens with mode); the base tokens apply` });
    for (const ref of tokenRefs(node)) {
      if (tokenValue(doc, ref, mode) === undefined)
        issues.push({ rule: "unknown-token", severity: "error", nodeId: id, message: `token "$${ref}" does not exist` });
    }

    if (node.type === "text" || node.type === "shape") {
      if (node.type === "text" && !node.text.trim())
        issues.push({ rule: "empty-text", severity: "warning", nodeId: id, message: "empty text" });
      const fs = resolveValue(doc, node.fontSize, modeOf(doc, node));
      const size = typeof fs === "number" ? fs : Number.parseFloat(String(fs));
      if (size < minFont && !underScaledMock(doc, node))
        issues.push({ rule: "small-text", severity: "warning", nodeId: id, message: `font size ${size}px (< ${minFont}px)` });
      const fg = parseColor(String(resolveValue(doc, node.color, modeOf(doc, node))));
      const bg = effectiveBackground(doc, node);
      if (fg && bg) {
        const ratio = contrastRatio(blend(fg, bg), bg);
        const large = size >= 24 || (size >= 18.66 && resolvedFontWeight(doc, node.fontWeight, modeOf(doc, node)) >= 700);
        const min = large ? 3 : 4.5;
        if (ratio < min)
          issues.push({
            rule: "contrast",
            severity: "error",
            nodeId: id,
            message: `contrast ${ratio.toFixed(2)}:1 below ${min}:1 (WCAG AA${large ? ", large text" : ""})`,
          });
      }
      if (hasColorTokens && !node.color.startsWith("$"))
        issues.push({ rule: "raw-color", severity: "info", nodeId: id, message: `literal color "${node.color}"; prefer a token` });
    }

    if (node.type === "path" && !node.fill && !node.gradient && !(node.stroke && (resolveLength(doc, node.stroke.width, modeOf(doc, node)) ?? 0) > 0))
      issues.push({
        rule: "invisible-path",
        severity: "warning",
        nodeId: id,
        message: "a path without fill or stroke is invisible; set fill or stroke {color,width}",
      });

    if (node.type === "image" && !node.alt.trim())
      issues.push({ rule: "missing-alt", severity: "warning", nodeId: id, message: "image without alternative text (alt)" });

    if (node.type !== "group" && node.type !== "connector" && hasColorTokens && node.fill && !node.fill.startsWith("$") && node.fill !== "transparent")
      issues.push({ rule: "raw-color", severity: "info", nodeId: id, message: `literal fill "${node.fill}"; prefer a token` });
    if (node.type !== "group" && node.type !== "connector" && hasColorTokens && "gradient" in node && node.gradient) {
      for (const stop of node.gradient.stops) {
        if (!stop.color.startsWith("$"))
          issues.push({ rule: "raw-color", severity: "info", nodeId: id, message: `literal gradient stop "${stop.color}"; prefer a token` });
      }
    }

    if (node.type === "page") continue;
    if (node.type === "group" && node.children.length === 0)
      issues.push({ rule: "empty-group", severity: "info", nodeId: id, message: "empty group; delete it or move nodes into it" });

    if (node.type === "frame" && (!node.layout || node.layout.mode === "none") && node.children.length > 0) {
      const axes = (["width", "height"] as const).filter((k) => node[k] === "hug");
      if (axes.length)
        issues.push({
          rule: "hug-without-layout",
          severity: "warning",
          nodeId: id,
          message: `${axes.join(" and ")} "hug" on a frame without layout is 0 px (its children are placed absolutely, so nothing is hugged); set layout {mode: "column"} or a number`,
        });
    }

    const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
    const absolute = parent?.type === "frame" && (!parent.layout || parent.layout.mode === "none");
    if (
      absolute &&
      parent &&
      typeof parent.width === "number" &&
      typeof parent.height === "number" &&
      typeof node.width === "number" &&
      typeof node.height === "number" &&
      node.visible
    ) {
      const out = node.x < 0 || node.y < 0 || node.x + node.width > parent.width || node.y + node.height > parent.height;
      if (out)
        issues.push({
          rule: "overflow",
          severity: "warning",
          nodeId: id,
          message: `goes outside "${parent.name || parent.id}" (${parent.width}×${parent.height})${
            parent.type === "frame" && parent.clip ? " and will be clipped" : ""
          }`,
        });
    }

    if (node.type === "frame" && !node.name && (!parent || parent.type === "page"))
      issues.push({ rule: "unnamed-frame", severity: "info", nodeId: id, message: "top-level frame without a name" });
  }
  const opaque = (n: Node) => {
    if (n.type !== "frame" || n.visible === false) return false;
    if (n.opacity < 0.99) return false;
    if (n.gradient) return false;
    if (!n.fill) return false;
    const c = parseColor(String(resolveValue(doc, n.fill, modeOf(doc, n))));
    return !!c && c.a >= 0.99;
  };
  issues.push(...placementLint(doc, ids, opaque));
  issues.push(...layoutLint(doc, ids));
  issues.push(...geometryLint(doc, ids));
  return finishLint(doc, issues, opts);
}

export function groupLint(issues: readonly LintIssue[], maxIds = 8): LintGroup[] {
  const cap = Math.max(1, Math.floor(maxIds));
  const map = new Map<string, LintGroup>();
  for (const issue of issues) {
    let group = map.get(issue.rule);
    if (!group) {
      group = { rule: issue.rule, severity: issue.severity, count: 0, nodeIds: [], message: issue.message };
      map.set(issue.rule, group);
    }
    group.count += 1;
    if (group.nodeIds.length < cap && !group.nodeIds.includes(issue.nodeId)) group.nodeIds.push(issue.nodeId);
  }
  return [...map.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}

function collect(doc: Document, rootId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push(id);
    if (isContainer(n)) n.children.forEach(walk);
  };
  walk(rootId);
  return out;
}

function scopeIds(doc: Document, opts: LintOptions): string[] {
  const roots = [...(opts.rootIds ?? [])];
  if (opts.rootId) roots.unshift(opts.rootId);
  if (roots.length === 0) return Object.keys(doc.nodes);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    for (const id of collect(doc, root)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function finishLint(doc: Document, issues: LintIssue[], opts: LintOptions): LintIssue[] {
  const floor = SEV_RANK[opts.minSeverity ?? "info"];
  return issues.filter((issue) => {
    const node = doc.nodes[issue.nodeId];
    if (node && "lintIgnore" in node && node.lintIgnore?.includes(issue.rule)) return false;
    return SEV_RANK[issue.severity] <= floor;
  });
}

function underScaledMock(doc: Document, node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur) {
    if (cur.type === "frame" && cur.scaledMock) return true;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return false;
}

type Box = { x: number; y: number; w: number; h: number };

const TOUCH = 0.5;
const NEAR = 4;
const GEOM_TYPES = new Set(["rect", "ellipse", "path", "shape", "image"]);

function nodeLabel(n: Node | undefined): string {
  if (!n) return "";
  return n.name || n.id;
}

function shown(n: Node): boolean {
  return n.type === "page" || n.visible !== false;
}

function isCopy(n: Node): boolean {
  return "sourceId" in n && !!n.sourceId;
}

function gapOf(a: Box, b: Box): number {
  const sepX = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const sepY = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  const raw = sepX === 0 && sepY === 0 ? 0 : sepX === 0 ? sepY : sepY === 0 ? sepX : Math.hypot(sepX, sepY);
  return round4(raw);
}

function containsBox(outer: Box, inner: Box): boolean {
  return (
    inner.w > 0 &&
    inner.h > 0 &&
    inner.x >= outer.x - TOUCH &&
    inner.y >= outer.y - TOUCH &&
    inner.x + inner.w <= outer.x + outer.w + TOUCH &&
    inner.y + inner.h <= outer.y + outer.h + TOUCH
  );
}

function laidOut(doc: Document): Record<string, Box> {
  const pages = doc.rootIds.filter((id) => doc.nodes[id]?.type === "page");
  const merged: Record<string, { x: number; y: number; width: number; height: number }> = {};
  if (pages.length === 0) Object.assign(merged, layout(doc));
  else for (const id of pages) Object.assign(merged, layout(doc, { rootId: id }));
  const out: Record<string, Box> = {};
  for (const [id, b] of Object.entries(merged)) out[id] = { x: b.x, y: b.y, w: b.width, h: b.height };
  return out;
}

function siblingIds(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return [];
  return parent.children;
}

function isFlowFrame(n: Node | undefined): boolean {
  return !!n && n.type === "frame" && !!n.layout && n.layout.mode !== "none";
}

function opaqueNode(doc: Document, n: Node): boolean {
  if (!shown(n) || n.type === "text" || n.type === "group" || n.type === "connector" || n.type === "page") return false;
  if (n.type !== "frame" && n.type !== "rect" && n.type !== "ellipse" && n.type !== "path" && n.type !== "shape" && n.type !== "image") return false;
  if ("gradient" in n && n.gradient) return false;
  if (n.opacity < 0.99 || !n.fill) return false;
  const color = parseColor(String(resolveValue(doc, n.fill, modeOf(doc, n))));
  return !!color && color.a >= 0.99;
}

function layoutLint(doc: Document, ids: readonly string[]): LintIssue[] {
  const boxes = laidOut(doc);
  const issues: LintIssue[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || node.type !== "frame" || !node.layout || node.layout.mode === "none") continue;
    const frame = boxes[id];
    if (!frame) continue;
    const mode = node.layout.mode;
    const kids: string[] = [];
    let width = false;
    let height = false;
    for (const cid of node.children) {
      const child = doc.nodes[cid];
      const box = boxes[cid];
      if (!child || !box || !shown(child) || child.type === "connector") continue;
      const overW = box.x < frame.x - TOUCH || box.x + box.w > frame.x + frame.w + TOUCH;
      const overH = box.y < frame.y - TOUCH || box.y + box.h > frame.y + frame.h + TOUCH;
      if (!overW && !overH) continue;
      kids.push(cid);
      width = width || overW;
      height = height || overH;
    }
    if (!kids.length) continue;
    if (node.width === 100 && node.height === 100) {
      issues.push({
        rule: "hug-was-meant",
        severity: "warning",
        nodeId: id,
        message: `default 100×100 ${mode} frame; children leave the box, so hug was meant (set width and height to "hug")`,
      });
      continue;
    }
    const axes = width && height ? "width and height" : width ? "width" : "height";
    const labels = kids.map((cid) => nodeLabel(doc.nodes[cid]));
    const listed = labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");
    issues.push({
      rule: "layout-overflow",
      severity: "warning",
      nodeId: id,
      message: `${mode} children leave "${nodeLabel(node)}" (${placeNum(frame.w)}×${placeNum(frame.h)}) on ${axes}: ${listed}`,
    });
  }
  return issues;
}

function geometryLint(doc: Document, ids: readonly string[]): LintIssue[] {
  const allow = new Set(ids);
  const boxes = laidOut(doc);
  const seen = new Set<string>();
  const issues: LintIssue[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const key = node.parentId ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(...geometryParent(doc, node.parentId, allow, boxes));
  }
  return issues;
}

function geometryParent(doc: Document, parentId: string | null, allow: Set<string>, boxes: Record<string, Box>): LintIssue[] {
  if (parentId && isFlowFrame(doc.nodes[parentId])) return [];
  const children = siblingIds(doc, parentId);
  const prims = children.filter((id) => {
    const n = doc.nodes[id];
    return !!n && shown(n) && !isCopy(n) && GEOM_TYPES.has(n.type) && !!boxes[id];
  });
  let cluster = false;
  for (let i = 0; i < prims.length && !cluster; i++) {
    for (let j = i + 1; j < prims.length; j++) {
      if (gapOf(boxes[prims[i]!]!, boxes[prims[j]!]!) <= TOUCH) {
        cluster = true;
        break;
      }
    }
  }
  const parent = parentId ? doc.nodes[parentId] : undefined;
  const parentLabel = parent ? nodeLabel(parent) : "the canvas";
  const issues: LintIssue[] = [];
  for (const id of children) {
    if (!allow.has(id)) continue;
    const n = doc.nodes[id];
    const box = boxes[id];
    if (!n || !box || !shown(n) || isCopy(n) || !GEOM_TYPES.has(n.type)) continue;
    const others = children.filter((oid) => {
      if (oid === id || !boxes[oid]) return false;
      const o = doc.nodes[oid];
      return !!o && shown(o) && o.type !== "connector" && o.type !== "page";
    });
    let nearest = Infinity;
    for (const oid of others) {
      const g = gapOf(box, boxes[oid]!);
      if (g < nearest) nearest = g;
    }
    if (others.length > 0 && cluster && nearest >= NEAR) {
      issues.push({
        rule: "detached-sibling",
        severity: "warning",
        nodeId: id,
        message: `touches no sibling in "${parentLabel}" (nearest gap ${placeNum(nearest)}px)`,
      });
    }
    const index = children.indexOf(id);
    for (const oid of prims) {
      if (children.indexOf(oid) >= index) continue;
      const g = gapOf(box, boxes[oid]!);
      if (g > TOUCH && g < NEAR) {
        issues.push({
          rule: "near-gap",
          severity: "warning",
          nodeId: id,
          message: `${placeNum(g)}px from "${nodeLabel(doc.nodes[oid])}" (under 4px)`,
        });
      }
    }
    let cover: Node | undefined;
    for (const oid of children) {
      if (children.indexOf(oid) <= index) continue;
      const o = doc.nodes[oid];
      const ob = boxes[oid];
      if (!o || !ob || !opaqueNode(doc, o) || !containsBox(ob, box)) continue;
      cover = o;
    }
    if (cover) {
      issues.push({
        rule: "fully-hidden",
        severity: "warning",
        nodeId: id,
        message: `fully hidden behind opaque "${nodeLabel(cover)}"`,
      });
    }
  }
  return issues;
}
