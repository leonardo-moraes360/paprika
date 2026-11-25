import { describe, expect, it } from "vitest";
import { applyOps, createDocument, layout, lintDocument } from "../src/index.js";

const near = (a: number, b: number, eps = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const chips = (prefix: string, n: number, w: number, h: number) =>
  Array.from({ length: n }, (_, i) => ({ type: "rect" as const, id: `${prefix}${i}`, width: w, height: h, fill: "#c43d27" }));
const make = (node: object) => applyOps(createDocument("t", "d"), [{ op: "create", node } as never]).doc;

describe("layout: wrap", () => {
  it("breaks a fixed-width row into lines and hugs the sum of the lines", () => {
    const doc = make({ type: "frame", id: "f", width: 300, height: "hug", layout: { mode: "row", gap: 12, padding: 10, wrap: true }, children: chips("c", 7, 88, 40) });
    const b = layout(doc);
    expect(b.f).toMatchObject({ width: 300, height: 10 + 4 * 40 + 3 * 12 + 10 });
    expect(b.c0).toMatchObject({ x: 10, y: 10 });
    expect(b.c1).toMatchObject({ x: 110, y: 10 });
    expect(b.c2).toMatchObject({ x: 10, y: 62 });
    expect(b.c6).toMatchObject({ x: 10, y: 166 });
  });

  it("keeps one row when the children fit, and ignores the flow without wrap", () => {
    const fits = layout(make({ type: "frame", id: "f", width: 400, height: "hug", layout: { mode: "row", gap: 12, wrap: true }, children: chips("c", 4, 88, 40) }));
    expect(fits.f).toMatchObject({ width: 400, height: 40 });
    const off = layout(make({ type: "frame", id: "f", width: 300, height: "hug", layout: { mode: "row", gap: 12 }, children: chips("c", 7, 88, 40) }));
    expect(off.f).toMatchObject({ width: 300, height: 40 });
    expect(off.c6!.y).toBe(0);
  });

  it("shares the free cross space between lines (align-content: stretch) and aligns within each line", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 200,
      height: 200,
      layout: { mode: "row", gap: 10, wrap: true, align: "center", justify: "between" },
      children: [
        { type: "rect", id: "a", width: 90, height: 20 },
        { type: "rect", id: "b", width: 90, height: 40 },
        { type: "rect", id: "c", width: 90, height: 30 },
        { type: "rect", id: "d", width: 90, height: 30 },
        { type: "rect", id: "e", width: 90, height: 30 },
      ],
    });
    const b = layout(doc);
    const l1 = 40 + 80 / 3;
    const l2 = 30 + 80 / 3;
    near(b.a!.y, (l1 - 20) / 2);
    near(b.b!.y, (l1 - 40) / 2);
    near(b.c!.y, l1 + 10 + (l2 - 30) / 2);
    near(b.e!.y, l1 + 10 + l2 + 10 + (l2 - 30) / 2);
    expect(b.a!.x).toBe(0);
    expect(b.b!.x).toBe(110);
    expect(b.e!.x).toBe(0);
  });

  it("wraps a column when its fixed height is exceeded and hugs the width of the columns", () => {
    const b = layout(make({ type: "frame", id: "f", width: "hug", height: 120, layout: { mode: "column", gap: 8, wrap: true }, children: chips("c", 5, 50, 40) }));
    expect(b.f).toMatchObject({ width: 50 * 3 + 8 * 2, height: 120 });
    expect(b.c1).toMatchObject({ x: 0, y: 48 });
    expect(b.c2).toMatchObject({ x: 58, y: 0 });
    expect(b.c4).toMatchObject({ x: 116, y: 0 });
  });

  it("gives a fill-width wrapping row the width of its column parent, and the parent the height of the lines", () => {
    const doc = make({
      type: "frame",
      id: "page",
      width: 360,
      height: "hug",
      layout: { mode: "column", gap: 16, padding: 8 },
      children: [
        { type: "frame", id: "grid", width: "fill", height: "hug", layout: { mode: "row", gap: 12, wrap: true }, children: chips("g", 5, 100, 30) },
        { type: "rect", id: "tail", width: "fill", height: 10 },
      ],
    });
    const b = layout(doc);
    expect(b.grid).toMatchObject({ x: 8, y: 8, width: 344, height: 72 });
    expect(b.g3).toMatchObject({ x: 8, y: 50 });
    expect(b.tail!.y).toBe(8 + 72 + 16);
    expect(b.page!.height).toBe(8 + 72 + 16 + 10 + 8);
  });

  it("reflows a fill-width wrapping row inside a row parent", () => {
    const doc = make({
      type: "frame",
      id: "side",
      width: 500,
      height: "hug",
      layout: { mode: "row", gap: 10 },
      children: [
        { type: "frame", id: "g", width: "fill", height: "hug", layout: { mode: "row", gap: 6, wrap: true }, children: chips("q", 6, 90, 20) },
        { type: "rect", id: "r", width: 100, height: 10 },
      ],
    });
    const b = layout(doc);
    expect(b.g).toMatchObject({ width: 390, height: 46 });
    expect(b.side!.height).toBe(46);
  });

  it("splits the free width per line among fill items (fill counts as 0 when breaking lines)", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 300,
      height: "hug",
      layout: { mode: "row", gap: 10, wrap: true },
      children: [
        { type: "rect", id: "a", width: 200, height: 20 },
        { type: "rect", id: "f1", width: "fill", height: 20 },
        { type: "rect", id: "f2", width: "fill", height: 20 },
      ],
    });
    const b = layout(doc);
    expect(b.f1).toMatchObject({ width: 40, y: 0 });
    expect(b.f2).toMatchObject({ x: 200 + 10 + 40 + 10, width: 40 });
  });

  it("lint: a wrapping row does not report layout-overflow", () => {
    const doc = make({ type: "frame", id: "f", width: 300, height: "hug", layout: { mode: "row", gap: 12, wrap: true }, children: chips("c", 11, 88, 40) });
    expect(lintDocument(doc).filter((i) => i.rule === "layout-overflow")).toEqual([]);
  });
});

describe("layout: pages and ids", () => {
  it("lays out the page of every requested id, not only the first page", () => {
    let { doc } = applyOps(createDocument("t", "d"), [
      { op: "create", node: { type: "frame", id: "one", x: 5, y: 6, width: 10, height: 10 } },
      { op: "add_page", id: "p2", name: "Two" },
    ]);
    doc = applyOps(doc, [
      {
        op: "create",
        parentId: "p2",
        node: { type: "frame", id: "two", x: 100, y: 200, width: 30, height: 40, layout: { mode: "row", padding: 4 }, children: [{ type: "rect", id: "kid", width: 10, height: 10 }] },
      },
    ]).doc;
    const first = layout(doc);
    expect(first.one).toBeDefined();
    expect(first.two).toBeUndefined();
    const both = layout(doc, { ids: ["one", "kid", "two"] });
    expect(both.one).toMatchObject({ x: 5, y: 6 });
    expect(both.two).toMatchObject({ x: 100, y: 200, width: 30, height: 40 });
    expect(both.kid).toMatchObject({ x: 104, y: 204 });
    expect(Object.keys(layout(doc, { ids: ["kid"] }))).toEqual(["kid"]);
  });
});
