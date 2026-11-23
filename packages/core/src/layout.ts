import { modeOf, resolveLength, resolveValue } from "./style.js";
import { firstPage, ignoresLayout, isContainer, isScene, pageRoots, type Document, type Layout, type Node, type SceneNode, type Size } from "./schema.js";
import { round4 } from "./num.js";

/**
 * Resolved absolute geometry for agents and renderers.
 *
 * `layout(doc)` walks the document and resolves row/column auto-layout, hug/fill, groups, pages
 * and instance scale into absolute boxes (canvas coordinates, before rotation). Rotation is
 * exposed as the four corners around the box centre (CSS `transform-origin: center`,
 * `rotate()` clockwise on screen).
 *
 * Text measuring uses a deterministic advance table so TypeScript and Go agree. It approximates
 * Inter / system-ui (mean Latin advance ≈ 0.552 em at weight 400); it is not glyph-accurate, so
 * hug text may differ from the browser by a few pixels. Fixed-size auto-layout trees match CSS
 * flex to sub-pixel rounding (≤ 1 px).
 */

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Transform origin (box centre), where rotation pivots. */
  origin: { x: number; y: number };
  /** Corners after rotation, clockwise from the unrotated top-left: TL, TR, BR, BL. */
  corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}

/** Mean Latin advance / em for Inter-like sans at weight 400 (documented approximation). */
export const FONT_AVG = 0.552;

export interface TextMetrics {
  width: number;
  height: number;
  lines: number;
}

/** Deterministic text box shared by TS and Go. Optional `maxWidth` wraps by character advance. */
export function measureText(
  text: string,
  fontSize: number,
  opts: { fontWeight?: number; lineHeight?: number; letterSpacing?: number; maxWidth?: number } = {},
): TextMetrics {
  const weight = opts.fontWeight ?? 400;
  const lineHeight = opts.lineHeight ?? 1.4;
  const letterSpacing = opts.letterSpacing ?? 0;
  const advance = FONT_AVG * fontSize * (1 + (weight - 400) / 4000);
  const lineH = fontSize * lineHeight;
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  const maxW = opts.maxWidth;
  for (const para of paragraphs) {
    if (maxW === undefined || maxW <= 0 || para.length === 0) {
      lines.push(para);
      continue;
    }
    let cur = "";
    for (const ch of para) {
      const next = cur + ch;
      const w = next.length * advance + Math.max(0, next.length - 1) * letterSpacing;
      if (cur && w > maxW) {
        lines.push(cur);
        cur = ch;
      } else cur = next;
    }
    lines.push(cur);
  }
  if (lines.length === 0) lines.push("");
  let width = 0;
  for (const line of lines) {
    const w = line.length === 0 ? 0 : line.length * advance + Math.max(0, line.length - 1) * letterSpacing;
    width = Math.max(width, w);
  }
  return { width: round4(width), height: round4(lines.length * lineH), lines: lines.length };
}

export interface RichSpan {
  start: number;
  end: number;
  fontSize: number;
  fontWeight: number;
}

function advanceOf(fontSize: number, fontWeight: number): number {
  return FONT_AVG * fontSize * (1 + (fontWeight - 400) / 4000);
}

