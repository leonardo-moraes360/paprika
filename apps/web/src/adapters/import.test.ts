import { importHTML, importSVG, type Document, type NodeInput } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { batchBySize, converterNote, fileKind, IMAGE_LONG_SIDE, IMPORT_BATCH_BYTES, imageNode, imageSize, MarkupError, opsBytes, parseMarkup, placeNodes, refusalFor } from "./import";

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

  it("names a picture that came without a name with the default the caller gives (the language of the interface)", () => {
    expect(imageNode({ name: "" }, "data:image/png;base64,AA", { width: 10, height: 10 }, "imagem")).toMatchObject({ name: "imagem", alt: "" });
    expect(imageNode({ name: ".png" }, "data:image/png;base64,AA", { width: 10, height: 10 }, "imagem")).toMatchObject({ name: "imagem" });
  });
});

describe("parseMarkup", () => {
  it("converts SVG with the core converter and throws the converter's message when nothing comes out", () => {
    const result = parseMarkup("svg", '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>');
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(() => parseMarkup("svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>")).toThrow(MarkupError);
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

describe("placeNodes with a lot of nodes", () => {
  it("places an SVG of 200 000 nodes (spreading them into Math.min would overflow the stack)", () => {
    const nodes = Array.from({ length: 200_000 }, (_, i) => ({ type: "rect", name: "r", x: i % 500, y: Math.floor(i / 500), width: 2, height: 2 }) as unknown as NodeInput);
    const placed = placeNodes(doc([frame("a", 0, 0, 400, 400)]), "p1", [nodes, nodes.slice(0, 10)]);
    expect(placed.ops).toHaveLength(200_010);
    expect(placed.byGroup.map((group) => group.ops.length)).toEqual([200_000, 10]);
  });

  it("says which ops and ids each input group made, in order (an empty group makes none)", () => {
    const rect = (x: number) => ({ type: "rect", name: "r", x, y: 0, width: 10, height: 10 }) as unknown as NodeInput;
    const placed = placeNodes(doc([]), "p1", [[rect(0), rect(20)], [], [rect(0)]]);
    expect(placed.byGroup.map((group) => group.ids.length)).toEqual([2, 0, 1]);
    expect(placed.byGroup.flatMap((group) => group.ids)).toEqual(placed.ids);
    expect(placed.byGroup.flatMap((group) => group.ops)).toEqual(placed.ops);
  });
});

describe("batches under the server's message limit", () => {
  it("fills a batch in order up to the limit and starts another when the next item would pass it", () => {
    expect(batchBySize([4, 4, 4, 1, 7, 1], 8)).toEqual([
      { indexes: [0, 1], oversized: false },
      { indexes: [2, 3], oversized: false },
      { indexes: [4, 5], oversized: false },
    ]);
    expect(batchBySize([], 8)).toEqual([]);
  });

  it("sends an item over the limit alone, flagged, and does not drag its neighbours into it", () => {
    expect(batchBySize([3, 9, 3, 3], 8)).toEqual([
      { indexes: [0], oversized: false },
      { indexes: [1], oversized: true },
      { indexes: [2, 3], oversized: false },
    ]);
  });

  it("keeps the batch limit under the 8 MiB the server reads in a message, and counts bytes of UTF-8 (not characters)", () => {
    expect(IMPORT_BATCH_BYTES).toBeLessThan(8 * 1024 * 1024);
    const op = { op: "create", parentId: null, node: { name: "ação" } } as never;
    expect(opsBytes([op])).toBe(new TextEncoder().encode(JSON.stringify([op])).length);
    expect(opsBytes([op])).toBeGreaterThan(JSON.stringify([op]).length);
  });
});

describe("converter notes", () => {
  it("maps every sentence the SVG and HTML converters of the core write to a known key, so nothing falls to the English fallback", () => {
    const notes = [
      ...importSVG('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>a{}</style><defs><linearGradient id="g"/></defs><rect width="5" height="5" fill="url(#g)" transform="foo(1)" clip-path="url(#c)"/><rect width="5" height="5" fill="nope" stroke="#f00" stroke-opacity="0.5"/><circle r="-3"/><use href="#missing"/><use/><use href="http://x/y.svg#a"/><use href="#u"/><symbol id="u"><use href="#u"/></symbol><foreignObject/><text transform="rotate(10)" x="1" y="2">hi</text></svg>', { x: 0, y: 0 }).warnings,
      ...importSVG("<svg xmlns='http://www.w3.org/2000/svg'></svg>", { x: 0, y: 0 }).warnings,
      "no <svg> element found",
      "markup too large (max. 1000000 characters)",
      "markup with more than 5000 elements",
      "markup with more than 64 levels",
      ...importHTML('<div class="a" style="background-image:url(x.png);font-size:2em;position:fixed;width:50%;height:calc(1px + 2px)"><img src="x.png"></div>', { x: 0, y: 0 }).warnings,
      ...importHTML("", { x: 0, y: 0 }).warnings,
    ];
    expect(notes.length).toBeGreaterThan(8);
    for (const note of notes) expect(converterNote(note), note).not.toMatchObject({ key: "other" });
  });

  it("keeps what the sentence quotes, and shows a sentence it does not know as the detail of `other`", () => {
    expect(converterNote('<use> target "#abc" was not found')).toEqual({ key: "useMissing", values: { id: "abc" } });
    expect(converterNote('font-size "2em" is not px; skipped')).toEqual({ key: "fontSize", values: { value: "2em" } });
    expect(converterNote("something new")).toEqual({ key: "other", values: { detail: "something new" } });
  });
});
