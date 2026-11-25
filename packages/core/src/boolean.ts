import type { Document, Node as NodeT, PathNode } from "./schema.js";
import { isContainer } from "./schema.js";
import { newId } from "./id.js";
import { round4 } from "./num.js";
import { parsePath, serializePath, translatePath, type Point, type Segment } from "./path.js";
import { shapeOutline } from "./diagram.js";
import { modeOf, resolveCorners, resolveLength, usedCornerRadii } from "./style.js";
import type { Op } from "./ops.js";

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

export const BOOLEAN_OPS = ["union", "subtract", "intersect", "exclude"] as const;

const EPS = 1e-9;
const FLAT = 0.25;
const ELLIPSE_N = 64;
const COMBINE_TYPES = new Set(["rect", "ellipse", "path", "shape"]);

type Pt = Point;
type Ring = Pt[];
type Poly = { outer: Ring; holes: Ring[] };
type Multi = Poly[];

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

function samePt(a: Pt, b: Pt): boolean {
  return nearly(a.x, b.x) && nearly(a.y, b.y);
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function area(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function ensureCCW(ring: Ring): Ring {
  return area(ring) < 0 ? ring.slice().reverse() : ring;
}

function ensureCW(ring: Ring): Ring {
  return area(ring) > 0 ? ring.slice().reverse() : ring;
}

function cleanRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const q = { x: round4(p.x), y: round4(p.y) };
    if (!out.length || !samePt(out[out.length - 1]!, q)) out.push(q);
  }
  if (out.length > 1 && samePt(out[0]!, out[out.length - 1]!)) out.pop();
  if (out.length < 3) return [];
  let min = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i]!;
    const b = out[min]!;
    if (a.x < b.x || (a.x === b.x && a.y < b.y)) min = i;
  }
  if (min) out.push(...out.splice(0, min));
  return out;
}

function pointInRing(p: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const hit = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 0) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInPoly(p: Pt, poly: Poly): boolean {
  if (!pointInRing(p, poly.outer)) return false;
  for (const h of poly.holes) if (pointInRing(p, h)) return false;
  return true;
}

function pointInMulti(p: Pt, multi: Multi): boolean {
  for (const poly of multi) if (pointInPoly(p, poly)) return true;
  return false;
}

function windingAt(p: Pt, ring: Ring): number {
  let w = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (a.y <= p.y) {
      if (b.y > p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0) w++;
    } else if (b.y <= p.y && cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) < 0) w--;
  }
  return w;
}

function transformLocal(pt: Pt, x: number, y: number, w: number, h: number, rotation: number): Pt {
  if (!rotation) return { x: round4(x + pt.x), y: round4(y + pt.y) };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - w / 2;
  const dy = pt.y - h / 2;
  return {
    x: round4(x + w / 2 + dx * cos - dy * sin),
    y: round4(y + h / 2 + dx * sin + dy * cos),
  };
}

function mapRing(ring: Ring, x: number, y: number, w: number, h: number, rotation: number): Ring {
  return cleanRing(ring.map((p) => transformLocal(p, x, y, w, h, rotation)));
}

function rectRing(w: number, h: number, radii: [number, number, number, number]): Ring {
  const [tl, tr, br, bl] = usedCornerRadii(w, h, radii);
  if ((tl === 0 && tr === 0 && br === 0 && bl === 0) || w < 1 || h < 1) return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const segs = flattenSegments([
    { cmd: "M", to: { x: tl, y: 0 } },
    { cmd: "L", to: { x: w - tr, y: 0 } },
    ...(tr ? [{ cmd: "A" as const, rx: tr, ry: tr, rotation: 0, largeArc: false, sweep: true, to: { x: w, y: tr } }] : []),
    { cmd: "L", to: { x: w, y: h - br } },
    ...(br ? [{ cmd: "A" as const, rx: br, ry: br, rotation: 0, largeArc: false, sweep: true, to: { x: w - br, y: h } }] : []),
    { cmd: "L", to: { x: bl, y: h } },
    ...(bl ? [{ cmd: "A" as const, rx: bl, ry: bl, rotation: 0, largeArc: false, sweep: true, to: { x: 0, y: h - bl } }] : []),
    { cmd: "L", to: { x: 0, y: tl } },
    ...(tl ? [{ cmd: "A" as const, rx: tl, ry: tl, rotation: 0, largeArc: false, sweep: true, to: { x: tl, y: 0 } }] : []),
    { cmd: "Z" },
  ]);
  return segs[0] ?? [];
}