/** Same box as `measureText` when every run uses the base size and weight. Indexes are UTF-16. */
export function measureRichText(
  text: string,
  fontSize: number,
  opts: { fontWeight?: number; lineHeight?: number; letterSpacing?: number; maxWidth?: number; runs?: RichSpan[] } = {},
): TextMetrics {
  const runs = opts.runs;
  if (!runs?.length) return measureText(text, fontSize, opts);
  const weight = opts.fontWeight ?? 400;
  const lineHeight = opts.lineHeight ?? 1.4;
  const letterSpacing = opts.letterSpacing ?? 0;
  const maxW = opts.maxWidth;
  const at = (i: number) => {
    for (const run of runs) {
      if (i >= run.start && i < run.end) return { fontSize: run.fontSize, fontWeight: run.fontWeight };
    }
    return { fontSize, fontWeight: weight };
  };
  let width = 0;
  let height = 0;
  let lines = 0;
  let abs = 0;
  const paras = text.split("\n");
  for (const para of paras) {
    let curUnits = 0;
    let curW = 0;
    let curMax = fontSize;
    const flush = () => {
      width = Math.max(width, curW);
      height += curMax * lineHeight;
      lines++;
      curUnits = 0;
      curW = 0;
      curMax = fontSize;
    };
    if (para.length === 0) flush();
    else {
      for (let i = 0; i < para.length; ) {
        const cp = para.codePointAt(i)!;
        const n = cp > 0xffff ? 2 : 1;
        const st = at(abs + i);
        const adv = advanceOf(st.fontSize, st.fontWeight);
        const gap = curUnits > 0 ? n : Math.max(0, n - 1);
        const add = adv * n + letterSpacing * gap;
        if (maxW !== undefined && maxW > 0 && curUnits > 0 && curW + add > maxW) {
          width = Math.max(width, curW);
          height += curMax * lineHeight;
          lines++;
          curUnits = n;
          curW = adv * n + letterSpacing * Math.max(0, n - 1);
          curMax = Math.max(fontSize, st.fontSize);
        } else {
          curUnits += n;
          curW += add;
          curMax = Math.max(curMax, st.fontSize);
        }
        i += n;
      }
      flush();
    }
    abs += para.length + 1;
  }
  if (lines === 0) return { width: 0, height: round4(fontSize * lineHeight), lines: 1 };
  return { width: round4(width), height: round4(height), lines };
}

function lengthOr(doc: Document, v: number | string | undefined, mode: string | undefined, fallback: number): number {
  return resolveLength(doc, v, mode) ?? fallback;
}

function padOf(doc: Document, n: Extract<Node, { type: "frame" }>, p: Layout["padding"]): [number, number, number, number] {
  const mode = modeOf(doc, n);
  const one = (v: number | string) => lengthOr(doc, v, mode, 0);
  return Array.isArray(p) ? [one(p[0]), one(p[1]), one(p[2]), one(p[3])] : [one(p), one(p), one(p), one(p)];
}

function gapOf(doc: Document, n: Extract<Node, { type: "frame" }>): number {
  return lengthOr(doc, n.layout?.gap, modeOf(doc, n), 0);
}

function sizeNum(s: Size | undefined): number | null {
  return typeof s === "number" ? s : null;
}

function cornersOf(x: number, y: number, w: number, h: number, rotation: number): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  if (!rotation) return pts.map((p) => ({ x: round4(p.x), y: round4(p.y) })) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: round4(cx + dx * cos - dy * sin), y: round4(cy + dx * sin + dy * cos) };
  }) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
}

function boxAt(x: number, y: number, w: number, h: number, rotation: number): LayoutBox {
  const ox = round4(x);
  const oy = round4(y);
  const ow = round4(Math.max(0, w));
  const oh = round4(Math.max(0, h));
  const origin = { x: round4(ox + ow / 2), y: round4(oy + oh / 2) };
  return { x: ox, y: oy, width: ow, height: oh, origin, corners: cornersOf(ox, oy, ow, oh, rotation) };
}

type WH = { w: number; h: number };

function intrinsicText(doc: Document, n: Extract<Node, { type: "text" }>, maxW?: number): WH {
  const mode = modeOf(doc, n);
  const fs = resolveValue(doc, n.fontSize, mode);
  const fontSize = typeof fs === "number" ? fs : Number.parseFloat(String(fs)) || 16;
  const weight = resolveValue(doc, n.fontWeight, mode);
  const fontWeight = typeof weight === "number" ? weight : 400;
  const measureOpts = {
    fontWeight,
    lineHeight: lengthOr(doc, n.lineHeight, mode, 1.4),
    letterSpacing: lengthOr(doc, n.letterSpacing, mode, 0),
    maxWidth: maxW,
  };
  const spans = (n.runs ?? []).map((run) => ({
    start: run.start,
    end: run.end,
    fontSize: run.fontSize === undefined ? fontSize : lengthOr(doc, run.fontSize, mode, fontSize),
    fontWeight: run.fontWeight === undefined ? fontWeight : typeof run.fontWeight === "number" ? run.fontWeight : lengthOr(doc, run.fontWeight, mode, fontWeight),
  }));
  const m = spans.length ? measureRichText(n.text, fontSize, { ...measureOpts, runs: spans }) : measureText(n.text, fontSize, measureOpts);
  return { w: m.width, h: m.height };
}

