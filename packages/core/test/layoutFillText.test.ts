import { describe, expect, it } from "vitest";
import { applyOps, createDocument, layout } from "../src/index.js";

const make = (node: object) => applyOps(createDocument("t", "d"), [{ op: "create", node } as never]).doc;
const sentence = "The quick brown fox jumps over the lazy dog again and again";

describe("layout: fill text in a hug frame", () => {
  it("hugs a column frame to the lines its fill-width text wraps into", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 420,
      height: "hug",
      layout: { mode: "column", padding: 24 },
      children: [{ type: "text", id: "t", text: sentence, width: "fill", height: "hug", fontSize: 16 }],
    });
    const b = layout(doc);
    expect(b.t).toMatchObject({ width: 372, height: 44.8 });
    expect(b.f).toMatchObject({ width: 420, height: 48 + 44.8 });
  });

  it("matches the numeric width the text resolves to", () => {
    const fill = layout(
      make({ type: "frame", id: "f", width: 420, height: "hug", layout: { mode: "column", padding: 24 }, children: [{ type: "text", id: "t", text: sentence, width: "fill", height: "hug", fontSize: 16 }] }),
    );
    const fixed = layout(
      make({ type: "frame", id: "f", width: 420, height: "hug", layout: { mode: "column", padding: 24 }, children: [{ type: "text", id: "t", text: sentence, width: 372, height: "hug", fontSize: 16 }] }),
    );
    expect(fill.f!.height).toBe(fixed.f!.height);
  });

  it("measures fill text at the share it gets in a row", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 420,
      height: "hug",
      layout: { mode: "row", padding: 24, gap: 12 },
      children: [
        { type: "rect", id: "r", width: 60, height: 10 },
        { type: "text", id: "t", text: sentence, width: "fill", height: "hug", fontSize: 16 },
      ],
    });
    const b = layout(doc);
    expect(b.t!.width).toBe(300);
    expect(b.f!.height).toBe(48 + b.t!.height);
  });
});