function ellipseRing(w: number, h: number): Ring {
  const rx = w / 2;
  const ry = h / 2;
  const out: Ring = [];
  for (let i = 0; i < ELLIPSE_N; i++) {
    const t = (i / ELLIPSE_N) * Math.PI * 2;
    out.push({ x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) });
  }
  return out;
}

function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[]): void {
  const step = (a: Pt, b: Pt, c: Pt, d: Pt): void => {
    const dx = d.x - a.x;
    const dy = d.y - a.y;
    const d2 = Math.abs((b.x - d.x) * dy - (b.y - d.y) * dx) + Math.abs((c.x - d.x) * dy - (c.y - d.y) * dx);
    if (d2 * d2 <= FLAT * FLAT * (dx * dx + dy * dy) || dist2(a, d) < FLAT * FLAT) {
      out.push(d);
      return;
    }
    const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const cd = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    const abc = { x: (ab.x + bc.x) / 2, y: (ab.y + bc.y) / 2 };
    const bcd = { x: (bc.x + cd.x) / 2, y: (bc.y + cd.y) / 2 };
    const m = { x: (abc.x + bcd.x) / 2, y: (abc.y + bcd.y) / 2 };
    step(a, ab, abc, m);
    step(m, bcd, cd, d);
  };
  step(p0, p1, p2, p3);
}

function flattenQuad(p0: Pt, p1: Pt, p2: Pt, out: Pt[]): void {
  flattenCubic(p0, { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) }, { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }, p2, out);
}

function arcToCubic(from: Pt, s: Extract<Segment, { cmd: "A" }>): Pt[] {
  let { rx, ry } = s;
  if (rx === 0 || ry === 0 || (from.x === s.to.x && from.y === s.to.y)) return [s.to];
  const phi = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - s.to.x) / 2;
  const dy = (from.y - s.to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const sq = Math.sqrt(Math.max(0, num / den));
  const k = (s.largeArc === s.sweep ? -1 : 1) * sq;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + s.to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + s.to.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!s.sweep && dt > 0) dt -= 2 * Math.PI;
  if (s.sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a1 = t1 + (dt * i) / n;
    const a2 = t1 + (dt * (i + 1)) / n;
    const alpha = (Math.sin(a2 - a1) * (Math.sqrt(4 + 3 * Math.tan((a2 - a1) / 2) ** 2) - 1)) / 3;
    const e1 = { x: cx + rx * Math.cos(a1) * cos - ry * Math.sin(a1) * sin, y: cy + rx * Math.cos(a1) * sin + ry * Math.sin(a1) * cos };
    const e2 = { x: cx + rx * Math.cos(a2) * cos - ry * Math.sin(a2) * sin, y: cy + rx * Math.cos(a2) * sin + ry * Math.sin(a2) * cos };
    const d1 = { x: -rx * Math.sin(a1) * cos - ry * Math.cos(a1) * sin, y: -rx * Math.sin(a1) * sin + ry * Math.cos(a1) * cos };
    const d2 = { x: -rx * Math.sin(a2) * cos - ry * Math.cos(a2) * sin, y: -rx * Math.sin(a2) * sin + ry * Math.cos(a2) * cos };
    const c1 = { x: e1.x + alpha * d1.x, y: e1.y + alpha * d1.y };
    const c2 = { x: e2.x - alpha * d2.x, y: e2.y - alpha * d2.y };
    const pts: Pt[] = [];
    flattenCubic(i === 0 ? from : out[out.length - 1]!, c1, c2, e2, pts);
    out.push(...pts);
  }
  return out;
}

