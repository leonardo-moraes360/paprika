import { describe, expect, it } from "vitest";
import {
  applyOps,
  booleanPathD,
  booleanRings,
  combinePathsOps,
  createDocument,
  History,
  parsePath,
  pathBounds,
} from "../src/index.js";

const near = (a: number, b: number, eps = 0.5) => expect(Math.abs(a - b)).toBeLessThan(eps);

function windingAt(p: { x: number; y: number }, ring: { x: number; y: number }[]): number {
  let w = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const cross = (a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x);
    if (a.y <= p.y) {
      if (b.y > p.y && cross > 0) w++;
    } else if (b.y <= p.y && cross < 0) w--;
  }
  return w;
}

function pathInside(d: string, x: number, y: number, fillRule: "nonzero" | "evenodd" = "nonzero"): boolean {
  const segs = parsePath(d);
  const rings: { x: number; y: number }[][] = [];
  let ring: { x: number; y: number }[] = [];
  let start = { x: 0, y: 0 };
  for (const s of segs) {
    if (s.cmd === "M") {
      if (ring.length >= 3) rings.push(ring);
      ring = [{ x: s.to.x, y: s.to.y }];
      start = s.to;
    } else if (s.cmd === "L") {
      ring.push({ x: s.to.x, y: s.to.y });
    } else if (s.cmd === "Z") {
      if (ring.length >= 3) rings.push(ring);
      ring = [];
    } else if ("to" in s) {
      ring.push({ x: s.to.x, y: s.to.y });
    }
  }
  if (ring.length >= 3) rings.push(ring);
  let wind = 0;
  let crossings = 0;
  for (const r of rings) {
    const w = windingAt({ x, y }, r);
    wind += w;
    crossings += Math.abs(w);
  }
  return fillRule === "evenodd" ? crossings % 2 === 1 : wind !== 0;
}

function scene() {
  return applyOps(createDocument("T", "doc"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "f",
        width: 400,
        height: 300,
        children: [
          { type: "rect", id: "a", x: 10, y: 10, width: 100, height: 100, fill: "#c43d27" },
          { type: "rect", id: "b", x: 60, y: 60, width: 100, height: 100, fill: "#1e2336" },
        ],
      },
    },
  ]).doc;
}

describe("boolean rings", () => {
  const sq = (x: number, y: number, w: number, h: number) => [
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  ];

  it("union of overlapping squares", () => {
    const r = booleanRings(sq(0, 0, 100, 100), sq(50, 50, 100, 100), "union");
    expect(r.length).toBeGreaterThanOrEqual(1);
    const b = pathBounds(parsePath(booleanPathD("M0 0 L100 0 L100 100 L0 100 Z", "M50 50 L150 50 L150 150 L50 150 Z", "union")));
    near(b.width, 150, 2);
    near(b.height, 150, 2);
  });

  it("subtract makes a ring", () => {
    const d = booleanPathD("M0 0 L100 0 L100 100 L0 100 Z", "M25 25 L75 25 L75 75 L25 75 Z", "subtract");
    expect(pathInside(d, 10, 10, "nonzero")).toBe(true);
    expect(pathInside(d, 50, 50, "nonzero")).toBe(false);
    expect(pathInside(d, 10, 10, "evenodd")).toBe(true);
    expect(pathInside(d, 50, 50, "evenodd")).toBe(false);
  });

  it("intersect keeps overlap", () => {
    const d = booleanPathD("M0 0 L100 0 L100 100 L0 100 Z", "M50 50 L150 50 L150 150 L50 150 Z", "intersect");
    expect(pathInside(d, 75, 75)).toBe(true);
    expect(pathInside(d, 10, 10)).toBe(false);
  });

  it("exclude keeps non-overlap", () => {
    const d = booleanPathD("M0 0 L100 0 L100 100 L0 100 Z", "M50 50 L150 50 L150 150 L50 150 Z", "exclude");
    expect(pathInside(d, 10, 10)).toBe(true);
    expect(pathInside(d, 140, 140)).toBe(true);
    expect(pathInside(d, 75, 75)).toBe(false);
  });

  it("disjoint union keeps both", () => {
    const d = booleanPathD("M0 0 L40 0 L40 40 L0 40 Z", "M80 80 L120 80 L120 120 L80 120 Z", "union");
    expect(pathInside(d, 20, 20)).toBe(true);
    expect(pathInside(d, 100, 100)).toBe(true);
    expect(pathInside(d, 50, 50)).toBe(false);
  });
});

