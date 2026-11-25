import { describe, expect, it } from "vitest";
import { applyOps, createDocument, layout, nodeStyle } from "../src/index.js";

const make = (node: object) => applyOps(createDocument("t", "d"), [{ op: "create", node } as never]).doc;
const row = (children: object[], extra: object = {}) =>
  make({ type: "frame", id: "f", width: 400, height: 60, layout: { mode: "row", gap: 10, padding: 20 }, children, ...extra });

describe("layoutGrow", () => {
  it("pushes the next child to the end with a growing spacer", () => {
    const b = layout(
      row([
        { type: "rect", id: "a", width: 50, height: 20 },
        { type: "rect", id: "sp", width: 0, height: 0, layoutGrow: 1 },
        { type: "rect", id: "z", width: 50, height: 20 },
      ]),
    );
    expect(b.a).toMatchObject({ x: 20, width: 50 });
    expect(b.sp).toMatchObject({ x: 80, width: 360 - 50 - 50 - 20 });
    expect(b.z).toMatchObject({ x: 330, width: 50 });
  });

  it("splits the free main space by weight on top of each base size", () => {
    const b = layout(
      row([
        { type: "rect", id: "a", width: 40, height: 20, layoutGrow: 1 },
        { type: "rect", id: "b", width: 40, height: 20, layoutGrow: 3 },
        { type: "rect", id: "c", width: 100, height: 20 },
      ]),
    );
    const free = 360 - (40 + 40 + 100 + 20);
    expect(b.a!.width).toBeCloseTo(40 + free / 4, 3);
    expect(b.b!.width).toBeCloseTo(40 + (free * 3) / 4, 3);
    expect(b.c).toMatchObject({ width: 100 });
    expect(b.c!.x).toBeCloseTo(380 - 100, 3);
  });

  it("takes only a fraction of the free space when the weights sum below 1", () => {
    const b = layout(row([{ type: "rect", id: "a", width: 100, height: 20, layoutGrow: 0.5 }]));
    expect(b.a!.width).toBeCloseTo(100 + (360 - 100) * 0.5, 3);
  });

  it("grows along the column and leaves fill children to fill", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 200,
      height: 300,
      layout: { mode: "column", gap: 0 },
      children: [
        { type: "rect", id: "a", width: 50, height: 100, layoutGrow: 1 },
        { type: "rect", id: "b", width: 50, height: "fill", layoutGrow: 5 },
      ],
    });
    const b = layout(doc);
    expect(b.a!.height).toBeCloseTo(100 + 100, 3);
    expect(b.b!.height).toBeCloseTo(100, 3);
  });

  it("does nothing in a hug frame and keeps hug text growing in a row", () => {
    const hug = layout(
      make({ type: "frame", id: "f", width: "hug", height: 40, layout: { mode: "row" }, children: [{ type: "rect", id: "a", width: 70, height: 20, layoutGrow: 2 }] }),
    );
    expect(hug.a).toMatchObject({ width: 70 });
    expect(hug.f).toMatchObject({ width: 70 });
    const t = layout(
      row([
        { type: "text", id: "t", text: "Title", width: "hug", height: "hug", fontSize: 16, layoutGrow: 1 },
        { type: "rect", id: "r", width: 40, height: 20 },
      ]),
    );
    expect(t.t!.width).toBeCloseTo(360 - 10 - 40, 3);
    expect(t.r!.x).toBeCloseTo(340, 3);
  });

  it("emits flex-grow in nodeStyle, skipping fill children and nodes outside a flow", () => {
    const doc = row(
      [
        { type: "rect", id: "a", width: 50, height: 20, layoutGrow: 2 },
        { type: "rect", id: "b", width: "fill", height: 20, layoutGrow: 2 },
        { type: "rect", id: "c", width: 50, height: 20 },
      ],
    );
    expect(nodeStyle(doc, doc.nodes.a!).flexGrow).toBe(2);
    expect(nodeStyle(doc, doc.nodes.b!).flexGrow).toBeUndefined();
    expect(nodeStyle(doc, doc.nodes.c!).flexGrow).toBeUndefined();
    expect(nodeStyle(doc, doc.nodes.a!, { asRoot: true }).flexGrow).toBeUndefined();
  });

  it("rejects a negative layoutGrow", () => {
    expect(() => make({ type: "rect", id: "r", layoutGrow: -1 })).toThrow(/layoutGrow/);
  });
});
