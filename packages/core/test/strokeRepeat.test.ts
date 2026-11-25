import { describe, expect, it } from "vitest";
import {
  History,
  applyOps,
  createDocument,
  outlineStrokeOps,
  outlineStrokeRings,
  parsePath,
  repeatOps,
  type Document,
  type Segment,
  type StrokeOutlineParams,
} from "../src/index.js";

type Pt = { x: number; y: number };

/** Nonzero winding of a point against closed rings. */
function winding(p: Pt, rings: Pt[][]): number {
  let w = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) w++;
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) w--;
    }
  }
  return w;
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inConvex(p: Pt, poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

/** Intersection over union of the outline against a reference predicate, sampled every 0.5 px. */
function iou(rings: Pt[][], ref: (p: Pt) => boolean): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let both = 0;
  let either = 0;
  for (let y = minY - 3.13; y <= maxY + 3; y += 0.5) {
    for (let x = minX - 3.21; x <= maxX + 3; x += 0.5) {
      const a = winding({ x, y }, rings) !== 0;
      const b = ref({ x, y });
      if (a && b) both++;
      if (a || b) either++;
    }
  }
  return both / either;
}

const segsOf = (d: string): Segment[] => parsePath(d);
const stroke = (d: string, p: StrokeOutlineParams) => outlineStrokeRings(segsOf(d), p);

/** Dense sample of a path's centerline (small steps, so the distance to it is exact enough). */
function sampleCurve(d: string): Pt[] {
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (const s of segsOf(d)) {
    if (s.cmd === "M") {
      cur = s.to;
      out.push(cur);
    } else if (s.cmd === "C") {
      for (let i = 1; i <= 800; i++) {
        const t = i / 800;
        const u = 1 - t;
        out.push({
          x: u ** 3 * cur.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t ** 3 * s.to.x,
          y: u ** 3 * cur.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t ** 3 * s.to.y,
        });
      }
      cur = s.to;
    } else if (s.cmd === "L") {
      out.push(s.to);
      cur = s.to;
    }
  }
  return out;
}

describe("outline_stroke geometry", () => {
  it("straight line with round caps matches the stadium (IoU >= 0.98)", () => {
    const rings = stroke("M20 50 L120 50", { width: 12, cap: "round", join: "round" });
    expect(iou(rings, (p) => distSeg(p, { x: 20, y: 50 }, { x: 120, y: 50 }) <= 6)).toBeGreaterThanOrEqual(0.98);
  });

  it("butt and square caps end where the renderer ends them", () => {
    const butt = stroke("M0 0 L100 0", { width: 10, cap: "butt", join: "miter" });
    expect(winding({ x: -1, y: 0 }, butt)).toBe(0);
    expect(winding({ x: 50, y: 4 }, butt)).not.toBe(0);
    const square = stroke("M0 0 L100 0", { width: 10, cap: "square", join: "miter" });
    expect(winding({ x: -4, y: 4 }, square)).not.toBe(0);
    expect(winding({ x: -6, y: 0 }, square)).toBe(0);
  });

  it("a cubic arc matches the distance field of the curve (IoU >= 0.98)", () => {
    const d = "M10 100 C 40 -20, 120 -20, 150 100";
    const rings = stroke(d, { width: 10, cap: "round", join: "round" });
    const line = sampleCurve(d);
    const near = (p: Pt) => {
      let best = Infinity;
      for (let i = 1; i < line.length; i++) best = Math.min(best, distSeg(p, line[i - 1]!, line[i]!));
      return best <= 5;
    };
    expect(iou(rings, near)).toBeGreaterThanOrEqual(0.98);
  });

  it("a closed circle is a ring with a hole (IoU >= 0.98)", () => {
    const rings = stroke("M150 100 A50 50 0 1 1 150 101 Z", { width: 10, cap: "butt", join: "miter" });
    const circle = stroke("M100 50 A50 50 0 1 1 100 150 A50 50 0 1 1 100 50 Z", { width: 10, cap: "butt", join: "round" });
    const ref = (p: Pt) => Math.abs(Math.hypot(p.x - 100, p.y - 100) - 50) <= 5;
    expect(iou(circle, ref)).toBeGreaterThanOrEqual(0.98);
    expect(circle).toHaveLength(2);
    expect(winding({ x: 100, y: 100 }, circle)).toBe(0);
    expect(rings.length).toBeGreaterThan(0);
  });

  it("a zigzag with miter joins matches independently built join kites (IoU >= 0.98)", () => {
    const pts: Pt[] = [{ x: 0, y: 40 }, { x: 40, y: 0 }, { x: 80, y: 40 }, { x: 120, y: 0 }, { x: 160, y: 40 }];
    const hw = 5;
    const rings = stroke("M0 40 L40 0 L80 40 L120 0 L160 40", { width: 10, cap: "butt", join: "miter" });
    const pieces: Pt[][] = [];
    const norm = (a: Pt, b: Pt) => {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const n = norm(a, b);
      pieces.push([
        { x: a.x + n.x * hw, y: a.y + n.y * hw },
        { x: b.x + n.x * hw, y: b.y + n.y * hw },
        { x: b.x - n.x * hw, y: b.y - n.y * hw },
        { x: a.x - n.x * hw, y: a.y - n.y * hw },
      ]);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const n0 = norm(pts[i - 1]!, p);
      const n1 = norm(p, pts[i + 1]!);
      for (const s of [1, -1]) {
        const k = (s * hw) / (1 + n0.x * n1.x + n0.y * n1.y);
        pieces.push([
          p,
          { x: p.x + s * n0.x * hw, y: p.y + s * n0.y * hw },
          { x: p.x + (n0.x + n1.x) * k, y: p.y + (n0.y + n1.y) * k },
          { x: p.x + s * n1.x * hw, y: p.y + s * n1.y * hw },
        ]);
      }
    }
    expect(iou(rings, (p) => pieces.some((q) => inConvex(p, q)))).toBeGreaterThanOrEqual(0.98);
    // The 90 degree tips are real miters: 5 * sqrt(2) past the vertex.
    expect(winding({ x: 40, y: 0 - 6.5 }, rings)).not.toBe(0);
  });

  it("falls back to a bevel past the miter limit", () => {
    // A 10 degree spike: ratio ~ 11 > 4, so no long tip.
    const rings = stroke("M0 0 L100 0 L0 17.6", { width: 10, cap: "butt", join: "miter" });
    const maxX = Math.max(...rings.flat().map((p) => p.x));
    expect(maxX).toBeLessThan(110);
  });

  it("a width bigger than the circle fills it", () => {
    const rings = stroke("M100 95 A5 5 0 1 1 100 105 A5 5 0 1 1 100 95 Z", { width: 20, cap: "butt", join: "round" });
    expect(winding({ x: 100, y: 100 }, rings)).not.toBe(0);
  });

  it("a zero-length subpath paints a dot with round caps only", () => {
    expect(stroke("M10 10 L10 10", { width: 8, cap: "butt", join: "round" })).toEqual([]);
    const dot = stroke("M10 10 L10 10", { width: 8, cap: "round", join: "round" });
    expect(winding({ x: 10, y: 13 }, dot)).not.toBe(0);
  });
});

