import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DISPLAY_STRIDE, displayList, parseDocument, solidColor, wasmPaintable, type Box, type Document } from "../src/index.js";

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

  it("emits clip and shapes in paint order, sending an overlapped path back to the DOM", () => {
    expect(list.count).toBe(3); // push clip f, rect r, pop clip — path p overlaps the gradient and the text
    expect(entry(0)[0]).toBe(2);
    expect(entry(1)[0]).toBe(0);
    expect(entry(2)[0]).toBe(3);
    expect([...list.painted].sort()).toEqual(["f", "r"]);
    expect([...list.domPainted]).toEqual(["g", "p"]);
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
    const only = parseDocument({
      format: "paprika/1",
      id: "d",
      rootIds: ["p"],
      nodes: {
        p: { id: "p", type: "path", d: "M0 0 L10 10", viewBox: [0, 0, 10, 10], fill: "#00ff00", width: 40, height: 20 },
      },
    });
    const one = displayList(only, new Map([["p", { x: 10, y: 20, w: 40, h: 20 }]]));
    expect(Array.from(one.data.slice(0, DISPLAY_STRIDE))[5]).toBe(0);
    expect(one.paths).toBe("0 0 10 10 nonzero round round|M0 0 L10 10");
    expect(one.painted.has("p")).toBe(true);
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

function scene(nodes: Record<string, unknown>, rootIds: string[], boxList: Record<string, Box>) {
  const doc = parseDocument({ format: "paprika/1", id: "d", rootIds, nodes });
  return displayList(doc, new Map(Object.entries(boxList)));
}

function absBoxes(doc: Document): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const walk = (id: string, ox: number, oy: number) => {
    const n = doc.nodes[id];
    if (!n || n.type === "page") return;
    const x = ox + n.x;
    const y = oy + n.y;
    const w = typeof n.width === "number" ? n.width : 0;
    const h = typeof n.height === "number" ? n.height : 0;
    boxes.set(id, { x, y, w, h });
    if ("children" in n) for (const c of n.children) walk(c, x, y);
  };
  for (const id of doc.rootIds) walk(id, 0, 0);
  return boxes;
}

describe("displayList paint order", () => {
  it("keeps a shape on WASM only when no earlier DOM paint overlaps it", () => {
    const list = scene(
      {
        frame: { id: "frame", type: "frame", width: 200, height: 300, fill: "#fff", children: ["label", "over", "far"] },
        label: { id: "label", type: "text", parentId: "frame", x: 10, y: 10, width: 80, height: 20, text: "hi" },
        over: { id: "over", type: "rect", parentId: "frame", x: 10, y: 10, width: 80, height: 20, fill: "#00f" },
        far: { id: "far", type: "rect", parentId: "frame", x: 10, y: 200, width: 80, height: 20, fill: "#f00" },
      },
      ["frame"],
      {
        frame: { x: 0, y: 0, w: 200, h: 300 },
        label: { x: 10, y: 10, w: 80, h: 20 },
        over: { x: 10, y: 10, w: 80, h: 20 },
        far: { x: 10, y: 200, w: 80, h: 20 },
      },
    );
    expect([...list.painted].sort()).toEqual(["far", "frame"]);
    expect(list.domPainted.has("over")).toBe(true);
  });

  it("demotes a solid child of a DOM-painted ancestor, and the nodes after that child", () => {
    const list = scene(
      {
        dash: { id: "dash", type: "rect", x: 0, y: 0, width: 80, height: 80, fill: "#ccc", stroke: { color: "#000", width: 4, style: "dashed" } },
        frame: { id: "frame", type: "frame", x: 40, y: 40, width: 80, height: 80, fill: "#fff", children: ["kid"] },
        kid: { id: "kid", type: "rect", parentId: "frame", x: 10, y: 10, width: 20, height: 20, fill: "#f00" },
        aside: { id: "aside", type: "rect", x: 200, y: 0, width: 20, height: 20, fill: "#0f0" },
      },
      ["dash", "frame", "aside"],
      {
        dash: { x: 0, y: 0, w: 80, h: 80 },
        frame: { x: 40, y: 40, w: 80, h: 80 },
        kid: { x: 50, y: 50, w: 20, h: 20 },
        aside: { x: 200, y: 0, w: 20, h: 20 },
      },
    );
    expect(list.painted.has("frame")).toBe(false);
    expect(list.painted.has("kid")).toBe(false);
    expect(list.painted.has("aside")).toBe(true);
    expect([...list.domPainted].sort()).toEqual(["dash", "frame", "kid"]);
  });

  it("counts stroke, shadow and rotation in the painted bounds", () => {
    const stroke = scene(
      {
        edge: { id: "edge", type: "rect", x: 0, y: 0, width: 20, height: 20, fill: "#fff", stroke: { color: "#000", width: 10, position: "outside", style: "dashed" } },
        hit: { id: "hit", type: "rect", x: 22, y: 2, width: 6, height: 6, fill: "#f00" },
        miss: { id: "miss", type: "rect", x: 34, y: 2, width: 6, height: 6, fill: "#0f0" },
      },
      ["edge", "hit", "miss"],
      {
        edge: { x: 0, y: 0, w: 20, h: 20 },
        hit: { x: 22, y: 2, w: 6, h: 6 },
        miss: { x: 34, y: 2, w: 6, h: 6 },
      },
    );
    expect(stroke.painted.has("hit")).toBe(false);
    expect(stroke.painted.has("miss")).toBe(true);

    const shadow = scene(
      {
        sh: { id: "sh", type: "rect", x: 0, y: 0, width: 20, height: 20, fill: "#fff", stroke: { color: "#000", width: 2, style: "dashed" }, shadow: { x: 40, y: 0, blur: 0, spread: 0, color: "#000" } },
        hit: { id: "hit", type: "rect", x: 45, y: 2, width: 10, height: 10, fill: "#f00" },
        miss: { id: "miss", type: "rect", x: 70, y: 2, width: 10, height: 10, fill: "#0f0" },
      },
      ["sh", "hit", "miss"],
      {
        sh: { x: 0, y: 0, w: 20, h: 20 },
        hit: { x: 45, y: 2, w: 10, h: 10 },
        miss: { x: 70, y: 2, w: 10, h: 10 },
      },
    );
    expect(shadow.painted.has("hit")).toBe(false);
    expect(shadow.painted.has("miss")).toBe(true);

    const rotated = scene(
      {
        spin: { id: "spin", type: "rect", x: 0, y: 0, width: 100, height: 10, rotation: 90, fill: "#fff", stroke: { color: "#000", width: 2, style: "dashed" } },
        hit: { id: "hit", type: "rect", x: 46, y: 30, width: 8, height: 10, fill: "#f00" },
        miss: { id: "miss", type: "rect", x: 0, y: 30, width: 20, height: 10, fill: "#0f0" },
      },
      ["spin", "hit", "miss"],
      {
        spin: { x: 0, y: 0, w: 100, h: 10 },
        hit: { x: 46, y: 30, w: 8, h: 10 },
        miss: { x: 0, y: 30, w: 20, h: 10 },
      },
    );
    expect(rotated.painted.has("hit")).toBe(false);
    expect(rotated.painted.has("miss")).toBe(true);
  });

  it("ignores DOM paint that an ancestor clip cuts away from a later shape", () => {
    const clipCase = (clip: boolean) =>
      scene(
        {
          frame: { id: "frame", type: "frame", x: 0, y: 0, width: 100, height: 100, clip, children: ["dash"] },
          dash: { id: "dash", type: "rect", parentId: "frame", x: 70, y: 10, width: 50, height: 20, fill: "#f00", stroke: { color: "#000", width: 2, style: "dashed" } },
          front: { id: "front", type: "rect", x: 110, y: 10, width: 30, height: 30, fill: "#0f0" },
        },
        ["frame", "front"],
        {
          frame: { x: 0, y: 0, w: 100, h: 100 },
          dash: { x: 70, y: 10, w: 50, h: 20 },
          front: { x: 110, y: 10, w: 30, h: 30 },
        },
      );
    expect(clipCase(true).painted.has("front")).toBe(true);
    expect(clipCase(false).painted.has("front")).toBe(false);
  });

  it("matches the three overlap cases in examples/wasm-layers.paprika.json", () => {
    const doc = parseDocument(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../examples/wasm-layers.paprika.json"), "utf8")));
    const list = displayList(doc, absBoxes(doc));
    expect([...list.painted].sort()).toEqual(["back", "board", "card"]);
    expect([...list.domPainted].sort()).toEqual(["child", "cover", "dash", "front", "nest"]);
  });

  it("paints every shape of the flat-board logo (PAP-A-012) on WASM, in paint order", () => {
    const doc = parseDocument(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../examples/wasm-gpu-blank.paprika.json"), "utf8")));
    const list = displayList(doc, absBoxes(doc));
    // Frame (clip), 9 rects, 2 paths, ellipse, pop clip. Only the text stays on the DOM.
    expect(list.count).toBe(14);
    expect([...list.painted].sort()).toEqual(["board", "cell0", "cell1", "cell2", "cell3", "cell4", "cell5", "cell6", "cell7", "cell8", "eye", "fluke", "hull"].sort());
    expect([...list.domPainted]).toEqual([]);
    const at = (i: number) => Array.from(list.data.slice(i * DISPLAY_STRIDE, (i + 1) * DISPLAY_STRIDE));
    expect(at(0).slice(0, 5)).toEqual([2, 0, 0, 1200, 900]);
    expect(at(0).slice(8, 12).map((v) => Math.round(v * 255))).toEqual([0x62, 0x71, 0xff, 255]);
    for (let i = 1; i <= 9; i++) {
      const e = at(i);
      expect(e[0]).toBe(0);
      expect(e.slice(3, 6)).toEqual([13, 13, 2]); // size and radius slot
      expect(e.slice(8, 12).map((v) => Math.round(v * 255))).toEqual([0x0b, 0x0b, 0x0b, 255]);
    }
    // Path entries carry their index in the radius slot, never a corner radius.
    expect(at(10)[0]).toBe(4);
    expect(at(10)[5]).toBe(0);
    expect(at(11)[0]).toBe(4);
    expect(at(11)[5]).toBe(1);
    expect(list.paths.split("\n")).toHaveLength(2);
    expect(at(12)[0]).toBe(1);
    expect(at(13)[0]).toBe(3);
  });
});