describe("combine_paths op", () => {
  it("union overlapping squares keeps bottom style and deletes sources", () => {
    const doc0 = scene();
    const { doc, created } = applyOps(doc0, [{ op: "combine_paths", ids: ["a", "b"], operation: "union", id: "u" }]);
    expect(created).toContain("u");
    expect(doc.nodes["a"]).toBeUndefined();
    expect(doc.nodes["b"]).toBeUndefined();
    const u = doc.nodes["u"]!;
    expect(u).toMatchObject({ type: "path", fill: "#c43d27", parentId: "f" });
    expect(u.type === "path" && u.d.length).toBeGreaterThan(10);
  });

  it("subtract ring with evenodd and nonzero", () => {
    const doc0 = applyOps(createDocument("T", "doc"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "f",
          width: 200,
          height: 200,
          children: [
            { type: "rect", id: "outer", x: 0, y: 0, width: 100, height: 100, fill: "#c43d27" },
            { type: "rect", id: "inner", x: 25, y: 25, width: 50, height: 50, fill: "#000" },
          ],
        },
      },
    ]).doc;
    const { doc } = applyOps(doc0, [{ op: "combine_paths", ids: ["outer", "inner"], operation: "subtract", id: "ring" }]);
    const ring = doc.nodes["ring"]!;
    expect(ring.type).toBe("path");
    if (ring.type !== "path") return;
    expect(pathInside(ring.d, 10, 10, "evenodd")).toBe(true);
    expect(pathInside(ring.d, 50, 50, "evenodd")).toBe(false);
    expect(pathInside(ring.d, 10, 10, "nonzero")).toBe(true);
    expect(pathInside(ring.d, 50, 50, "nonzero")).toBe(false);
  });

  it("rotated input", () => {
    const doc0 = applyOps(createDocument("T", "doc"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "f",
          width: 300,
          height: 300,
          children: [
            { type: "rect", id: "a", x: 40, y: 40, width: 80, height: 80, fill: "#c43d27" },
            { type: "rect", id: "b", x: 70, y: 70, width: 80, height: 80, rotation: 45, fill: "#1e2336" },
          ],
        },
      },
    ]).doc;
    const { doc } = applyOps(doc0, [{ op: "combine_paths", ids: ["a", "b"], operation: "union", id: "u" }]);
    expect(doc.nodes["u"]?.type).toBe("path");
  });

  it("disjoint inputs", () => {
    const doc0 = applyOps(createDocument("T", "doc"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "f",
          width: 400,
          height: 200,
          children: [
            { type: "rect", id: "a", x: 0, y: 0, width: 40, height: 40, fill: "#c43d27" },
            { type: "ellipse", id: "b", x: 200, y: 20, width: 40, height: 40, fill: "#1e2336" },
          ],
        },
      },
    ]).doc;
    const { doc } = applyOps(doc0, [{ op: "combine_paths", ids: ["a", "b"], operation: "union", id: "u" }]);
    const u = doc.nodes["u"]!;
    expect(u.type).toBe("path");
    if (u.type !== "path") return;
    expect(pathInside(u.d, 20, 20)).toBe(true);
    expect(pathInside(u.d, 220, 40)).toBe(true);
  });

  it("one undo step restores sources", () => {
    const h = new History(scene());
    h.apply([{ op: "combine_paths", ids: ["a", "b"], operation: "intersect", id: "i" }], "agent", "combine");
    expect(h.doc.nodes["i"]?.type).toBe("path");
    expect(h.doc.nodes["a"]).toBeUndefined();
    h.undo();
    expect(h.doc.nodes["a"]?.type).toBe("rect");
    expect(h.doc.nodes["b"]?.type).toBe("rect");
    expect(h.doc.nodes["i"]).toBeUndefined();
  });

  it("rejects bad inputs", () => {
    const doc = scene();
    expect(() => combinePathsOps(doc, ["a"], { operation: "union" })).toThrow(/at least two/);
    expect(() => combinePathsOps(doc, ["a", "zz"], { operation: "union" })).toThrow(/do not exist/);
    expect(() => applyOps(doc, [{ op: "combine_paths", ids: ["a", "f"], operation: "union" }])).toThrow(/path, rect, ellipse or shape/);
  });
});