function pathDoc(extra: Record<string, unknown> = {}): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: { type: "path", id: "p", x: 100, y: 50, width: 100, height: 0, d: "M0 0 L100 0", stroke: { color: "#112233", width: 10 }, strokeCap: "butt", ...extra },
    } as never,
  ]).doc;
}

describe("outlineStrokeOps", () => {
  it("swaps the stroke for a fill of the same color in one undo step", () => {
    const h = new History(pathDoc());
    const plan = outlineStrokeOps(h.doc, "p");
    h.apply(plan.ops, { label: "outline" });
    const n = h.doc.nodes.p as unknown as Record<string, unknown>;
    expect(n).toMatchObject({ type: "path", fill: "#112233", fillRule: "nonzero", x: 100, y: 45, width: 100, height: 10 });
    expect(n.stroke).toBeUndefined();
    expect(n.d).toBe("M0 10 L100 10 L100 0 L0 0 Z");
    expect(plan.bounds).toEqual({ x: 100, y: 45, width: 100, height: 10 });
    h.undo();
    expect((h.doc.nodes.p as unknown as Record<string, unknown>).stroke).toEqual({ color: "#112233", width: 10 });
    expect((h.doc.nodes.p as unknown as Record<string, unknown>).fill).toBeUndefined();
  });

  it("keepStroke leaves the stroke on the node", () => {
    const doc = pathDoc();
    const { doc: out } = applyOps(doc, outlineStrokeOps(doc, "p", { keepStroke: true }).ops);
    expect((out.nodes.p as unknown as Record<string, unknown>).stroke).toEqual({ color: "#112233", width: 10 });
  });

  it("bakes a rotation into the points", () => {
    const doc = pathDoc({ rotation: 90 });
    const plan = outlineStrokeOps(doc, "p");
    // The 100 x 10 bar rotated a quarter turn about its box center (150, 50) is 10 wide, 100 tall.
    expect(plan.bounds.width).toBeCloseTo(10, 3);
    expect(plan.bounds.height).toBeCloseTo(100, 3);
    expect(plan.bounds.x).toBeCloseTo(145, 3);
    expect(plan.bounds.y).toBeCloseTo(0, 3);
    const { doc: out } = applyOps(doc, plan.ops);
    expect((out.nodes.p as unknown as Record<string, unknown>).rotation).toBe(0);
  });

  it("scales the stroke width with a viewBox", () => {
    const doc = pathDoc({ viewBox: [0, 0, 50, 10], width: 100, height: 20, d: "M0 5 L50 5" });
    const plan = outlineStrokeOps(doc, "p");
    expect(plan.bounds.height).toBeCloseTo(20, 3); // width 10 in viewBox units, scale 2
  });

  it("refuses what it cannot turn into one paint", () => {
    expect(() => outlineStrokeOps(pathDoc({ fill: "#ff0000" }), "p")).toThrow(/fill besides the stroke/);
    expect(() => outlineStrokeOps(pathDoc({ stroke: { color: "#000000", width: 4, style: "dashed" } }), "p")).toThrow(/solid/);
    expect(() => outlineStrokeOps(pathDoc({ stroke: undefined }), "p")).toThrow(/no stroke/);
    expect(() => outlineStrokeOps(pathDoc(), "zz")).toThrow(/does not exist/);
    const rect = applyOps(createDocument("T", "d"), [{ op: "create", node: { type: "rect", id: "r", width: 10, height: 10, stroke: { color: "#000000", width: 2 } } } as never]).doc;
    expect(() => outlineStrokeOps(rect, "r")).toThrow(/convert_to_path/);
  });
});

