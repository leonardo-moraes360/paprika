import { describe, expect, it } from "vitest";
import { applyOps, createDocument, listShadows, nodeStyle, wasmPaintable } from "../src/index.js";

function rect(props: Record<string, unknown> = {}) {
  const base = createDocument("t", "d");
  return applyOps(base, [{ op: "create", node: { type: "rect", id: "r", fill: "#fff", ...props } }]).doc;
}

describe("shadows, outline and filters", () => {
  it("keeps a single shadow as one box-shadow", () => {
    const doc = rect({ shadow: { x: 0, y: 2, blur: 4, spread: 0, color: "#00000080" } });
    expect(nodeStyle(doc, doc.nodes.r!).boxShadow).toBe("0px 2px 4px 0px #00000080");
    expect(wasmPaintable(doc, doc.nodes.r!)).toBe(true);
  });

  it("paints a list with an inner shadow and leaves it on the DOM", () => {
    const doc = rect({
      shadow: [
        { x: 0, y: 8, blur: 16, color: "#00000055" },
        { x: 0, y: 2, blur: 4, color: "#4cc7d8", inner: true },
      ],
    });
    expect(nodeStyle(doc, doc.nodes.r!).boxShadow).toBe("0px 8px 16px 0px #00000055, inset 0px 2px 4px 0px #4cc7d8");
    expect(listShadows(doc.nodes.r!.shadow)).toHaveLength(2);
    expect(wasmPaintable(doc, doc.nodes.r!)).toBe(false);
  });

  it("paints outline, filter and backdrop-filter", () => {
    const doc = rect({
      outline: { color: "#4cc7d8", width: 2, style: "dashed", offset: 3 },
      filter: { blur: 2, saturate: 1.5, hueRotate: 20 },
      backdropFilter: { blur: 8, grayscale: 0.4 },
    });
    const css = nodeStyle(doc, doc.nodes.r!);
    expect(css.outline).toBe("2px dashed #4cc7d8");
    expect(css.outlineOffset).toBe("3px");
    expect(css.filter).toBe("blur(2px) saturate(1.5) hue-rotate(20deg)");
    expect(css.backdropFilter).toBe("blur(8px) grayscale(0.4)");
    expect(wasmPaintable(doc, doc.nodes.r!)).toBe(false);
  });

  it("keeps an outside stroke and paints the outline as a ring", () => {
    const doc = rect({
      stroke: { color: "#111", width: 4, position: "outside" },
      outline: { color: "#4cc7d8", width: 2 },
    });
    const css = nodeStyle(doc, doc.nodes.r!);
    expect(css.outline).toBe("4px solid #111");
    expect(css.boxShadow).toBe("0px 0px 0px 2px #4cc7d8");
  });

  it("chains drop-shadows on a path and insets the inner one", () => {
    const base = createDocument("t", "d");
    const doc = applyOps(base, [{
      op: "create",
      node: {
        type: "path",
        id: "p",
        d: "M0 0 L10 10",
        shadow: [
          { x: 1, y: 2, blur: 3, color: "#000" },
          { x: 0, y: 1, blur: 2, color: "#fff", inner: true },
        ],
        filter: { blur: 1 },
      },
    }]).doc;
    const css = nodeStyle(doc, doc.nodes.p!);
    expect(css.filter).toBe("drop-shadow(1px 2px 3px #000) blur(1px)");
    expect(css.boxShadow).toBe("inset 0px 1px 2px 0px #fff");
  });

  it("rejects an empty filter and an empty shadow list", () => {
    const base = createDocument("t", "d");
    expect(() => applyOps(base, [{ op: "create", node: { type: "rect", id: "r", filter: {} } }])).toThrow(/filter needs at least one/);
    expect(() => applyOps(base, [{ op: "create", node: { type: "rect", id: "r", shadow: [] } }])).toThrow(/Too small/);
  });
});
