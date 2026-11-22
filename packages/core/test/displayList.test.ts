import { describe, expect, it } from "vitest";
import { DISPLAY_STRIDE, displayList, parseDocument, solidColor, wasmPaintable, type Box } from "../src/index.js";

const doc = parseDocument({
  format: "paprika/1",
  id: "d",
  tokens: { brand: "#ff0000", soft: "$brand" },
  rootIds: ["f"],
  nodes: {
    f: { id: "f", type: "frame", x: 10, y: 20, width: 200, height: 100, fill: "$soft", radius: 8, clip: true, children: ["r", "t", "g", "p", "h"] },
    r: { id: "r", type: "rect", parentId: "f", x: 5, y: 5, width: 20, height: 10, fill: "rgba(0, 0, 255, 0.5)", stroke: { color: "#000", width: 2 }, opacity: 0.5, shadow: { x: 1, y: 2, blur: 4, color: "#00000080" } },
    t: { id: "t", type: "text", parentId: "f", text: "hi" },
    g: { id: "g", type: "rect", parentId: "f", fill: "linear-gradient(#fff, #000)" },
    p: { id: "p", type: "path", parentId: "f", d: "M0 0 L10 10", viewBox: [0, 0, 10, 10], fill: "#00ff00" },
    h: { id: "h", type: "ellipse", parentId: "f", visible: false, fill: "#fff" },
  },
});
const boxes = new Map<string, Box>([
  ["f", { x: 10, y: 20, w: 200, h: 100 }],
  ["r", { x: 15, y: 25, w: 20, h: 10 }],
  ["t", { x: 10, y: 20, w: 50, h: 20 }],
  ["g", { x: 10, y: 20, w: 100, h: 100 }],
  ["p", { x: 10, y: 20, w: 40, h: 20 }],
]);

describe("displayList", () => {
  const list = displayList(doc, boxes);
  const entry = (i: number) => Array.from(list.data.slice(i * DISPLAY_STRIDE, (i + 1) * DISPLAY_STRIDE));

  it("emits clip, shapes and paths in paint order, leaving text and gradients to the DOM", () => {
    expect(list.count).toBe(4); // push clip f, rect r, path p, pop clip
    expect(entry(0)[0]).toBe(2);
    expect(entry(1)[0]).toBe(0);
    expect(entry(2)[0]).toBe(4);
    expect(entry(3)[0]).toBe(3);
    expect([...list.painted].sort()).toEqual(["f", "p", "r"]);
    expect([...list.domPainted]).toEqual(["g"]);
  });

  it("resolves tokens and packs colors, stroke, opacity and shadow", () => {
    const f = entry(0);
    expect(f.slice(1, 9)).toEqual([10, 20, 200, 100, 8, 0, 1, 1]);
    expect(f.slice(8, 12)).toEqual([1, 0, 0, 1]); // $soft -> $brand -> #ff0000
    const r = entry(1);
    expect(r[7]).toBe(0.5);
    expect(r.slice(8, 12)).toEqual([0, 0, 1, 0.5]);
    expect(r.slice(12, 17)).toEqual([2, 0, 0, 0, 1]);
    expect(r.slice(17, 21)).toEqual([1, 2, 4, 0]);
    expect(r[24]).toBeCloseTo(128 / 255);
  });

  it("indexes the path table from the entry", () => {
    expect(entry(2)[5]).toBe(0);
    expect(list.paths).toBe("0 0 10 10 nonzero round round|M0 0 L10 10");
  });

  it("knows which paints it cannot reproduce", () => {
    expect(solidColor(doc, "transparent")).toEqual([0, 0, 0, 0]);
    expect(solidColor(doc, "linear-gradient(#fff, #000)")).toBeNull();
    expect(wasmPaintable(doc, doc.nodes.t!)).toBe(false);
    const shadowPath = { ...doc.nodes.p!, shadow: { x: 0, y: 0, blur: 2, spread: 0, color: "#000" } } as typeof doc.nodes.p;
    expect(wasmPaintable(doc, shadowPath!)).toBe(false);
    const dashed = { ...doc.nodes.r!, stroke: { color: "#000", width: 2, style: "dashed" as const } };
    expect(wasmPaintable(doc, dashed)).toBe(false);
    const outside = { ...doc.nodes.r!, stroke: { color: "#000", width: 2, position: "outside" as const } };
    expect(wasmPaintable(doc, outside)).toBe(false);
  });
});