function flowChildren(doc: Document, n: Node): SceneNode[] {
  if (!isContainer(n)) return [];
  const out: SceneNode[] = [];
  for (const id of n.children) {
    const c = doc.nodes[id];
    if (c && isScene(c) && c.type !== "connector" && c.visible !== false) out.push(c);
  }
  return out;
}

function flowItems(doc: Document, n: Node): SceneNode[] {
  return flowChildren(doc, n).filter((c) => !ignoresLayout(c));
}

function hasFlow(n: Node): n is Extract<Node, { type: "frame" }> & { layout: Layout & { mode: "row" | "column" } } {
  return n.type === "frame" && !!n.layout && n.layout.mode !== "none";
}

/** Bottom-up preferred size when the node hugs or needs a content size. */
function preferred(doc: Document, n: Node, hint?: { maxW?: number; maxH?: number } | WH): WH {
  if (n.type === "page") return { w: 0, h: 0 };
  const maxW = hint && "maxW" in hint ? hint.maxW : hint && "w" in hint ? hint.w : undefined;
  const maxH = hint && "maxH" in hint ? hint.maxH : hint && "h" in hint ? hint.h : undefined;
  const sizedHint = { maxW, maxH };
  const fw = sizeNum(n.width);
  const fh = sizeNum(n.height);
  if (n.type === "text") {
    const tw = fw ?? sizedHint.maxW;
    const t = intrinsicText(doc, n, typeof tw === "number" ? tw : undefined);
    return { w: fw ?? t.w, h: fh ?? t.h };
  }
  if (n.type === "group") return { w: fw ?? n.width, h: fh ?? n.height };
  if (n.type === "connector") return { w: fw ?? n.width, h: fh ?? n.height };
  if (n.type === "shape" || n.type === "rect" || n.type === "ellipse" || n.type === "image" || n.type === "path") {
    return { w: fw ?? 0, h: fh ?? 0 };
  }
  if (n.type === "frame") {
    if (!hasFlow(n)) {
      if (fw !== null && fh !== null) return { w: fw, h: fh };
      const kids = flowChildren(doc, n);
      let maxX = 0,
        maxY = 0;
      for (const c of kids) {
        if (!isScene(c)) continue;
        const s = preferred(doc, c);
        maxX = Math.max(maxX, c.x + s.w);
        maxY = Math.max(maxY, c.y + s.h);
      }
      return { w: fw ?? maxX, h: fh ?? maxY };
    }
    const [pt, pr, pb, pl] = padOf(doc, n, n.layout.padding);
    const gap = gapOf(doc, n);
    const kids = flowItems(doc, n);
    const row = n.layout.mode === "row";
    const sizes = kids.map((c) => preferred(doc, c, row ? { maxH: sizedHint.maxH } : { maxW: sizedHint.maxW }));
    let main = 0;
    let cross = 0;
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i]!;
      if (row) {
        main += s.w;
        cross = Math.max(cross, s.h);
      } else {
        main += s.h;
        cross = Math.max(cross, s.w);
      }
      if (i > 0) main += gap;
    }
    const contentW = row ? main : cross;
    const contentH = row ? cross : main;
    return {
      w: fw ?? contentW + pl + pr,
      h: fh ?? contentH + pt + pb,
    };
  }
  return { w: fw ?? 0, h: fh ?? 0 };
}