function flattenSegments(segs: Segment[]): Ring[] {
  const rings: Ring[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let ring: Ring = [];
  const push = (p: Pt) => {
    if (!ring.length || !samePt(ring[ring.length - 1]!, p)) ring.push(p);
  };
  for (const s of segs) {
    switch (s.cmd) {
      case "M":
        if (ring.length >= 3) rings.push(ring);
        ring = [];
        start = s.to;
        cur = s.to;
        push(s.to);
        break;
      case "L":
        push(s.to);
        cur = s.to;
        break;
      case "C": {
        const pts: Pt[] = [];
        flattenCubic(cur, s.c1, s.c2, s.to, pts);
        for (const p of pts) push(p);
        cur = s.to;
        break;
      }
      case "Q": {
        const pts: Pt[] = [];
        flattenQuad(cur, s.c, s.to, pts);
        for (const p of pts) push(p);
        cur = s.to;
        break;
      }
      case "A": {
        for (const p of arcToCubic(cur, s)) push(p);
        cur = s.to;
        break;
      }
      default:
        if (!samePt(cur, start)) push(start);
        if (ring.length >= 3) rings.push(ring);
        ring = [];
        cur = start;
        break;
    }
  }
  if (ring.length >= 3) rings.push(ring);
  return rings.map(cleanRing).filter((r) => r.length >= 3);
}

function applyViewBox(pt: Pt, vb: [number, number, number, number], w: number, h: number): Pt {
  const [vx, vy, vw, vh] = vb;
  const s = Math.min(w / vw, h / vh);
  const ox = (w - vw * s) / 2;
  const oy = (h - vh * s) / 2;
  return { x: ox + (pt.x - vx) * s, y: oy + (pt.y - vy) * s };
}

function ringsToMulti(rings: Ring[], fillRule: "nonzero" | "evenodd"): Multi {
  if (!rings.length) return [];
  const cleaned = rings.map(cleanRing).filter((r) => r.length >= 3);
  if (!cleaned.length) return [];
  const areas = cleaned.map((r) => ({ r, a: Math.abs(area(r)) }));
  areas.sort((a, b) => b.a - a.a);
  const used = new Set<number>();
  const multi: Multi = [];
  for (let i = 0; i < areas.length; i++) {
    if (used.has(i)) continue;
    const outer = ensureCCW(areas[i]!.r);
    const holes: Ring[] = [];
    used.add(i);
    const sample = outer[0]!;
    for (let j = 0; j < areas.length; j++) {
      if (used.has(j) || j === i) continue;
      const cand = areas[j]!.r;
      const inside =
        fillRule === "evenodd"
          ? pointInRing(cand[0]!, outer)
          : Math.abs(windingAt(cand[0]!, outer)) > 0;
      if (!inside) continue;
      let nested = false;
      for (let k = 0; k < areas.length; k++) {
        if (k === i || k === j || used.has(k)) continue;
        if (pointInRing(cand[0]!, areas[k]!.r) && pointInRing(areas[k]!.r[0]!, outer)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      const holeInside = fillRule === "evenodd" ? pointInRing(sample, cand) === false : true;
      if (holeInside || fillRule === "evenodd") {
        holes.push(ensureCW(cand));
        used.add(j);
      }
    }
    multi.push({ outer, holes });
  }
  return multi;
}

function nodeGeometry(doc: Document, n: NodeT): Multi {
  if (n.type === "page" || n.type === "group" || n.type === "connector" || n.type === "frame" || n.type === "text" || n.type === "image") return [];
  const w = typeof n.width === "number" ? n.width : 0;
  const h = typeof n.height === "number" ? n.height : 0;
  const rot = n.rotation;
  const mode = modeOf(doc, n);
  if (n.type === "rect") {
    const ring = mapRing(rectRing(w, h, resolveCorners(doc, n.radius, mode)), n.x, n.y, w, h, rot);
    return ring.length >= 3 ? [{ outer: ensureCCW(ring), holes: [] }] : [];
  }
  if (n.type === "ellipse") {
    const ring = mapRing(ellipseRing(w, h), n.x, n.y, w, h, rot);
    return ring.length >= 3 ? [{ outer: ensureCCW(ring), holes: [] }] : [];
  }
  if (n.type === "shape") {
    const radius = resolveLength(doc, n.radius, mode) ?? 0;
    const stroke = n.stroke ? { ...n.stroke, width: resolveLength(doc, n.stroke.width, mode) ?? 0 } : undefined;
    const local = flattenSegments(parsePath(shapeOutline({ ...n, radius, stroke }).d));
    const rings = local.map((r) => mapRing(r, n.x, n.y, w, h, rot)).filter((r) => r.length >= 3);
    return ringsToMulti(rings, "nonzero");
  }
  if (n.type === "path") {
    let segs = parsePath(n.d);
    if (n.viewBox) {
      const vb = n.viewBox as [number, number, number, number];
      segs = segs.map((s) => {
        const map = (p: Pt) => applyViewBox(p, vb, w, h);
        switch (s.cmd) {
          case "M":
          case "L":
            return { ...s, to: map(s.to) };
          case "C":
            return { ...s, c1: map(s.c1), c2: map(s.c2), to: map(s.to) };
          case "Q":
            return { ...s, c: map(s.c), to: map(s.to) };
          case "A":
            return {
              ...s,
              rx: s.rx * Math.min(w / vb[2], h / vb[3]),
              ry: s.ry * Math.min(w / vb[2], h / vb[3]),
              to: map(s.to),
            };
          default:
            return s;
        }
      });
    }
    const rings = flattenSegments(segs)
      .map((r) => mapRing(r, n.x, n.y, w, h, rot))
      .filter((r) => r.length >= 3);
    return ringsToMulti(rings, n.fillRule);
  }
  return [];
}

function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const den = cross(dax, day, dbx, dby);
  if (Math.abs(den) < EPS) return null;
  const t = cross(b1.x - a1.x, b1.y - a1.y, dbx, dby) / den;
  const u = cross(b1.x - a1.x, b1.y - a1.y, dax, day) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: round4(a1.x + t * dax), y: round4(a1.y + t * day) };
}

type Edge = { a: Pt; b: Pt; src: 0 | 1 };

function polyEdges(multi: Multi, src: 0 | 1): Edge[] {
  const edges: Edge[] = [];
  const add = (ring: Ring) => {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      if (!samePt(a, b)) edges.push({ a, b, src });
    }
  };
  for (const p of multi) {
    add(p.outer);
    for (const h of p.holes) add(h);
  }
  return edges;
}

