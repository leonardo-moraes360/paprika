import { applyViewBox, arcToCubic, flattenCubic, flattenQuad, transformLocal } from "./boolean.js";
import { round4 } from "./num.js";
import { parsePath, serializePath, type Point, type Segment } from "./path.js";
import type { Document, PathNode } from "./schema.js";
import { modeOf, resolveLength, strokeStyleOf } from "./style.js";
import type { Op } from "./ops.js";

export const OUTLINE_FLAT = 0.05;
export const MITER_LIMIT = 4;

export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";

export interface StrokeOutlineParams {
  width: number;
  cap: StrokeCap;
  join: StrokeJoin;
}

type Pt = Point;

interface Poly {
  pts: Pt[];
  closed: boolean;
}

const TINY = 1e-9;

const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

function flattenPolys(segs: Segment[]): Poly[] {
  const out: Poly[] = [];
  let cur: Poly | null = null;
  let drew = false;
  let pos: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  const push = (p: Pt) => {
    if (!cur) {
      cur = { pts: [{ ...start }], closed: false };
      drew = false;
    }
    if (!near(cur.pts[cur.pts.length - 1]!, p)) cur.pts.push({ x: p.x, y: p.y });
    drew = true;
  };
  const finish = (closed: boolean) => {
    if (!cur) return;
    cur.closed = closed;
    if (closed && cur.pts.length > 1 && near(cur.pts[0]!, cur.pts[cur.pts.length - 1]!)) cur.pts.pop();
    if (cur.pts.length > 1 || drew) out.push(cur);
    cur = null;
  };
  for (const s of segs) {
    if (s.cmd === "M") {
      finish(false);
      start = s.to;
      pos = s.to;
      cur = { pts: [{ ...s.to }], closed: false };
      drew = false;
      continue;
    }
    if (s.cmd === "Z") {
      if (cur) {
        drew = true;
        finish(true);
      }
      pos = start;
      continue;
    }
    if (!cur) cur = { pts: [{ ...start }], closed: false };
    if (s.cmd === "L") push(s.to);
    else if (s.cmd === "C") {
      const pts: Pt[] = [];
      flattenCubic(pos, s.c1, s.c2, s.to, pts, OUTLINE_FLAT);
      for (const p of pts) push(p);
      drew = true;
    } else if (s.cmd === "Q") {
      const pts: Pt[] = [];
      flattenQuad(pos, s.c, s.to, pts, OUTLINE_FLAT);
      for (const p of pts) push(p);
      drew = true;
    } else {
      for (const p of arcToCubic(pos, s, OUTLINE_FLAT)) push(p);
      drew = true;
    }
    pos = s.to;
  }
  finish(false);
  return out;
}

function arcStep(hw: number): number {
  if (hw <= OUTLINE_FLAT) return Math.PI / 2;
  return Math.min(Math.PI / 2, 2 * Math.acos(1 - OUTLINE_FLAT / hw));
}

function arcPoints(c: Pt, hw: number, a0: number, delta: number, out: Pt[]): void {
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / arcStep(hw)));
  for (let k = 1; k < steps; k++) {
    const a = a0 + (delta * k) / steps;
    out.push({ x: c.x + hw * Math.cos(a), y: c.y + hw * Math.sin(a) });
  }
}

function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

function joinPoints(p: Pt, d0: Pt, d1: Pt, hw: number, join: StrokeJoin, out: Pt[]): void {
  const n0 = { x: -d0.y, y: d0.x };
  const n1 = { x: -d1.y, y: d1.x };
  const a = { x: p.x + n0.x * hw, y: p.y + n0.y * hw };
  const b = { x: p.x + n1.x * hw, y: p.y + n1.y * hw };
  const cr = d0.x * d1.y - d0.y * d1.x;
  const dt = d0.x * d1.x + d0.y * d1.y;
  if (Math.abs(cr) <= TINY && dt > 0) {
    out.push(a);
    return;
  }
  if (cr > TINY) {
    out.push(a, { x: p.x, y: p.y }, b);
    return;
  }
  const turn = Math.abs(cr) <= TINY ? Math.PI : Math.abs(Math.atan2(cr, dt));
  if (join === "round") {
    out.push(a);
    arcPoints(p, hw, Math.atan2(n0.y, n0.x), -turn, out);
    out.push(b);
  } else if (join === "miter" && turn < Math.PI - 1e-6 && 1 / Math.cos(turn / 2) <= MITER_LIMIT) {
    const k = hw / (1 + dt);
    out.push(a, { x: p.x + (n0.x + n1.x) * k, y: p.y + (n0.y + n1.y) * k }, b);
  } else out.push(a, b);
}

function capPoints(p: Pt, v: Pt, hw: number, cap: StrokeCap, out: Pt[]): void {
  const n = { x: -v.y, y: v.x };
  if (cap === "square") {
    out.push({ x: p.x + (n.x + v.x) * hw, y: p.y + (n.y + v.y) * hw }, { x: p.x + (v.x - n.x) * hw, y: p.y + (v.y - n.y) * hw });
  } else if (cap === "round") {
    arcPoints(p, hw, Math.atan2(n.y, n.x), -Math.PI, out);
  }
}

function leftSide(pts: Pt[], closed: boolean, hw: number, join: StrokeJoin): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  const dirs: Pt[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) dirs.push(unit(pts[i]!, pts[(i + 1) % n]!));
  const first = dirs[0]!;
  if (!closed) out.push({ x: pts[0]!.x - first.y * hw, y: pts[0]!.y + first.x * hw });
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    joinPoints(pts[i]!, dirs[(i + count - 1) % count]!, dirs[i % count]!, hw, join, out);
  }
  if (!closed) {
    const last = dirs[count - 1]!;
    out.push({ x: pts[n - 1]!.x - last.y * hw, y: pts[n - 1]!.y + last.x * hw });
  }
  return out;
}