interface Place {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Place a node whose outer size is already decided (flex item). */
function placeSized(doc: Document, n: Node, absX: number, absY: number, w: number, h: number, out: Place[]): void {
  if (n.type === "page" || n.type === "connector") {
    placeTree(doc, n.id, absX, absY, out);
    return;
  }
  if (hasFlow(n)) {
    placeFlowFrame(doc, n, absX, absY, w, h, out);
    return;
  }
  const rotation = n.type === "group" ? 0 : "rotation" in n ? n.rotation : 0;
  out.push({ id: n.id, x: absX, y: absY, w, h, rotation });
  if (isContainer(n)) {
    for (const c of n.children) {
      const child = doc.nodes[c];
      if (!child) continue;
      if (child.type === "connector") {
        placeTree(doc, c, absX, absY, out);
        continue;
      }
      if (!isScene(child)) continue;
      placeTree(doc, c, absX + child.x, absY + child.y, out, { w, h });
    }
  }
}

function placeFlowFrame(doc: Document, n: Extract<Node, { type: "frame" }> & { layout: Layout }, absX: number, absY: number, frameW: number, frameH: number, out: Place[]): void {
  const [pt, pr, pb, pl] = padOf(doc, n, n.layout.padding);
  out.push({ id: n.id, x: absX, y: absY, w: frameW, h: frameH, rotation: n.rotation });

  const kids = flowItems(doc, n);
  const row = n.layout.mode === "row";
  const innerW = Math.max(0, frameW - pl - pr);
  const innerH = Math.max(0, frameH - pt - pb);
  const gap = gapOf(doc, n);
  const bases = kids.map((c) => {
    const p = preferred(doc, c, row ? { maxH: innerH } : { maxW: innerW });
    return {
      n: c,
      baseW: sizeNum(c.width) ?? (c.width === "fill" ? 0 : p.w),
      baseH: sizeNum(c.height) ?? (c.height === "fill" ? 0 : p.h),
      fillMain: row ? c.width === "fill" : c.height === "fill",
      fillCross: row ? c.height === "fill" : c.width === "fill",
    };
  });
  const fixedMain = bases.reduce((s, b, i) => s + (row ? b.baseW : b.baseH) + (i > 0 ? gap : 0), 0);
  const fillCount = bases.filter((b) => b.fillMain).length;
  const free = Math.max(0, (row ? innerW : innerH) - fixedMain);
  const fillEach = fillCount ? free / fillCount : 0;

  const placed: { n: Node; w: number; h: number }[] = bases.map((b) => {
    let w = b.baseW;
    let h = b.baseH;
    if (b.fillMain) {
      if (row) w = fillEach;
      else h = fillEach;
    }
      if (b.fillCross) {
        if (row) h = innerH;
        else w = innerW;
      } else if (n.layout.align === "stretch") {
        const crossHug = row ? b.n.height === "hug" : b.n.width === "hug";
        if (crossHug) {
          /* hug stays content-sized; CSS max-content wins over stretch */
        } else if (row && sizeNum(b.n.height) === null) h = innerH;
        else if (!row && sizeNum(b.n.width) === null) w = innerW;
      }
    if (b.n.type === "text") {
      const tw = b.n.width === "fill" || typeof b.n.width === "number" ? w : undefined;
      const t = intrinsicText(doc, b.n, tw);
      if (b.n.width === "hug") w = t.w;
      if (b.n.height === "hug" || typeof b.n.height !== "number") h = t.h;
    }
    return { n: b.n, w: Math.max(0, w), h: Math.max(0, h) };
  });

  const totalMain = placed.reduce((s, p, i) => s + (row ? p.w : p.h) + (i > 0 ? gap : 0), 0);
  const spare = (row ? innerW : innerH) - totalMain;
  let main0 = 0;
  const justify = n.layout.justify;
  if (justify === "center") main0 = spare / 2;
  else if (justify === "end") main0 = spare;

  const betweenGap = justify === "between" && placed.length > 1 ? Math.max(0, spare) / (placed.length - 1) : gap;
  let cursor = main0;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i]!;
    let cross = 0;
    const align = n.layout.align;
    const crossSpare = (row ? innerH : innerW) - (row ? p.h : p.w);
    if (align === "center") cross = crossSpare / 2;
    else if (align === "end") cross = crossSpare;
    const lx = row ? pl + cursor : pl + cross;
    const ly = row ? pt + cross : pt + cursor;
    placeSized(doc, p.n, absX + lx, absY + ly, p.w, p.h, out);
    cursor += (row ? p.w : p.h) + (justify === "between" && placed.length > 1 ? betweenGap : gap);
  }

  for (const id of n.children) {
    const child = doc.nodes[id];
    if (!child || !isScene(child) || child.visible === false || child.type === "connector" || !ignoresLayout(child)) continue;
    placeTree(doc, id, absX + child.x, absY + child.y, out, { w: frameW, h: frameH });
  }

  for (const c of n.children) {
    const child = doc.nodes[c];
    if (child?.type === "connector") placeTree(doc, c, absX, absY, out);
  }
}