function splitEdges(edges: Edge[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const cuts: { t: number; p: Pt }[] = [];
    for (let j = 0; j < edges.length; j++) {
      if (i === j) continue;
      const o = edges[j]!;
      const p = segIntersect(e.a, e.b, o.a, o.b);
      if (!p || samePt(p, e.a) || samePt(p, e.b)) continue;
      const t = Math.abs(e.b.x - e.a.x) >= Math.abs(e.b.y - e.a.y) ? (p.x - e.a.x) / (e.b.x - e.a.x || 1) : (p.y - e.a.y) / (e.b.y - e.a.y || 1);
      cuts.push({ t, p });
    }
    cuts.sort((a, b) => a.t - b.t);
    let prev = e.a;
    for (const c of cuts) {
      if (samePt(prev, c.p)) continue;
      out.push({ a: prev, b: c.p, src: e.src });
      prev = c.p;
    }
    if (!samePt(prev, e.b)) out.push({ a: prev, b: e.b, src: e.src });
  }
  return out;
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Seleciona o fragmento e se a direção deve ser invertida (buracos / XOR). */
function selectFragment(inA: boolean, inB: boolean, src: 0 | 1, op: BooleanOp): "keep" | "rev" | null {
  switch (op) {
    case "union":
      return (src === 0 ? !inB : !inA) ? "keep" : null;
    case "intersect":
      return (src === 0 ? inB : inA) ? "keep" : null;
    case "subtract":
      if (src === 0) return !inB ? "keep" : null;
      return inA ? "rev" : null;
    case "exclude":
      if (src === 0) return inB ? "rev" : "keep";
      return inA ? "rev" : "keep";
  }
}

function linkRings(fragments: { a: Pt; b: Pt }[]): Ring[] {
  type Link = { to: Pt; used: boolean };
  const key = (p: Pt) => `${p.x},${p.y}`;
  const adj = new Map<string, Link[]>();
  const add = (a: Pt, b: Pt) => {
    const k = key(a);
    const list = adj.get(k) ?? [];
    list.push({ to: b, used: false });
    adj.set(k, list);
  };
  for (const e of fragments) add(e.a, e.b);
  const rings: Ring[] = [];
  for (const [sk, list] of adj) {
    for (const startLink of list) {
      if (startLink.used) continue;
      const parts = sk.split(",");
      const start = { x: Number(parts[0]), y: Number(parts[1]) };
      const ring: Ring = [start];
      let cur = start;
      let next = startLink.to;
      startLink.used = true;
      for (let guard = 0; guard < 100_000; guard++) {
        ring.push(next);
        if (samePt(next, start) && ring.length > 2) break;
        const options = (adj.get(key(next)) ?? []).filter((l) => !l.used);
        if (!options.length) break;
        let best = options[0]!;
        if (options.length > 1) {
          const inVec = { x: next.x - cur.x, y: next.y - cur.y };
          let bestAng = Infinity;
          for (const opt of options) {
            const outVec = { x: opt.to.x - next.x, y: opt.to.y - next.y };
            const ang = Math.atan2(cross(inVec.x, inVec.y, outVec.x, outVec.y), dot(inVec.x, inVec.y, outVec.x, outVec.y));
            if (ang < bestAng) {
              bestAng = ang;
              best = opt;
            }
          }
        }
        best.used = true;
        cur = next;
        next = best.to;
      }
      if (ring.length > 1 && samePt(ring[0]!, ring[ring.length - 1]!)) ring.pop();
      const cleaned = cleanRing(ring);
      if (cleaned.length >= 3) rings.push(cleaned);
    }
  }
  return rings;
}

function nestRings(rings: Ring[]): Multi {
  const cleaned = rings.map(cleanRing).filter((r) => r.length >= 3);
  if (!cleaned.length) return [];
  const items = cleaned.map((r) => ({ r, a: Math.abs(area(r)) }));
  items.sort((a, b) => b.a - a.a);
  const parent = items.map(() => -1);
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!.r[0]!;
    for (let j = i - 1; j >= 0; j--) {
      if (pointInRing(p, items[j]!.r)) {
        parent[i] = j;
        break;
      }
    }
  }
  const multi: Multi = [];
  const holesOf = new Map<number, Ring[]>();
  for (let i = 0; i < items.length; i++) {
    const depth = (() => {
      let d = 0;
      for (let p = parent[i]!; p >= 0; p = parent[p]!) d++;
      return d;
    })();
    if (depth % 2 === 0) {
      multi.push({ outer: ensureCCW(items[i]!.r), holes: [] });
      holesOf.set(i, multi[multi.length - 1]!.holes);
    } else {
      const holes = holesOf.get(parent[i]!)!;
      holes.push(ensureCW(items[i]!.r));
    }
  }
  return multi;
}

