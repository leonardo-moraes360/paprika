import { parsePath, pathBounds, serializePath, translatePath, type Point, type Segment } from "./path.js";

export const PATH_SHAPE_KINDS = ["star", "polygon", "ring", "arc", "sector"] as const;
export type PathShapeKind = (typeof PATH_SHAPE_KINDS)[number];

export interface PathShapeParams {
  points?: number;
  sides?: number;
  radius?: number;
  innerRadius?: number;
  thickness?: number;
  angle?: number;
  startAngle?: number;
  endAngle?: number;
  cornerRadius?: number;
  roundCaps?: boolean;
}

export interface PathShape {
  d: string;
  width: number;
  height: number;
  center: Point;
  fillRule?: "evenodd";
}

const EPS = 1e-9;
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (r: number, deg: number): Point => ({ x: r * Math.sin(rad(deg)), y: -r * Math.cos(rad(deg)) });
const M = (to: Point): Segment => ({ cmd: "M", to });
const L = (to: Point): Segment => ({ cmd: "L", to });
const arc = (r: number, large: boolean, sweep: boolean, to: Point): Segment => ({ cmd: "A", rx: r, ry: r, rotation: 0, largeArc: large, sweep, to });
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

interface Corner {
  a: Point;
  b: Point;
  r: number;
  sweep: boolean;
}

function cornerAt(prev: Point, p: Point, next: Point, radius: number): Corner | null {
  if (!(radius > 0)) return null;
  const lu = Math.hypot(prev.x - p.x, prev.y - p.y);
  const lv = Math.hypot(next.x - p.x, next.y - p.y);
  if (lu < EPS || lv < EPS) return null;
  const u = { x: (prev.x - p.x) / lu, y: (prev.y - p.y) / lu };
  const v = { x: (next.x - p.x) / lv, y: (next.y - p.y) / lv };
  const cos = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
  if (cos < -1 + EPS) return null;
  if (cos > 1 - EPS) return null;
  const tan = Math.sqrt((1 - cos) / (1 + cos));
  let t = radius / tan;
  const max = Math.min(lu, lv) / 2;
  let r = radius;
  if (t > max) {
    t = max;
    r = t * tan;
  }
  if (r < 1e-6) return null;
  const cross = -u.x * v.y + u.y * v.x;
  return { a: { x: p.x + u.x * t, y: p.y + u.y * t }, b: { x: p.x + v.x * t, y: p.y + v.y * t }, r, sweep: cross > 0 };
}

function roundedSubpath(pts: Point[], closed: boolean, radii: number[]): Segment[] {
  const n = pts.length;
  const corner = (i: number): Corner | null => {
    if (!closed && (i === 0 || i === n - 1)) return null;
    return cornerAt(pts[(i + n - 1) % n]!, pts[i]!, pts[(i + 1) % n]!, radii[i] ?? 0);
  };
  const segs: Segment[] = [];
  const c0 = corner(0);
  let cur: Point = c0 ? c0.b : pts[0]!;
  segs.push(M(cur));
  const goTo = (to: Point) => {
    if (!same(cur, to)) segs.push(L(to));
    cur = to;
  };
  for (let i = 1; i < n; i++) {
    const c = corner(i);
    if (!c) goTo(pts[i]!);
    else {
      goTo(c.a);
      segs.push(arc(c.r, false, c.sweep, c.b));
      cur = c.b;
    }
  }
  if (closed) {
    if (c0) {
      goTo(c0.a);
      segs.push(arc(c0.r, false, c0.sweep, c0.b));
    }
    segs.push({ cmd: "Z" });
  }
  return segs;
}

function polylines(segs: Segment[]): { pts: Point[]; closed: boolean }[] {
  const out: { pts: Point[]; closed: boolean }[] = [];
  let cur: { pts: Point[]; closed: boolean } | null = null;
  const push = (p: Point) => {
    if (cur && !(cur.pts.length && same(cur.pts[cur.pts.length - 1]!, p))) cur.pts.push(p);
  };
  segs.forEach((s, i) => {
    if (s.cmd === "M") {
      cur = { pts: [], closed: false };
      out.push(cur);
      push(s.to);
    } else if (s.cmd === "L") {
      push(s.to);
    } else if (s.cmd === "Z") {
      if (cur) cur.closed = true;
    } else {
      throw new Error(`round_path_corners only rounds straight edges (M L H V Z); segment ${i + 1} is ${s.cmd}`);
    }
  });
  for (const p of out) {
    if (p.closed && p.pts.length > 1 && same(p.pts[0]!, p.pts[p.pts.length - 1]!)) p.pts.pop();
  }
  return out;
}

export function roundPathCorners(d: string, opts: { radius?: number; radii?: (number | null)[] }): string {
  const segs = parsePath(d);
  const subs = polylines(segs);
  const out: Segment[] = [];
  let k = 0;
  for (const sub of subs) {
    const radii = sub.pts.map((_, i) => {
      const own = opts.radii?.[k + i];
      return own == null ? (opts.radius ?? 0) : own;
    });
    k += sub.pts.length;
    if (sub.pts.length < 2) {
      out.push(M(sub.pts[0]!));
      continue;
    }
    out.push(...roundedSubpath(sub.pts, sub.closed, radii));
  }
  return serializePath(out);
}

