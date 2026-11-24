import { parseColor } from "./lint.js";
import { listShadows, pageRoots, type Document, type Node, type SceneNode } from "./schema.js";
import { modeOf, nodeGradient, resolveCorners, resolveLength, resolveValue, strokePositionOf, strokeStyleOf, uniformCorner } from "./style.js";

/**
 * Display list for the WASM canvas renderer (`crates/render`, ADR 0002).
 *
 * It is derived from the same node fields `nodeStyle` reads, so the WASM layer paints what the
 * DOM would paint. Layout is not computed here: the caller passes the boxes the browser already
 * resolved (auto layout, `hug`, `fill`), in canvas coordinates and before rotation.
 *
 * The WASM canvas sits under every DOM-painted node. A shape stays on WASM only when no DOM-painted
 * node earlier in paint order overlaps its painted bounds (own paint, stroke, shadow, rotation and
 * ancestor clips). The rest go back to the DOM, and each one can demote the nodes after it.
 *
 * Entry layout (25 `f32`): `[kind, x, y, w, h, radius|pathIndex, rotation°, opacity,
 * fill r g b a, strokeWidth, stroke r g b a, shadow dx dy blur spread, shadow r g b a]`,
 * colors in 0..1. `kind`: 0 rect, 1 ellipse, 2 push clip, 3 pop clip, 4 path.
 * Path table: one line per path, `vx vy vw vh fillRule cap join|d`.
 */
export const DISPLAY_STRIDE = 25;
const KIND = { rect: 0, ellipse: 1, pushClip: 2, popClip: 3, path: 4 } as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DisplayList {
  data: Float32Array;
  paths: string;
  /** Entries in `data`. */
  count: number;
  /** Node ids whose own paint the WASM layer draws; the DOM must not paint them again. */
  painted: Set<string>;
  /**
   * Shape nodes the DOM paints: the renderer cannot draw them, or a DOM-painted node earlier in
   * paint order overlaps their painted bounds.
   */
  domPainted: Set<string>;
}

type RGBA4 = [number, number, number, number];

function hasEffects(f: { blur?: unknown; saturate?: unknown; grayscale?: unknown; brightness?: unknown; sepia?: unknown; invert?: unknown; hueRotate?: unknown } | undefined): boolean {
  return !!f && (f.blur !== undefined || f.saturate !== undefined || f.grayscale !== undefined || f.brightness !== undefined || f.sepia !== undefined || f.invert !== undefined || f.hueRotate !== undefined);
}

