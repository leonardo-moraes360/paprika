import { describe, expect, it } from "vitest";
import { applyOps, createDocument, displayList, exportSVG, nodeStyle, wasmPaintable, type Document, type FrameNode } from "../src/index.js";

function make(node: Record<string, unknown>, tokens?: Record<string, string | number>): Document {
  const ops = [];
  if (tokens) ops.push({ op: "set_tokens" as const, tokens });
  ops.push({ op: "create" as const, node });
  return applyOps(createDocument("T", "d"), ops).doc;
}

describe("raio por canto", () => {
  it("aceita um número, um token ou [tl, tr, br, bl] em frame, rect e image", () => {
    const doc = make(
      {
        type: "frame",
        id: "f",
        width: 120,
        height: 80,
        fill: "#fff",
        radius: [24, "$radius.md", 0, 4],
        children: [
          { type: "rect", id: "r", width: 40, height: 20, radius: [8, 8, 8, 8] },
          { type: "image", id: "i", width: 20, height: 20, src: "data:image/png;base64,aaaa", radius: [0, 6, 6, 0] },
        ],
      },
      { "radius.md": 12, brand: "#ff0000" },
    );
    expect(doc.nodes.f).toMatchObject({ radius: [24, "$radius.md", 0, 4] });
    expect(nodeStyle(doc, doc.nodes.f!).borderRadius).toBe("24px 12px 0px 4px");
    expect(nodeStyle(doc, doc.nodes.f!, { vars: true }).borderRadius).toBe("24px var(--radius\\.md) 0px 4px");
    expect(nodeStyle(doc, doc.nodes.r!).borderRadius).toBe("8px 8px 8px 8px");
    expect(nodeStyle(doc, doc.nodes.i!).borderRadius).toBe("0px 6px 6px 0px");
  });

  it("recusa tupla curta, canto negativo, elipse e token de cor", () => {
    const bad = (node: Record<string, unknown>, tokens?: Record<string, string | number>) =>
      expect(() => make(node, tokens)).toThrow(/radius/);
    bad({ type: "rect", id: "r", radius: [1, 2] });
    bad({ type: "rect", id: "r", radius: [-1, 0, 0, 0] });
    bad({ type: "ellipse", id: "e", radius: [1, 2, 3, 4] });
    bad({ type: "rect", id: "r", radius: ["$brand", 0, 0, 0] }, { brand: "#ff0000" });
  });

  it("SVG usa rx quando os cantos resolvem iguais e um path quando diferem", () => {
    const even = make({ type: "rect", id: "r", width: 80, height: 40, fill: "#111", radius: [8, 8, 8, 8] });
    expect(exportSVG(even, { rootId: "r" }).svg).toContain('rx="8"');
    expect(exportSVG(even, { rootId: "r" }).svg).not.toContain("<path");
    const odd = make({ type: "rect", id: "r", width: 80, height: 40, fill: "#111", radius: [24, 8, 0, 4] });
    const svg = exportSVG(odd, { rootId: "r" }).svg;
    expect(svg).toContain("<path");
    expect(svg).not.toContain("rx=");
    expect(svg).toContain("A24 24 0 0 1");
  });

  it("WASM pinta cantos iguais e devolve o resto ao DOM, inclusive os filhos", () => {
    const doc = make({
      type: "frame",
      id: "f",
      width: 200,
      height: 100,
      fill: "#fff",
      clip: true,
      radius: [20, 4, 0, 8],
      children: [
        { type: "rect", id: "kid", x: 10, y: 10, width: 40, height: 20, fill: "#111", radius: 4 },
        { type: "rect", id: "flat", x: 60, y: 10, width: 40, height: 20, fill: "#222", radius: [6, 6, 6, 6] },
      ],
    });
    expect(wasmPaintable(doc, doc.nodes.f!)).toBe(false);
    expect(wasmPaintable(doc, doc.nodes.kid!)).toBe(false);
    const same = make({ type: "rect", id: "r", width: 40, height: 20, fill: "#111", radius: [6, 6, 6, 6] });
    expect(wasmPaintable(same, same.nodes.r!)).toBe(true);
    const boxes = new Map([
      ["f", { x: 0, y: 0, w: 200, h: 100 }],
      ["kid", { x: 10, y: 10, w: 40, h: 20 }],
      ["flat", { x: 60, y: 10, w: 40, h: 20 }],
    ]);
    const list = displayList(doc, boxes);
    expect(list.painted.size).toBe(0);
    expect([...list.domPainted].sort()).toEqual(["f", "flat", "kid"]);
  });

  it("scale multiplica cada canto", () => {
    const doc = applyOps(createDocument("T", "d"), [
      { op: "create", node: { type: "frame", id: "btn", component: true, width: 80, height: 32, radius: [10, 0, 4, "$radius.md"], fill: "#333" } },
      { op: "set_tokens", tokens: { "radius.md": 8 } },
      { op: "create", node: { type: "frame", id: "i1", instanceOf: "btn", scale: 2 } },
    ]).doc;
    expect((doc.nodes.i1 as FrameNode).radius).toEqual([20, 0, 8, "$radius.md"]);
  });
});