export function booleanMulti(a: Multi, b: Multi, op: BooleanOp): Multi {
  if (!a.length && !b.length) return [];
  if (!a.length) return op === "union" || op === "exclude" ? b.map(clonePoly) : [];
  if (!b.length) return op === "intersect" ? [] : a.map(clonePoly);
  const edges = splitEdges([...polyEdges(a, 0), ...polyEdges(b, 1)]);
  const kept: { a: Pt; b: Pt }[] = [];
  for (const e of edges) {
    const m = mid(e.a, e.b);
    const inA = pointInMulti(m, a);
    const inB = pointInMulti(m, b);
    const sel = selectFragment(inA, inB, e.src, op);
    if (!sel) continue;
    kept.push(sel === "rev" ? { a: e.b, b: e.a } : { a: e.a, b: e.b });
  }
  return nestRings(linkRings(kept));
}

function clonePoly(p: Poly): Poly {
  return { outer: p.outer.map((q) => ({ ...q })), holes: p.holes.map((h) => h.map((q) => ({ ...q }))) };
}

function multiBounds(multi: Multi): { x: number; y: number; width: number; height: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of multi) {
    for (const r of [p.outer, ...p.holes]) {
      for (const q of r) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: round4(minX), y: round4(minY), width: Math.max(1, round4(maxX - minX)), height: Math.max(1, round4(maxY - minY)) };
}