function placeTree(doc: Document, id: string, absX: number, absY: number, out: Place[], parentInner?: WH): void {
  const n = doc.nodes[id];
  if (!n || n.type === "page") {
    if (n?.type === "page") {
      for (const c of n.children) placeTree(doc, c, 0, 0, out);
    }
    return;
  }
  if (n.type === "connector") {
    out.push({ id, x: absX + n.x, y: absY + n.y, w: typeof n.width === "number" ? n.width : 0, h: typeof n.height === "number" ? n.height : 0, rotation: 0 });
    return;
  }

  if (hasFlow(n)) {
    const pref = preferred(doc, n, parentInner ? { maxW: parentInner.w, maxH: parentInner.h } : undefined);
    const frameW = sizeNum(n.width) ?? (n.width === "fill" && parentInner ? parentInner.w : pref.w);
    const frameH = sizeNum(n.height) ?? (n.height === "fill" && parentInner ? parentInner.h : pref.h);
    placeFlowFrame(doc, n, absX, absY, frameW, frameH, out);
    return;
  }

  const pref = preferred(doc, n, parentInner ? { maxW: parentInner.w, maxH: parentInner.h } : undefined);
  let w = sizeNum(n.width) ?? (n.width === "fill" && parentInner ? parentInner.w : pref.w);
  let h = sizeNum(n.height) ?? (n.height === "fill" && parentInner ? parentInner.h : pref.h);
  if (n.type === "text") {
    const t = intrinsicText(doc, n, typeof n.width === "number" ? n.width : parentInner?.w);
    if (n.width === "hug") w = t.w;
    if (n.height === "hug") h = t.h;
  }
  const rotation = n.type === "group" ? 0 : n.rotation;
  out.push({ id, x: absX, y: absY, w, h, rotation });

  if (isContainer(n)) {
    for (const c of n.children) {
      const child = doc.nodes[c];
      if (!child) continue;
      if (child.type === "connector") {
        placeTree(doc, c, absX, absY, out);
        continue;
      }
      if (!isScene(child)) continue;
      placeTree(doc, c, absX + child.x, absY + child.y, out);
    }
  }
}

export interface LayoutOptions {
  /** Only this subtree (and the node itself). */
  rootId?: string;
  /** Restrict the result to these ids (still resolves the whole tree for correct flex). */
  ids?: readonly string[];
}

function subtreeIds(doc: Document, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isContainer(n)) return;
    for (const c of n.children) {
      out.add(c);
      walk(c);
    }
  };
  walk(rootId);
  return out;
}

function pageIdOf(doc: Document, id: string): string | undefined {
  let cur: Node | undefined = doc.nodes[id];
  while (cur) {
    if (cur.type === "page") return cur.id;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  return firstPage(doc)?.id;
}

/**
 * Absolute boxes for every visible node (or a subtree / id filter). Keys are node ids.
 * Pages are omitted (they have no geometry); their children use canvas coordinates.
 */
export function layout(doc: Document, opts: LayoutOptions = {}): Record<string, LayoutBox> {
  if (opts.rootId && !doc.nodes[opts.rootId]) throw new Error(`node "${opts.rootId}" does not exist`);
  const placed: Place[] = [];
  const pageId =
    opts.rootId && doc.nodes[opts.rootId]?.type === "page"
      ? opts.rootId
      : opts.rootId
        ? pageIdOf(doc, opts.rootId)
        : firstPage(doc)?.id;
  const roots = pageRoots(doc, pageId);
  for (const id of roots) {
    const n = doc.nodes[id];
    if (!n || n.type === "page" || !isScene(n)) continue;
    placeTree(doc, id, n.x, n.y, placed);
  }

  let keep: Set<string> | null = null;
  if (opts.rootId) keep = subtreeIds(doc, opts.rootId);
  if (opts.ids) {
    const ids = new Set(opts.ids);
    keep = keep ? new Set([...keep].filter((id) => ids.has(id))) : ids;
  }

  const out: Record<string, LayoutBox> = {};
  for (const p of placed) {
    if (keep && !keep.has(p.id)) continue;
    out[p.id] = boxAt(p.x, p.y, p.w, p.h, p.rotation);
  }
  return out;
}