function classicSolid(css: string): boolean {
  if (css === "white" || css === "black") return true;
  if (/^#[0-9a-f]{3,8}$/.test(css)) return true;
  return /^rgba?\(/.test(css);
}

/** A classic sRGB color (or `$token`) as straight RGBA 0..1. Modern colors and gradients stay on the DOM. */
export function solidColor(doc: Document, value: string | undefined, mode?: string): RGBA4 | null {
  if (value === undefined) return [0, 0, 0, 0];
  const css = String(resolveValue(doc, value, mode)).trim().toLowerCase();
  if (css === "transparent" || css === "none") return [0, 0, 0, 0];
  if (!classicSolid(css)) return null;
  const c = parseColor(css);
  return c ? [c.r / 255, c.g / 255, c.b / 255, c.a] : null;
}

type Shape = Exclude<SceneNode, { type: "group" | "text" | "image" | "shape" | "connector" }>;
const SHAPES = new Set<Node["type"]>(["frame", "rect", "ellipse", "path"]);
const isShape = (n: Node): n is Shape => SHAPES.has(n.type);

function unevenCorners(doc: Document, n: Node): boolean {
  if ((n.type !== "frame" && n.type !== "rect") || !Array.isArray(n.radius)) return false;
  return uniformCorner(resolveCorners(doc, n.radius, modeOf(doc, n))) === undefined;
}

function underUnevenFrame(doc: Document, n: Node): boolean {
  const seen = new Set<string>();
  let id = n.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const p = doc.nodes[id];
    if (!p) return false;
    if (p.type === "frame" && unevenCorners(doc, p)) return true;
    id = p.parentId;
  }
  return false;
}

/** True when the WASM layer can draw this node's own paint exactly as `nodeStyle` would.
 * Diagram `shape` nodes stay on the DOM, including cylinder, parallelogram and cloud. */
export function wasmPaintable(doc: Document, n: Node): boolean {
  if (underUnevenFrame(doc, n) || unevenCorners(doc, n)) return false;
  if (!isShape(n)) return false;
  if (nodeGradient(n)) return false;
  if (!solidColor(doc, n.fill, modeOf(doc, n))) return false;
  if (n.stroke && !solidColor(doc, n.stroke.color, modeOf(doc, n))) return false;
  const shadows = listShadows(n.shadow);
  if (n.outline || hasEffects(n.filter) || hasEffects(n.backdropFilter)) return false;
  if (shadows.length > 1 || shadows.some((s) => s.inner)) return false;
  if (shadows[0] && (n.type === "path" || !solidColor(doc, shadows[0].color, modeOf(doc, n)))) return false;
  // WASM paints solid centered path strokes and solid inside box borders only.
  if (n.stroke && (resolveLength(doc, n.stroke.width, modeOf(doc, n)) ?? 0) > 0) {
    if (strokeStyleOf(n.stroke) !== "solid") return false;
    const wasmPos = n.type === "path" ? "center" : "inside";
    if (strokePositionOf(n) !== wasmPos) return false;
  }
  return true;
}

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Pivot {
  cx: number;
  cy: number;
  rad: number;
}

const BLUR_PAD = 2;

function rotationOf(n: Node): number {
  return "rotation" in n ? n.rotation : 0;
}

function spin(x: number, y: number, cx: number, cy: number, rad: number): [number, number] {
  if (!rad) return [x, y];
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function aabbOf(pts: ReadonlyArray<readonly [number, number]>): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function placed(rect: AABB, ox: number, oy: number, rotation: number, pivots: readonly Pivot[]): AABB {
  let pts: Array<[number, number]> = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ];
  pts = pts.map(([x, y]) => spin(x, y, ox, oy, (rotation * Math.PI) / 180));
  for (const p of pivots) pts = pts.map(([x, y]) => spin(x, y, p.cx, p.cy, p.rad));
  return aabbOf(pts);
}

function clipTo(a: AABB, clips: readonly AABB[]): AABB | null {
  let r = a;
  for (const c of clips) {
    const minX = Math.max(r.minX, c.minX);
    const minY = Math.max(r.minY, c.minY);
    const maxX = Math.min(r.maxX, c.maxX);
    const maxY = Math.min(r.maxY, c.maxY);
    if (minX >= maxX || minY >= maxY) return null;
    r = { minX, minY, maxX, maxY };
  }
  return r;
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function strokeOutset(doc: Document, n: Node): number {
  if (!("stroke" in n) || !n.stroke) return 0;
  const w = resolveLength(doc, n.stroke.width, modeOf(doc, n)) ?? 0;
  if (w <= 0) return 0;
  if (n.type === "connector") return w / 2;
  const pos = strokePositionOf(n);
  if (pos === "outside") return w;
  if (pos === "center") return w / 2;
  return 0;
}

function covers(doc: Document, n: Node): boolean {
  if (n.type === "group" || n.type === "page") return false;
  if (n.type === "image" || n.type === "shape" || n.type === "connector") return true;
  if (n.type === "text" && n.text.length > 0) return true;
  if (nodeGradient(n)) return true;
  if ("fill" in n && n.fill !== undefined) {
    const css = String(resolveValue(doc, n.fill, modeOf(doc, n))).trim().toLowerCase();
    if (css !== "" && css !== "transparent" && css !== "none") return true;
  }
  if ("stroke" in n && n.stroke && (resolveLength(doc, n.stroke.width, modeOf(doc, n)) ?? 0) > 0) return true;
  if ("shadow" in n && listShadows(n.shadow).some((s) => !s.inner)) return true;
  if ("outline" in n && n.outline && (resolveLength(doc, n.outline.width, modeOf(doc, n)) ?? 0) > 0) return true;
  if (hasEffects("filter" in n ? n.filter : undefined)) return true;
  return false;
}

function coverage(doc: Document, n: Node, b: Box): AABB {
  const mode = modeOf(doc, n);
  const len = (v: number | string | undefined) => resolveLength(doc, v, mode) ?? 0;
  let pad = Math.max(strokeOutset(doc, n), 0);
  if ("outline" in n && n.outline) {
    const w = len(n.outline.width);
    const off = n.outline.offset !== undefined ? len(n.outline.offset) : 0;
    pad = Math.max(pad, w + Math.max(0, off));
  }
  if ("filter" in n && n.filter?.blur !== undefined) pad = Math.max(pad, len(n.filter.blur) * BLUR_PAD);
  let minX = b.x - pad;
  let minY = b.y - pad;
  let maxX = b.x + b.w + pad;
  let maxY = b.y + b.h + pad;
  if ("shadow" in n) {
    for (const s of listShadows(n.shadow)) {
      if (s.inner) continue;
      const reach = Math.max(0, len(s.spread)) + len(s.blur) * BLUR_PAD;
      const dx = len(s.x);
      const dy = len(s.y);
      minX = Math.min(minX, b.x + dx - reach);
      minY = Math.min(minY, b.y + dy - reach);
      maxX = Math.max(maxX, b.x + b.w + dx + reach);
      maxY = Math.max(maxY, b.y + b.h + dy + reach);
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * `pageId` picks the page the canvas shows (default: the first page, or the whole document when
 * it has no pages). Groups paint nothing: their children are drawn with the group's opacity.
 */
export function displayList(doc: Document, boxes: ReadonlyMap<string, Box>, pageId?: string): DisplayList {
  const out: number[] = [];
  const paths: string[] = [];
  const painted = new Set<string>();
  const domPainted = new Set<string>();
  const regions: AABB[] = [];
  const clips: AABB[] = [];

  const emit = (kind: number, n: Shape, b: Box, opacity: number, paint: boolean) => {
    const mode = modeOf(doc, n);
    const len = (v: number | string | undefined) => resolveLength(doc, v, mode) ?? 0;
    const f = (paint && solidColor(doc, n.fill, mode)) || [0, 0, 0, 0];
    const sw = n.stroke ? len(n.stroke.width) : 0;
    const s = paint && n.stroke && sw > 0 ? solidColor(doc, n.stroke.color, mode) : null;
    const one = paint ? listShadows(n.shadow)[0] : undefined;
    const sh = one && !one.inner ? solidColor(doc, one.color, mode) : null;
    out.push(
      kind,
      b.x,
      b.y,
      b.w,
      b.h,
      n.type === "ellipse" || n.type === "path" ? 0 : Array.isArray(n.radius) ? resolveCorners(doc, n.radius, mode)[0]! : len(n.radius),
      n.rotation,
      opacity,
      ...f,
      s ? sw : 0,
      ...(s ?? [0, 0, 0, 0]),
      sh && one ? len(one.x) : 0,
      sh && one ? len(one.y) : 0,
      sh && one ? len(one.blur) : 0,
      sh && one ? len(one.spread) : 0,
      ...(sh ?? [0, 0, 0, 0]),
    );
  };

  const walk = (id: string, parentOpacity: number, pivots: readonly Pivot[]) => {
    const n = doc.nodes[id];
    const b = boxes.get(id);
    // No box means the DOM did not lay it out (hidden, or not rendered): skip the subtree.
    if (!n || n.type === "page" || !b || !n.visible) return;
    const o = parentOpacity * n.opacity;
    if (n.type === "group") {
      for (const c of n.children) walk(c, o, pivots);
      return;
    }
    const rot = rotationOf(n);
    const originX = b.x + b.w / 2;
    const originY = b.y + b.h / 2;
    const visual = placed(coverage(doc, n, b), originX, originY, rot, pivots);
    const clipped = clipTo(visual, clips);
    const blocked = !!clipped && regions.some((r) => overlaps(clipped, r));
    const onWasm = wasmPaintable(doc, n) && clipped !== null && !blocked;
    if (isShape(n)) (onWasm ? painted : domPainted).add(id);
    if (!onWasm && o > 0 && covers(doc, n) && clipped) regions.push(clipped);
    const childPivots = rot ? [{ cx: originX, cy: originY, rad: (rot * Math.PI) / 180 }, ...pivots] : pivots;
    switch (n.type) {
      case "frame": {
        const clip = n.clip && !unevenCorners(doc, n);
        if (clip) emit(KIND.pushClip, n, b, o, onWasm);
        else if (onWasm) emit(KIND.rect, n, b, o, true);
        if (n.clip) clips.push(placed({ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h }, originX, originY, rot, pivots));
        for (const c of n.children) walk(c, o, childPivots);
        if (n.clip) clips.pop();
        if (clip) out.push(KIND.popClip, ...new Array<number>(DISPLAY_STRIDE - 1).fill(0));
        break;
      }
      case "rect":
        if (onWasm) emit(KIND.rect, n, b, o, true);
        break;
      case "ellipse":
        if (onWasm) emit(KIND.ellipse, n, b, o, true);
        break;
      case "path":
        if (onWasm) {
          const vb = n.viewBox ?? [0, 0, 0, 0];
          paths.push(`${vb.join(" ")} ${n.fillRule} ${n.strokeCap} ${n.strokeJoin}|${n.d.replace(/\s+/g, " ")}`);
          emit(KIND.path, n, b, o, true);
          out[out.length - DISPLAY_STRIDE + 5] = paths.length - 1;
        }
        break;
      default:
        break; // text and images stay in the DOM layer
    }
  };
  for (const id of pageRoots(doc, pageId)) walk(id, 1, []);
  return { data: new Float32Array(out), paths: paths.join("\n"), count: out.length / DISPLAY_STRIDE, painted, domPainted };
}