function num(name: string, v: number | undefined, min: number, max = 1e6): number {
  if (v === undefined || !Number.isFinite(v)) throw new Error(`${name} is required`);
  if (v < min || v > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return v;
}

const circle = (r: number): Segment[] => [M({ x: 0, y: -r }), arc(r, true, true, { x: 0, y: r }), arc(r, true, true, { x: 0, y: -r }), { cmd: "Z" }];

function sweepOf(p: PathShapeParams): { start: number; sweep: number } {
  const start = num("startAngle", p.startAngle, -3600, 3600);
  const end = num("endAngle", p.endAngle, -3600, 3600);
  if (start === end) throw new Error("startAngle and endAngle are the same: the sweep is empty");
  let sweep = (((end - start) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  return { start, sweep };
}

function holeRadius(R: number, p: PathShapeParams): number {
  if (p.innerRadius !== undefined && p.thickness !== undefined) throw new Error("pass innerRadius or thickness, not both");
  let inner: number;
  if (p.innerRadius !== undefined) inner = num("innerRadius", p.innerRadius, 0.01);
  else inner = R - num("thickness", p.thickness, 0.01);
  if (!(inner > 0 && inner < R)) throw new Error(`the hole radius (${inner}) must be between 0 and the radius (${R}); use kind "sector" for a solid wedge`);
  return inner;
}

function shapeSegments(kind: PathShapeKind, p: PathShapeParams): { segs: Segment[]; evenodd: boolean } {
  const R = num("radius", p.radius, 0.01);
  const angle = p.angle ?? 0;
  const cr = p.cornerRadius ?? 0;
  if (cr < 0) throw new Error("cornerRadius must be 0 or more");
  if (cr > 0 && kind !== "star" && kind !== "polygon") throw new Error("cornerRadius only applies to star and polygon");
  if (p.angle !== undefined && kind !== "star" && kind !== "polygon") throw new Error("angle only applies to star and polygon (use startAngle and endAngle for arc and sector)");
  if (p.roundCaps && kind !== "arc") throw new Error("roundCaps only applies to arc");
  switch (kind) {
    case "star": {
      const n = Math.round(num("points", p.points, 3, 100));
      const inner = p.innerRadius === undefined ? R / 2 : num("innerRadius", p.innerRadius, 0.01);
      const pts = Array.from({ length: 2 * n }, (_, i) => polar(i % 2 === 0 ? R : inner, angle + (i * 180) / n));
      return { segs: roundedSubpath(pts, true, pts.map(() => cr)), evenodd: false };
    }
    case "polygon": {
      const n = Math.round(num("sides", p.sides, 3, 100));
      const pts = Array.from({ length: n }, (_, i) => polar(R, angle + (i * 360) / n));
      return { segs: roundedSubpath(pts, true, pts.map(() => cr)), evenodd: false };
    }
    case "ring": {
      const inner = holeRadius(R, p);
      return { segs: [...circle(R), ...circle(inner)], evenodd: true };
    }
    case "arc": {
      const inner = holeRadius(R, p);
      const { start, sweep } = sweepOf(p);
      if (sweep >= 360) return { segs: [...circle(R), ...circle(inner)], evenodd: true };
      const large = sweep > 180;
      const end = start + sweep;
      const capR = (R - inner) / 2;
      const segs: Segment[] = [M(polar(R, start)), arc(R, large, true, polar(R, end))];
      segs.push(p.roundCaps ? arc(capR, false, true, polar(inner, end)) : L(polar(inner, end)));
      segs.push(arc(inner, large, false, polar(inner, start)));
      if (p.roundCaps) segs.push(arc(capR, false, true, polar(R, start)));
      segs.push({ cmd: "Z" });
      return { segs, evenodd: false };
    }
    default: {
      const { start, sweep } = sweepOf(p);
      if (sweep >= 360) return { segs: circle(R), evenodd: false };
      const end = start + sweep;
      return { segs: [M({ x: 0, y: 0 }), L(polar(R, start)), arc(R, sweep > 180, true, polar(R, end)), { cmd: "Z" }], evenodd: false };
    }
  }
}

export function shapePath(kind: PathShapeKind, params: PathShapeParams): PathShape {
  if (!PATH_SHAPE_KINDS.includes(kind)) throw new Error(`unknown shape kind "${kind}" (star, polygon, ring, arc, sector)`);
  const { segs, evenodd } = shapeSegments(kind, params);
  const b = pathBounds(segs);
  const moved = translatePath(segs, -b.x, -b.y);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: PathShape = { d: serializePath(moved), width: r2(b.width), height: r2(b.height), center: { x: r2(-b.x), y: r2(-b.y) } };
  if (evenodd) out.fillRule = "evenodd";
  return out;
}