function ringToSegs(ring: Ring, closed: boolean): Segment[] {
  if (!ring.length) return [];
  const segs: Segment[] = [{ cmd: "M", to: { ...ring[0]! } }];
  for (let i = 1; i < ring.length; i++) segs.push({ cmd: "L", to: { ...ring[i]! } });
  if (closed) segs.push({ cmd: "Z" });
  return segs;
}

function multiToPath(multi: Multi): { d: string; x: number; y: number; width: number; height: number } {
  const b = multiBounds(multi);
  const segs: Segment[] = [];
  for (const p of multi) {
    segs.push(...ringToSegs(p.outer, true));
    for (const h of p.holes) segs.push(...ringToSegs(h, true));
  }
  const local = translatePath(segs, -b.x, -b.y);
  return { d: serializePath(local), x: b.x, y: b.y, width: b.width, height: b.height };
}

function siblingsOf(doc: Document, parentId: string | null): string[] {
  if (parentId === null) return doc.rootIds;
  const p = doc.nodes[parentId];
  return isContainer(p) ? p.children : [];
}

function styleFrom(n: Extract<NodeT, { type: "rect" | "ellipse" | "path" | "shape" }>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (n.fill !== undefined) props.fill = n.fill;
  if (n.gradient !== undefined) props.gradient = n.gradient;
  if (n.stroke !== undefined) props.stroke = n.stroke;
  if (n.opacity !== 1) props.opacity = n.opacity;
  if (n.shadow !== undefined) props.shadow = n.shadow;
  if (n.outline !== undefined) props.outline = n.outline;
  if (n.filter !== undefined) props.filter = n.filter;
  if (n.backdropFilter !== undefined) props.backdropFilter = n.backdropFilter;
  if (n.name) props.name = n.name;
  if (n.type === "path") {
    props.fillRule = n.fillRule;
    props.strokeCap = n.strokeCap;
    props.strokeJoin = n.strokeJoin;
  } else {
    props.fillRule = "nonzero";
  }
  return props;
}

export interface CombinePathsPlan {
  ops: Op[];
  id: string;
}

export type RingList = Pt[][];

/** Anéis (cada um um contorno fechado) → MultiPoly; opera e devolve anéis do resultado. */
export function booleanRings(a: RingList, b: RingList, operation: BooleanOp): RingList {
  const toMulti = (rings: RingList): Multi =>
    ringsToMulti(
      rings.map((r) => cleanRing(r)).filter((r) => r.length >= 3),
      "nonzero",
    );
  const out = booleanMulti(toMulti(a), toMulti(b), operation);
  const rings: RingList = [];
  for (const p of out) {
    rings.push(p.outer);
    for (const h of p.holes) rings.push(h);
  }
  return rings;
}

