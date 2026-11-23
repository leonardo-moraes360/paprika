import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDocument,
  cssToString,
  layout,
  measureText,
  nodeStyle,
  normalizePath,
  parsePath,
  pathOrigin,
  serializePath,
} from "../src/index.js";

const near = (a: number, b: number, eps = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("measureText", () => {
  it("is deterministic and grows with font size", () => {
    const a = measureText("Olá", 16);
    const b = measureText("Olá", 32);
    expect(a.width).toBeGreaterThan(0);
    expect(b.width).toBeCloseTo(a.width * 2, 5);
    expect(a.height).toBeCloseTo(16 * 1.4, 5);
    expect(measureText("a\nb", 10).lines).toBe(2);
  });
});

describe("layout: free and rotated", () => {
  it("returns absolute boxes and four rotated corners", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          children: [{ type: "rect", id: "r", x: 30, y: 10, width: 40, height: 20, rotation: 90, fill: "#c43d27" }],
        },
      },
    ]);
    const boxes = layout(doc);
    expect(boxes.board).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
    expect(boxes.r).toMatchObject({ x: 40, y: 30, width: 40, height: 20 });
    expect(boxes.r!.origin).toEqual({ x: 60, y: 40 });
    const [tl, tr, br, bl] = boxes.r!.corners;
    near(tl.x, 50);
    near(tl.y, 60);
    near(tr.x, 50);
    near(tr.y, 20);
    near(br.x, 70);
    near(br.y, 20);
    near(bl.x, 70);
    near(bl.y, 60);
  });
});

describe("layout: nested auto-layout (golden vs CSS flex)", () => {
  it("places fill children inside padded column within ±1 px of flex math", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "outer",
          x: 0,
          y: 0,
          width: 320,
          height: 200,
          layout: { mode: "column", gap: 8, padding: 16 },
          children: [
            {
              type: "frame",
              id: "inner",
              width: "fill",
              height: "hug",
              layout: { mode: "row", gap: 4, padding: 8, align: "center" },
              children: [
                { type: "rect", id: "a", width: 40, height: 20, fill: "#111" },
                { type: "rect", id: "b", width: "fill", height: 20, fill: "#222" },
                { type: "rect", id: "c", width: 24, height: 24, fill: "#333" },
              ],
            },
            { type: "rect", id: "bar", width: "fill", height: 4, fill: "#ff278c" },
          ],
        },
      },
    ]);
    const boxes = layout(doc);
    expect(boxes.outer).toMatchObject({ x: 0, y: 0, width: 320, height: 200 });
    near(boxes.inner!.x, 16);
    near(boxes.inner!.y, 16);
    near(boxes.inner!.width, 288);
    near(boxes.inner!.height, 40);
    near(boxes.a!.x, 16 + 8);
    near(boxes.a!.y, 16 + 8 + (40 - 8 * 2 - 20) / 2);
    near(boxes.a!.width, 40);
    near(boxes.b!.width, 288 - 16 - 40 - 24 - 8);
    near(boxes.c!.width, 24);
    near(boxes.bar!.x, 16);
    near(boxes.bar!.y, 16 + 40 + 8);
    near(boxes.bar!.width, 288);
    near(boxes.bar!.height, 4);
  });
});

describe("layout: absolute child ignores the flow", () => {
  it("skips gap and hug and keeps x/y relative to the parent", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "row",
          x: 10,
          y: 20,
          width: "hug",
          height: "hug",
          layout: { mode: "row", gap: 8, padding: 0, align: "start" },
          children: [
            { type: "rect", id: "a", width: 40, height: 20, fill: "#111" },
            { type: "rect", id: "pin", width: 16, height: 16, x: 100, y: 4, fill: "#c43d27", layoutPositioning: "absolute" },
            { type: "rect", id: "b", width: 30, height: 20, fill: "#222" },
          ],
        },
      },
    ]);
    const boxes = layout(doc);
    expect(boxes.row).toMatchObject({ x: 10, y: 20, width: 78, height: 20 });
    expect(boxes.a).toMatchObject({ x: 10, y: 20, width: 40, height: 20 });
    expect(boxes.b).toMatchObject({ x: 58, y: 20, width: 30, height: 20 });
    expect(boxes.pin).toMatchObject({ x: 110, y: 24, width: 16, height: 16 });
    const pin = cssToString(nodeStyle(doc, doc.nodes.pin!));
    expect(pin).toContain("position:absolute");
    expect(pin).toContain("left:100px");
    expect(pin).toContain("top:4px");
    expect(cssToString(nodeStyle(doc, doc.nodes.a!))).toContain("position:relative");
  });

  it("rejects an unknown positioning value", () => {
    expect(() =>
      applyOps(createDocument("t", "d"), [{ op: "create", node: { type: "rect", id: "r", layoutPositioning: "pinned" } }]),
    ).toThrow(/layoutPositioning/);
  });
});

describe("path origin / normalize", () => {
  it("reports the drawing offset and normalizes to 0,0", () => {
    const segs = parsePath("M40 30 L80 30 L60 70 Z");
    expect(pathOrigin(segs)).toEqual({ x: 40, y: 30 });
    const n = normalizePath(segs);
    expect(n.origin).toEqual({ x: 40, y: 30 });
    expect(n.bounds).toMatchObject({ x: 0, y: 0, width: 40, height: 40 });
    expect(serializePath(n.segs).startsWith("M0 0")).toBe(true);
  });

  it("normalize: true on create shifts d and x/y", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "path",
          id: "p",
          x: 100,
          y: 50,
          d: "M40 30 L80 30 L60 70 Z",
          normalize: true,
          fill: "#c43d27",
        },
      },
    ]);
    const p = doc.nodes.p!;
    expect(p).toMatchObject({ type: "path", x: 140, y: 80, width: 40, height: 40 });
    expect(serializePath(parsePath((p as { d: string }).d)).startsWith("M0 0")).toBe(true);
  });
});

describe("layout: groups and pages", () => {
  it("places group children in absolute coords", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "group",
          id: "g",
          x: 10,
          y: 20,
          children: [
            { type: "rect", id: "a", x: 5, y: 5, width: 10, height: 10 },
            { type: "rect", id: "b", x: 30, y: 5, width: 10, height: 10 },
          ],
        },
      },
    ]);
    const boxes = layout(doc);
    expect(boxes.g).toMatchObject({ x: 15, y: 25, width: 35, height: 10 });
    expect(boxes.a).toMatchObject({ x: 15, y: 25, width: 10, height: 10 });
    expect(boxes.b).toMatchObject({ x: 40, y: 25, width: 10, height: 10 });
  });
});
