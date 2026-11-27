import type { Document, NodeInput } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { fileKind, IMAGE_LONG_SIDE, imageNode, imageSize, parseMarkup, placeNodes, refusalFor } from "./import";

const frame = (id: string, x: number, y: number, width: number, height: number, extra = {}) => ({ id, type: "frame", name: id, parentId: "p1", x, y, width, height, children: [], rotation: 0, opacity: 1, visible: true, locked: false, ...extra });
const doc = (frames: ReturnType<typeof frame>[]) =>
  ({ id: "d", name: "D", rootIds: ["p1"], tokens: {}, nodes: { p1: { id: "p1", type: "page", name: "P", parentId: null, children: frames.map((f) => f.id) }, ...Object.fromEntries(frames.map((f) => [f.id, f])) } }) as unknown as Document;

describe("fileKind and refusals", () => {
  it("tells pictures, SVG, HTML and a whole document apart", () => {
    expect(fileKind("a.PNG", "")).toBe("raster");
    expect(fileKind("a", "image/webp")).toBe("raster");
    expect(fileKind("a.svg", "")).toBe("svg");
    expect(fileKind("a.txt", "", "<svg viewBox='0 0 1 1'></svg>")).toBe("svg");
    expect(fileKind("a.html", "text/html")).toBe("html");
    expect(fileKind("a.paprika.json", "application/json")).toBe("paprika");
    expect(fileKind("a.zip", "")).toBe("unsupported");
  });

  it("refuses .fig, PDF and .paprika.json by name", () => {
    expect(refusalFor("x.fig")?.code).toBe("fig");
    expect(refusalFor("x.PDF")?.code).toBe("pdf");
    expect(refusalFor("x.paprika.json")?.code).toBe("paprika");
    expect(refusalFor("x.svg")).toBeNull();
  });
});

describe("pictures", () => {
  it("scales down to 480 px on the long side and never up", () => {
    expect(imageSize(960, 480)).toEqual({ width: IMAGE_LONG_SIDE, height: 240 });
    expect(imageSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(imageSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("makes an image node named after the file, contained, with the file name as alt", () => {
    const node = imageNode({ name: "logo.final.png" }, "data:image/png;base64,AA", { width: 1000, height: 500 });
    expect(node).toMatchObject({ type: "image", name: "logo.final", width: 480, height: 240, src: "data:image/png;base64,AA", fit: "contain", alt: "logo.final.png" });
    expect(typeof node.id).toBe("string");
  });
});

describe("parseMarkup", () => {
  it("converts SVG with the core converter and throws the converter's message when nothing comes out", () => {
    const result = parseMarkup("svg", '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(() => parseMarkup("svg", "<div></div>")).toThrow();
    expect(() => parseMarkup("html", "")).toThrow();
  });
});

describe("placeNodes", () => {
  const node = (x: number, y: number, w: number, h: number) => ({ type: "rect", name: "r", x, y, width: w, height: h }) as unknown as NodeInput;

  it("creates the nodes in the page at a free spot, with fresh ids, keeping the layout among them", () => {
    const placed = placeNodes(doc([frame("a", 0, 0, 400, 400)]), "p1", [[node(0, 0, 100, 50), node(20, 10, 10, 10)]]);
    expect(placed.ids).toHaveLength(2);
    const [first, second] = placed.ops as unknown as { op: string; parentId: string; node: { id: string; x: number; y: number } }[];
    expect(first).toMatchObject({ op: "create", parentId: "p1" });
    expect(placed.ids).toEqual([first!.node.id, second!.node.id]);
    expect(first!.node.x).toBeGreaterThanOrEqual(400);
    expect(second!.node.x - first!.node.x).toBe(20);
    expect(second!.node.y - first!.node.y).toBe(10);
  });

  it("puts the second group clear of the first and starts at the origin on an empty page", () => {
    const placed = placeNodes(doc([]), "p1", [[node(5, 5, 100, 100)], [node(0, 0, 100, 100)]]);
    const boxes = (placed.ops as unknown as { node: { x: number; y: number } }[]).map((op) => op.node);
    expect(boxes[0]).toMatchObject({ x: 0, y: 0 });
    expect(boxes[1]!.x >= 100 || boxes[1]!.y >= 100).toBe(true);
  });

  it("pins a node dropped into an auto layout frame, and carries the warnings", () => {
    const flow = doc([frame("a", 0, 0, 400, 400, { layout: { mode: "column", gap: 0, padding: 0 } })]);
    const placed = placeNodes(flow, "a", [[node(0, 0, 10, 10)]], ["careful"]);
    expect((placed.ops[0] as unknown as { node: { layoutPositioning: string } }).node.layoutPositioning).toBe("absolute");
    expect(placed.warnings).toEqual(["careful"]);
  });
});