/** Atalho de teste: dois `d` SVG → `d` do resultado booleano (origem em 0,0). */
export function booleanPathD(da: string, db: string, operation: BooleanOp): string {
  const ringsA = flattenSegments(parsePath(da));
  const ringsB = flattenSegments(parsePath(db));
  const multi = booleanMulti(ringsToMulti(ringsA, "nonzero"), ringsToMulti(ringsB, "nonzero"), operation);
  if (!multi.length) return "";
  const segs: Segment[] = [];
  for (const p of multi) {
    segs.push(...ringToSegs(p.outer, true));
    for (const h of p.holes) segs.push(...ringToSegs(h, true));
  }
  return serializePath(segs);
}

export type CombineStyleChoice = "first" | "last" | "bottom" | "top";

/** Estilo explícito do resultado: `from` escolhe o nó-base (padrão: o mais ao fundo); o resto sobrescreve. */
export interface CombineStyleSpec {
  from?: string;
  fill?: unknown;
  gradient?: unknown;
  stroke?: unknown;
  opacity?: number;
  shadow?: unknown;
  outline?: unknown;
  filter?: unknown;
  backdropFilter?: unknown;
}

export interface CombineStep {
  op: BooleanOp;
  ids: readonly string[];
  as?: string;
}

export interface CombineSpec {
  ids?: readonly string[];
  operation?: BooleanOp;
  operations?: readonly CombineStep[];
  style?: CombineStyleChoice | CombineStyleSpec;
  id?: string;
  name?: string;
}

const STYLE_CHOICES = ["first", "last", "bottom", "top"];
const STYLE_OVERRIDES = ["fill", "gradient", "stroke", "opacity", "shadow", "outline", "filter", "backdropFilter"] as const;

type Combinable = Extract<NodeT, { type: "rect" | "ellipse" | "path" | "shape" }>;

/**
 * Combina nós `rect`/`ellipse`/`path`/`shape` irmãos e gera um único `path` novo. Forma simples:
 * `ids` + `operation`. Forma em lote: `operations` (passos em ordem; `as` nomeia o resultado
 * intermediário para os passos seguintes; o resultado final é o do último passo). O estilo vem do
 * nó mais ao fundo, ou do que `style` indicar. As fontes são removidas; um desfazer restaura.
 */
