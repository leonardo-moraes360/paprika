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
    expect(() => combinePathsOps(doc, { ids: ["a"], operation: "union" })).toThrow(/at least two/);
    expect(() => combinePathsOps(doc, { ids: ["a", "zz"], operation: "union" })).toThrow(/do not exist/);
    expect(() => applyOps(doc, [{ op: "combine_paths", ids: ["a", "f"], operation: "union" }])).toThrow(/path, rect, ellipse or shape/);
  });

  it("rejects bad batch forms", () => {
    const doc = scene();
    expect(() => combinePathsOps(doc, {})).toThrow(/ids \+ operation, or operations/);
    expect(() => combinePathsOps(doc, { ids: ["a", "b"], operation: "union", operations: [{ op: "union", ids: ["a", "b"] }] })).toThrow(/not both/);
    expect(() => combinePathsOps(doc, { operations: [{ op: "union", ids: ["a", "b"], as: "x" }, { op: "subtract", ids: ["x", "nope"] }] })).toThrow(
      /operations\[1\] \(subtract\): nodes do not exist: nope/,
    );
    expect(() => combinePathsOps(doc, { operations: [{ op: "union", ids: ["a", "b"], as: "a" }, { op: "union", ids: ["a", "b"] }] })).toThrow(
      /operations\[0\] \(union\): "as" name "a" is already a node id/,
    );
    expect(() => combinePathsOps(doc, { operations: [{ op: "union", ids: ["a", "f"] }] })).toThrow(/operations\[0\] \(union\): "f" is frame/);
    expect(() => combinePathsOps(doc, { operations: [{ op: "intersect", ids: ["a", "b"], as: "x" }, { op: "subtract", ids: ["a", "x"] }, { op: "union", ids: ["b", "x"] }] }).ops.length).not.toThrow();
    expect(() => combinePathsOps(doc, { ids: ["a", "b"], operation: "union", style: { from: "zz" } })).toThrow(/style.from "zz" does not exist/);
  });
});

describe("combine_paths batch", () => {
  const ringScene = () =>
    applyOps(createDocument("T", "doc"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "f",
          width: 400,
          height: 300,
          children: [
            { type: "ellipse", id: "disc", x: 0, y: 0, width: 100, height: 100, fill: "#c43d27" },
            {
              type: "path",
              id: "dome",
              x: 20,
              y: 0,
              width: 60,
              height: 40,
              d: "M0 40 L0 0 L60 0 L60 40 Z",
              fill: "#1e2336",
              gradient: { type: "linear", angle: 90, stops: [{ color: "#fff", offset: 0 }, { color: "#000", offset: 1 }] },
            },
            { type: "ellipse", id: "hole", x: 30, y: 30, width: 40, height: 40, fill: "#000000" },
            { type: "rect", id: "clip", x: -10, y: -10, width: 60, height: 120, fill: "#00ff00", opacity: 0.5 },
          ],
        },
      },
    ]).doc;

  it("ring with a hole in one call, one undo step, bottom style", () => {
    const h = new History(ringScene());
    h.apply(
      [
        {
          op: "combine_paths",
          operations: [
            { op: "union", ids: ["disc", "dome"], as: "body" },
            { op: "subtract", ids: ["body", "hole"] },
          ],
          id: "ring",
          name: "Ring",
        },
      ],
      "agent",
      "ring",
    );
    const ring = h.doc.nodes["ring"]!;
    expect(ring.type).toBe("path");
    if (ring.type !== "path") return;
    expect(ring.name).toBe("Ring");
    expect(ring.fill).toBe("#c43d27");
    expect(ring.fillRule).toBe("evenodd");
    expect(pathInside(ring.d, 50, 50, "evenodd")).toBe(false);
    expect(pathInside(ring.d, 50, 10, "evenodd")).toBe(true);
    for (const id of ["disc", "dome", "hole"]) expect(h.doc.nodes[id]).toBeUndefined();
    expect(h.doc.nodes["clip"]).toBeDefined();
    h.undo();
    for (const id of ["disc", "dome", "hole"]) expect(h.doc.nodes[id]).toBeDefined();
    expect(h.doc.nodes["ring"]).toBeUndefined();
  });

  it("chain with intersect and a clip, intermediate reused", () => {
    const doc = ringScene();
    const plan = combinePathsOps(doc, {
      operations: [
        { op: "subtract", ids: ["disc", "hole"], as: "ring" },
        { op: "intersect", ids: ["ring", "clip"], as: "half" },
        { op: "union", ids: ["half", "dome"] },
      ],
      id: "out",
    });
    const { doc: out } = applyOps(doc, plan.ops);
    expect(out.nodes["out"]?.type).toBe("path");
    for (const id of ["disc", "dome", "hole", "clip"]) expect(out.nodes[id]).toBeUndefined();
  });

  it("an empty step names the failing step", () => {
    const doc = ringScene();
    expect(() =>
      combinePathsOps(doc, {
        operations: [
          { op: "union", ids: ["disc", "dome"], as: "body" },
          { op: "subtract", ids: ["hole", "body"] },
        ],
      }),
    ).toThrow(/operations\[1\] \(subtract\): boolean subtract produced an empty path/);
  });

  it("style choices", () => {
    const doc = ringScene();
    const run = (style: Parameters<typeof combinePathsOps>[1]["style"], ids = ["clip", "disc", "dome"]) => {
      const { doc: out } = applyOps(doc, combinePathsOps(doc, { ids, operation: "union", style, id: "o" }).ops);
      return out.nodes["o"]! as { fill?: string; gradient?: unknown; opacity: number };
    };
    expect(run(undefined).fill).toBe("#c43d27");
    expect(run("bottom").fill).toBe("#c43d27");
    expect(run("top").fill).toBe("#00ff00");
    expect(run("top").opacity).toBe(0.5);
    expect(run("first").fill).toBe("#00ff00");
    expect(run("last").fill).toBe("#1e2336");
    expect(run("last").gradient).toBeDefined();
    expect(run({ from: "dome" }).fill).toBe("#1e2336");
    expect(run({ from: "hole" }, ["disc", "dome"]).fill).toBe("#000000");
    const o = run({ fill: "#abcdef" }, ["disc", "dome"]);
    expect(o.fill).toBe("#abcdef");
    expect(o.gradient).toBeUndefined();
    const g = run({ from: "dome", opacity: 0.25 }, ["disc", "hole"]);
    expect(g.opacity).toBe(0.25);
    expect(g.gradient).toBeDefined();
  });
});