function dot(p: Pt, hw: number, cap: StrokeCap): Pt[] {
  if (cap === "butt") return [];
  if (cap === "square") return [{ x: p.x - hw, y: p.y - hw }, { x: p.x + hw, y: p.y - hw }, { x: p.x + hw, y: p.y + hw }, { x: p.x - hw, y: p.y + hw }];
  const out: Pt[] = [{ x: p.x + hw, y: p.y }];
  arcPoints(p, hw, 0, 2 * Math.PI, out);
  return out;
}

export function outlineStrokeRings(segs: Segment[], params: StrokeOutlineParams): Pt[][] {
  const hw = params.width / 2;
  if (!(hw > 0)) return [];
  const rings: Pt[][] = [];
  for (const poly of flattenPolys(segs)) {
    const pts = poly.pts;
    if (pts.length === 1) {
      const r = dot(pts[0]!, hw, params.cap);
      if (r.length) rings.push(r);
      continue;
    }
    if (poly.closed) {
      rings.push(leftSide(pts, true, hw, params.join));
      rings.push(leftSide([...pts].reverse(), true, hw, params.join));
      continue;
    }
    const rev = [...pts].reverse();
    const ring = leftSide(pts, false, hw, params.join);
    capPoints(pts[pts.length - 1]!, unit(pts[pts.length - 2]!, pts[pts.length - 1]!), hw, params.cap, ring);
    ring.push(...leftSide(rev, false, hw, params.join));
    capPoints(pts[0]!, unit(pts[1]!, pts[0]!), hw, params.cap, ring);
    rings.push(ring);
  }
  return rings;
}

export function outlineStrokeD(segs: Segment[], params: StrokeOutlineParams): string {
  const out: Segment[] = [];
  for (const r of outlineStrokeRings(segs, params)) {
    out.push({ cmd: "M", to: r[0]! });
    for (let i = 1; i < r.length; i++) out.push({ cmd: "L", to: r[i]! });
    out.push({ cmd: "Z" });
  }
  return serializePath(out);
}

function mapViewBox(segs: Segment[], vb: [number, number, number, number], w: number, h: number): Segment[] {
  const map = (p: Pt) => applyViewBox(p, vb, w, h);
  const k = Math.min(w / vb[2], h / vb[3]);
  return segs.map((s): Segment => {
    switch (s.cmd) {
      case "M":
      case "L":
        return { ...s, to: map(s.to) };
      case "C":
        return { ...s, c1: map(s.c1), c2: map(s.c2), to: map(s.to) };
      case "Q":
        return { ...s, c: map(s.c), to: map(s.to) };
      case "A":
        return { ...s, rx: s.rx * k, ry: s.ry * k, to: map(s.to) };
      default:
        return s;
    }
  });
}

export interface OutlineStrokePlan {
  ops: Op[];
  id: string;
  d: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export function outlineStrokeOps(doc: Document, id: string, opts: { keepStroke?: boolean } = {}): OutlineStrokePlan {
  const n = doc.nodes[id];
  if (!n) throw new Error(`node "${id}" does not exist`);
  if (n.type !== "path") throw new Error(`"${id}" is ${n.type}; outline_stroke needs a path (convert_to_path turns a rect or ellipse into one)`);
  const node = n as PathNode;
  if (!node.stroke) throw new Error(`"${id}" has no stroke to outline`);
  const mode = modeOf(doc, node);
  const sw = resolveLength(doc, node.stroke.width, mode) ?? 0;
  if (!(sw > 0)) throw new Error(`"${id}" has a stroke of width 0: nothing to outline`);
  if (node.fill !== undefined || node.gradient !== undefined)
    throw new Error(`"${id}" has a fill besides the stroke; the outline is one paint. Remove the fill first (update_nodes {fill: null}) or outline a copy`);
  if (strokeStyleOf(node.stroke) !== "solid") throw new Error(`"${id}" has a ${strokeStyleOf(node.stroke)} stroke; outline_stroke only handles solid strokes`);
  const w = typeof node.width === "number" ? node.width : 0;
  const h = typeof node.height === "number" ? node.height : 0;
  let segs = parsePath(node.d);
  let width = sw;
  if (node.viewBox) {
    const vb = node.viewBox as [number, number, number, number];
    segs = mapViewBox(segs, vb, w, h);
    width = sw * Math.min(w / vb[2], h / vb[3]);
  }
  const rings = outlineStrokeRings(segs, { width, cap: node.strokeCap, join: node.strokeJoin });
  if (!rings.length) throw new Error(`"${id}" has nothing to outline (a single point with a butt cap)`);
  const world = rings.map((r) => r.map((p) => transformLocal(p, node.x, node.y, w, h, node.rotation)));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of world)
    for (const p of r) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  const bounds = { x: round4(minX), y: round4(minY), width: Math.max(1, round4(maxX - minX)), height: Math.max(1, round4(maxY - minY)) };
  const out: Segment[] = [];
  for (const r of world) {
    out.push({ cmd: "M", to: { x: r[0]!.x - bounds.x, y: r[0]!.y - bounds.y } });
    for (let i = 1; i < r.length; i++) out.push({ cmd: "L", to: { x: r[i]!.x - bounds.x, y: r[i]!.y - bounds.y } });
    out.push({ cmd: "Z" });
  }
  const d = serializePath(out);
  const props: Record<string, unknown> = {
    d,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fill: node.stroke.color,
    fillRule: "nonzero",
    viewBox: null,
  };
  if (node.rotation) props.rotation = 0;
  if (!opts.keepStroke) props.stroke = null;
  return { ops: [{ op: "update", id, props } as Op], id, d, bounds };
}