export function combinePathsOps(doc: Document, spec: CombineSpec): CombinePathsPlan {
  const batch = spec.operations !== undefined;
  if (batch && (spec.ids !== undefined || spec.operation !== undefined))
    throw new Error("combine_paths takes either ids + operation or operations, not both");
  if (!batch && (spec.ids === undefined || spec.operation === undefined))
    throw new Error("combine_paths needs ids + operation, or operations");
  const steps: readonly CombineStep[] = batch ? spec.operations! : [{ op: spec.operation!, ids: spec.ids! }];
  if (!steps.length) throw new Error("combine_paths: operations is empty");

  const named = new Map<string, Multi>();
  const reals: string[] = []; // nós reais, na ordem em que aparecem
  let parentId: string | null | undefined;
  let anchor = "";
  let result: Multi = [];
  steps.forEach((step, si) => {
    const where = batch ? `operations[${si}] (${step.op}): ` : "";
    const fail = (msg: string): never => {
      throw new Error(where + msg);
    };
    if (step.ids.length < 2) fail("combine_paths needs at least two ids");
    if (!(BOOLEAN_OPS as readonly string[]).includes(step.op))
      fail(`unknown boolean operation "${step.op}"; use union, subtract, intersect or exclude`);
    const unique = [...new Set(step.ids)];
    if (unique.length < 2) fail("combine_paths needs at least two distinct ids");
    const missing = unique.filter((id) => !named.has(id) && !doc.nodes[id]);
    if (missing.length) fail(`nodes do not exist: ${missing.join(", ")}`);
    const real = unique.filter((id) => !named.has(id));
    for (const id of real) {
      const n = doc.nodes[id]!;
      if (!COMBINE_TYPES.has(n.type))
        fail(`"${n.id}" is ${n.type}; combine_paths only accepts path, rect, ellipse or shape`);
    }
    for (const id of real) {
      const n = doc.nodes[id]!;
      if (parentId === undefined) {
        parentId = n.parentId;
        anchor = id;
      } else if (n.parentId !== parentId)
        fail(
          `only nodes with the same parent can be combined ("${n.id}" is in ${n.parentId ?? "canvas"}, "${anchor}" in ${parentId ?? "canvas"})`,
        );
    }
    for (const id of real) if (!reals.includes(id)) reals.push(id);
    let ordered = unique;
    if (step.op !== "subtract" && real.length === unique.length) {
      const sib = siblingsOf(doc, parentId!);
      ordered = [...unique].sort((a, b) => sib.indexOf(a) - sib.indexOf(b));
    }
    const geom = (id: string): Multi => named.get(id) ?? nodeGeometry(doc, doc.nodes[id]!);
    let acc = geom(ordered[0]!);
    for (let i = 1; i < ordered.length; i++) acc = booleanMulti(acc, geom(ordered[i]!), step.op);
    if (!acc.length) fail(`boolean ${step.op} produced an empty path`);
    if (step.as !== undefined) {
      if (doc.nodes[step.as]) fail(`"as" name "${step.as}" is already a node id; pick another name`);
      if (named.has(step.as)) fail(`"as" name "${step.as}" was already used by an earlier step`);
      named.set(step.as, acc);
    }
    result = acc;
  });

  const siblings = siblingsOf(doc, parentId!);
  const byZ = [...reals].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const choice = spec.style;
  const overrides: CombineStyleSpec = typeof choice === "object" && choice !== null ? choice : {};
  let baseId = byZ[0]!;
  if (typeof choice === "string") {
    if (!STYLE_CHOICES.includes(choice)) throw new Error(`style "${choice}" is unknown; use first, last, bottom, top or {from, fill, ...}`);
    baseId = choice === "first" ? reals[0]! : choice === "last" ? reals[reals.length - 1]! : choice === "top" ? byZ[byZ.length - 1]! : byZ[0]!;
  } else if (overrides.from !== undefined) {
    const f = doc.nodes[overrides.from];
    if (!f) throw new Error(`style.from "${overrides.from}" does not exist`);
    if (!COMBINE_TYPES.has(f.type))
      throw new Error(`style.from "${f.id}" is ${f.type}; use a path, rect, ellipse or shape`);
    baseId = f.id;
  }
  const base = doc.nodes[baseId]! as Combinable;
  const path = multiToPath(result);
  const id = spec.id ?? newId();
  if (doc.nodes[id]) throw new Error(`id "${id}" already exists`);
  const index = siblings.indexOf(byZ[0]!);
  const style = styleFrom(base);
  for (const k of STYLE_OVERRIDES) if (overrides[k] !== undefined) style[k] = overrides[k];
  if (overrides.fill !== undefined && overrides.gradient === undefined) delete style.gradient;
  if (spec.name !== undefined) style.name = spec.name;
  if (result.some((p) => p.holes.length > 0)) {
    style.fillRule = base.type === "path" ? (base as PathNode).fillRule : "evenodd";
  }
  const node = {
    type: "path" as const,
    id,
    x: path.x,
    y: path.y,
    width: path.width,
    height: path.height,
    d: path.d,
    ...style,
  };
  const ops: Op[] = [{ op: "create", parentId: parentId!, index, node }];
  for (const sid of byZ) ops.push({ op: "delete", id: sid });
  return { ops, id };
}