function ringDoc(): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "f",
        width: 400,
        height: 400,
        children: [{ type: "rect", id: "a", x: 190, y: 40, width: 20, height: 20, fill: "#ff0000" }],
      },
    } as never,
  ]).doc;
}

describe("repeatOps", () => {
  it("radial: four copies orbit the parent's center, rotate follows the orbit", () => {
    const doc = ringDoc();
    const plan = repeatOps(doc, "a", { count: 4, mode: "radial", rotate: true });
    expect(plan.copies).toHaveLength(3);
    const { doc: out } = applyOps(doc, plan.ops);
    const at = (i: number) => out.nodes[plan.copies[i]!] as unknown as { x: number; y: number; rotation: number; parentId: string };
    expect(at(0)).toMatchObject({ x: 340, y: 190, rotation: 90, parentId: "f" });
    expect(at(1)).toMatchObject({ x: 190, y: 340, rotation: 180 });
    expect(at(2)).toMatchObject({ x: 40, y: 190, rotation: 270 });
  });

  it("radial: partial sweep includes both ends and copies keep their rotation by default", () => {
    const doc = ringDoc();
    const plan = repeatOps(doc, "a", { count: 3, mode: "radial", center: { x: 200, y: 200 }, angle: 180 });
    const { doc: out } = applyOps(doc, plan.ops);
    expect(out.nodes[plan.copies[1]!]).toMatchObject({ x: 190, y: 340, rotation: 0 });
  });

  it("linear and grid", () => {
    const doc = ringDoc();
    const lin = repeatOps(doc, "a", { count: 3, mode: "linear", step: { x: 30, y: 5 } });
    const { doc: a } = applyOps(doc, lin.ops);
    expect(a.nodes[lin.copies[1]!]).toMatchObject({ x: 250, y: 50 });
    const grid = repeatOps(doc, "a", { count: 5, mode: "grid", columns: 2, gap: 10 });
    const { doc: b } = applyOps(doc, grid.ops);
    expect(grid.copies.map((c) => [(b.nodes[c] as unknown as { x: number }).x, (b.nodes[c] as unknown as { y: number }).y])).toEqual([[220, 40], [190, 70], [220, 70], [190, 100]]);
  });

  it("is one undo step and copies subtrees", () => {
    const h = new History(ringDoc());
    h.apply(repeatOps(h.doc, "f", { count: 3, mode: "linear", step: { x: 500, y: 0 } }).ops, { label: "repeat" });
    expect(h.doc.rootIds).toHaveLength(3);
    h.undo();
    expect(h.doc.rootIds).toHaveLength(1);
  });

  it("explains bad input", () => {
    const doc = ringDoc();
    expect(() => repeatOps(doc, "a", { count: 1, mode: "radial" })).toThrow(/count/);
    expect(() => repeatOps(doc, "a", { count: 3, mode: "linear" })).toThrow(/step/);
    expect(() => repeatOps(doc, "a", { count: 3, mode: "linear", step: { x: 0, y: 0 } })).toThrow(/land on the source/);
    expect(() => repeatOps(doc, "a", { count: 3, mode: "grid" })).toThrow(/columns/);
    expect(() => repeatOps(doc, "a", { count: 5, mode: "grid", columns: 2, rows: 2 })).toThrow(/hold 4/);
    expect(() => repeatOps(doc, "a", { count: 3, mode: "linear", step: { x: 1 }, angle: 90 })).toThrow(/only work with mode "radial"/);
    expect(() => repeatOps(doc, "zz", { count: 3, mode: "radial" })).toThrow(/does not exist/);
    expect(() => repeatOps(doc, "f", { count: 3, mode: "radial" })).toThrow(/sized frame/);
    expect(() => repeatOps(doc, "a", { count: 3, mode: "radial", center: { x: 200, y: 50 } })).toThrow(/centered on the orbit center/);
  });
});
