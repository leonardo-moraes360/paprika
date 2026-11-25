import { describe, expect, it } from "vitest";
import {
  History,
  addPageOps,
  alignOps,
  applyOps,
  canvasBounds,
  createDocument,
  displayList,
  distributeOps,
  duplicateOps,
  exportReact,
  groupOps,
  lintDocument,
  nodeStyle,
  outline,
  pageRoots,
  parseDocument,
  renderHTML,
  revealOps,
  ungroupOps,
  wrapOps,
  type Box,
  type Document,
  type FrameNode,
  type GroupNode,
  type Node as NodeT,
} from "../src/index.js";

function scene(): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "f",
        name: "Tela",
        width: 400,
        height: 300,
        fill: "#ffffff",
        children: [
          { type: "rect", id: "a", x: 40, y: 50, width: 20, height: 10, fill: "#ff0000" },
          { type: "ellipse", id: "b", x: 100, y: 20, width: 30, height: 30, fill: "#00ff00" },
          { type: "text", id: "c", x: 10, y: 200, width: 100, height: 20, text: "fora" },
        ],
      },
    },
  ]).doc;
}

const group = (doc: Document, id = "g") => doc.nodes[id] as GroupNode;

describe("groups", () => {
  it("group_nodes keeps the drawing still and fits the box to the children", () => {
    const doc0 = scene();
    const plan = groupOps(doc0, ["b", "a"], { id: "g" });
    const { doc } = applyOps(doc0, plan.ops);
    const g = group(doc);
    expect(g).toMatchObject({ type: "group", parentId: "f", x: 40, y: 20, width: 90, height: 40 });
    expect(g.children).toEqual(["a", "b"]);
    expect((doc.nodes.f as { children: string[] }).children).toEqual(["g", "c"]);
    expect(doc.nodes.a).toMatchObject({ x: 0, y: 30 });
    expect(doc.nodes.b).toMatchObject({ x: 60, y: 0 });
    expect(nodeStyle(doc, g)).toMatchObject({ position: "absolute", left: "40px", top: "20px", width: "90px" });
  });

  it("refits after a child moves and undo restores every position", () => {
    const h = new History(scene());
    h.apply(groupOps(h.doc, ["a", "b"], { id: "g" }).ops);
    const grouped = structuredClone(h.doc);
    h.apply([{ op: "update", id: "a", props: { x: -10, y: -5 } }]);
    expect(group(h.doc)).toMatchObject({ x: 30, y: 15, width: 100, height: 35 });
    expect(h.doc.nodes.a).toMatchObject({ x: 0, y: 0 });
    expect(h.doc.nodes.b).toMatchObject({ x: 70, y: 5 });
    h.undo();
    expect(h.doc).toEqual(grouped);
    h.redo();
    expect(group(h.doc)).toMatchObject({ x: 30, y: 15 });
  });

  it("counts child rotation in the box", () => {
    const doc0 = applyOps(scene(), [{ op: "update", id: "a", props: { rotation: 90 } }]).doc;
    const { doc } = applyOps(doc0, groupOps(doc0, ["a"], { id: "g" }).ops);
    expect(group(doc)).toMatchObject({ x: 45, y: 45, width: 10, height: 20 });
    expect(doc.nodes.a).toMatchObject({ x: -5, y: 5, rotation: 90 });
  });

  it("ungroup puts the children back with the group's position, opacity and visibility", () => {
    const doc0 = scene();
    const grouped = applyOps(doc0, groupOps(doc0, ["a", "b"], { id: "g" }).ops).doc;
    const faded = applyOps(grouped, [{ op: "update", id: "g", props: { x: 50, opacity: 0.5 } }]).doc;
    const { ops, released } = ungroupOps(faded, ["g"]);
    const { doc } = applyOps(faded, ops);
    expect(released).toEqual(["a", "b"]);
    expect(doc.nodes.g).toBeUndefined();
    expect((doc.nodes.f as { children: string[] }).children).toEqual(["a", "b", "c"]);
    expect(doc.nodes.a).toMatchObject({ x: 50, y: 50, opacity: 0.5 });
    expect(doc.nodes.b).toMatchObject({ x: 110, y: 20, opacity: 0.5 });
  });

  it("rejects invalid groupings with actionable errors", () => {
    const doc = scene();
    expect(() => groupOps(doc, [])).toThrow(/at least one/);
    expect(() => groupOps(doc, ["a", "f"])).toThrow(/same parent/);
    expect(() => groupOps(doc, ["zz"])).toThrow(/do not exist: zz/);
    const flow = applyOps(doc, [{ op: "update", id: "f", props: { layout: { mode: "row" } } }]).doc;
    expect(() => groupOps(flow, ["a"])).toThrow(/layout row/);
    expect(() => applyOps(doc, [{ op: "create", node: { type: "group", id: "g", width: 10 } }])).toThrow(/follow its children/);
    const g = applyOps(doc, groupOps(doc, ["a"], { id: "g" }).ops).doc;
    expect(() => applyOps(g, [{ op: "update", id: "g", props: { height: 3 } }])).toThrow(/follow its children/);
    expect(() => applyOps(g, [{ op: "update", id: "g", props: { fill: "#000" } }])).toThrow(/unknown field for group: fill/);
    expect(() => ungroupOps(g, ["a"])).toThrow(/not a group/);
  });

  it("nested groups fit from the inside out; empty groups are linted", () => {
    const doc0 = scene();
    const inner = applyOps(doc0, groupOps(doc0, ["a"], { id: "g1" }).ops).doc;
    const { doc } = applyOps(inner, groupOps(inner, ["g1", "b"], { id: "g2" }).ops);
    expect(group(doc, "g2")).toMatchObject({ x: 40, y: 20, width: 90, height: 40 });
    expect(group(doc, "g1")).toMatchObject({ x: 0, y: 30, width: 20, height: 10 });
    expect(outline(doc)).toContain("    group#g1");
    const empty = applyOps(scene(), [{ op: "create", parentId: "f", node: { type: "group", id: "e" } }]).doc;
    expect(lintDocument(empty).find((i) => i.rule === "empty-group")?.nodeId).toBe("e");
  });

  it("renders groups as non-clipping wrappers in HTML, React and the display list", () => {
    const doc0 = scene();
    const doc = applyOps(doc0, [...groupOps(doc0, ["a"], { id: "g" }).ops, { op: "update", id: "g", props: { opacity: 0.5 } }]).doc;
    const html = renderHTML(doc, { rootId: "f" }).html;
    expect(html).toContain('data-paprika-type="group" data-name="Grupo 1" style="box-sizing:border-box;position:absolute;left:40px;top:50px;width:20px;flex-shrink:0;height:10px;opacity:0.5"');
    expect(exportReact(doc, "g")).toContain("<div");
    const boxes = new Map<string, Box>([
      ["f", { x: 0, y: 0, w: 400, h: 300 }],
      ["g", { x: 40, y: 50, w: 20, h: 10 }],
      ["a", { x: 40, y: 50, w: 20, h: 10 }],
    ]);
    const dl = displayList(doc, boxes);
    expect(dl.painted.has("a")).toBe(true);
    expect(dl.painted.has("g")).toBe(false);
    expect(dl.data[25 + 7]).toBeCloseTo(0.5);
  });
});

describe("pages", () => {
  it("the first page wraps the existing canvas, then pages hold every top-level node", () => {
    const doc0 = scene();
    const plan = addPageOps(doc0, { id: "p2", name: "Rascunhos", firstId: "p1" });
    const { doc } = applyOps(doc0, plan.ops);
    expect(doc.rootIds).toEqual(["p1", "p2"]);
    expect(doc.nodes.p1).toMatchObject({ type: "page", name: "Page 1", children: ["f"], parentId: null });
    expect(doc.nodes.f!.parentId).toBe("p1");
    expect(pageRoots(doc)).toEqual(["f"]);
    expect(pageRoots(doc, "p2")).toEqual([]);
    expect(addPageOps(doc).ops).toHaveLength(1);
    expect(outline(doc)).toBe(
      ['page#p1 "Page 1"', '  frame#f "Tela" 400×300 @0,0 fill=#ffffff', "    rect#a 20×10 @40,50 fill=#ff0000", "    ellipse#b 30×30 @100,20 fill=#00ff00", '    text#c 100×20 @10,200 "fora" 16/400 color=#111111', 'page#p2 "Rascunhos"', "content: page=p1 x=0 y=0 w=400 h=300", "next: x=480 y=0"].join("\n"),
    );
  });

  it("enforces where pages and loose nodes can live", () => {
    const paged = applyOps(scene(), addPageOps(scene(), { id: "p2", firstId: "p1" }).ops).doc;
    expect(() => applyOps(paged, [{ op: "create", node: { type: "rect", id: "r" } }])).toThrow(/has pages/);
    expect(() => applyOps(paged, [{ op: "move", id: "f", parentId: null }])).toThrow(/has pages/);
    expect(() => applyOps(paged, [{ op: "create", parentId: "f", node: { type: "page", id: "px" } }])).toThrow(/canvas level/);
    expect(() => applyOps(paged, [{ op: "move", id: "p2", parentId: "p1" }])).toThrow(/canvas level/);
    expect(() => applyOps(paged, [{ op: "create", node: { type: "page", id: "px", x: 1 } }])).toThrow(/unknown fields for page: x/);
    expect(() => applyOps(scene(), [{ op: "create", node: { type: "page", id: "px" } }])).toThrow(/"f" is at the canvas level/);
    expect(() => parseDocument({ ...paged, rootIds: ["p1", "p2", "f"], nodes: { ...paged.nodes, f: { ...paged.nodes.f, parentId: null }, p1: { ...paged.nodes.p1, children: [] } } })).toThrow(
      /every top-level node must be a page/,
    );
    const ok = applyOps(paged, [{ op: "create", parentId: "p2", node: { type: "rect", id: "r", x: 500, y: 600, width: 10, height: 10 } }]).doc;
    expect(canvasBounds(ok, "p2")).toEqual({ x: 500, y: 600, width: 10, height: 10 });
    expect(canvasBounds(ok)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("renders a page as its own canvas with the page background", () => {
    const base = applyOps(scene(), addPageOps(scene(), { id: "p2", firstId: "p1" }).ops).doc;
    const doc = applyOps(base, [
      { op: "update", id: "p2", props: { fill: "#101010" } },
      { op: "create", parentId: "p2", node: { type: "rect", id: "r", x: 500, y: 600, width: 10, height: 10, fill: "#fff" } },
    ]).doc;
    const page = renderHTML(doc, { rootId: "p2" });
    expect(page.bounds).toEqual({ x: 500, y: 600, width: 10, height: 10 });
    expect(page.html).toContain("background:#101010");
    expect(page.html).toContain("left:0px;top:0px");
    const first = renderHTML(doc);
    expect(first.html).toContain('data-paprika-id="f"');
    expect(first.html).not.toContain('data-paprika-id="r"');
    expect(() => exportReact(doc, "p2")).toThrow(/is a page/);
    expect(displayList(doc, new Map([["r", { x: 500, y: 600, w: 10, h: 10 }]]), "p2").painted.has("r")).toBe(true);
  });
});

describe("composite ops inside applyOps", () => {
  it("group/ungroup/add_page expand against the current document, in one undo step", () => {
    const h = new History(scene());
    h.apply([
      { op: "update", id: "a", props: { x: 0 } },
      { op: "group", ids: ["a", "b"], id: "g", name: "Par" },
    ]);
    expect(group(h.doc)).toMatchObject({ x: 0, y: 20, width: 130, name: "Par" });
    h.apply([{ op: "update", id: "g", props: { x: 10 } }, { op: "ungroup", ids: ["g"] }]);
    expect(h.doc.nodes.a).toMatchObject({ x: 10, y: 50, parentId: "f" });
    h.apply([{ op: "add_page", id: "p2", firstId: "p1", name: "Dois" }]);
    expect(h.doc.rootIds).toEqual(["p1", "p2"]);
    h.undo();
    h.undo();
    h.undo();
    expect(h.doc).toEqual(scene());
    expect(() => applyOps(scene(), [{ op: "group", ids: ["a", "f"] }])).toThrow(/^op\[0\]: only nodes with the same parent/);
    expect(() => applyOps(scene(), [{ op: "ungroup", ids: [] }])).toThrow(/ids: Too small/);
  });
});

describe("z-order in one call (update/move with index)", () => {
  const kids = (doc: Document, id = "f") => (doc.nodes[id] as { children: string[] }).children;

  it("update with index reorders inside the current parent (front = top of the stack)", () => {
    expect(kids(applyOps(scene(), [{ op: "update", id: "a", props: { index: "front" } }]).doc)).toEqual(["b", "c", "a"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "c", props: { index: "back" } }]).doc)).toEqual(["c", "a", "b"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "c", props: { index: 0 } }]).doc)).toEqual(["c", "a", "b"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "a", props: { index: 1 } }]).doc)).toEqual(["b", "a", "c"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "a", props: { index: 9 } }]).doc)).toEqual(["b", "c", "a"]);
  });

  it("forward/backward take one step and stop at the ends", () => {
    expect(kids(applyOps(scene(), [{ op: "update", id: "a", props: { index: "forward" } }]).doc)).toEqual(["b", "a", "c"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "c", props: { index: "forward" } }]).doc)).toEqual(["a", "b", "c"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "a", props: { index: "backward" } }]).doc)).toEqual(["a", "b", "c"]);
    expect(kids(applyOps(scene(), [{ op: "update", id: "c", props: { index: "backward" } }]).doc)).toEqual(["a", "c", "b"]);
  });

  it("index + fields in one update is one undo step that restores both", () => {
    const h = new History(scene());
    h.apply([{ op: "update", id: "a", props: { index: "front", fill: "#000000" } }]);
    expect(kids(h.doc)).toEqual(["b", "c", "a"]);
    expect(h.doc.nodes.a).toMatchObject({ fill: "#000000" });
    expect(h.entries().length).toBe(1);
    h.undo();
    expect(h.doc).toEqual(scene());
  });

  it("move accepts the same names, and undo restores the numeric position", () => {
    expect(kids(applyOps(scene(), [{ op: "move", id: "a", parentId: "f", index: "front" }]).doc)).toEqual(["b", "c", "a"]);
    expect(kids(applyOps(scene(), [{ op: "move", id: "c", parentId: "f", index: "backward" }]).doc)).toEqual(["a", "c", "b"]);
    const h = new History(scene());
    h.apply([{ op: "move", id: "a", parentId: "f", index: "back" }]);
    expect(kids(h.doc)).toEqual(["a", "b", "c"]);
    h.apply([{ op: "move", id: "c", parentId: "f", index: "front" }]);
    h.undo();
    expect(h.doc).toEqual(scene());
  });

  it("front/back respect the parent: only that parent's children change", () => {
    const doc0 = applyOps(scene(), [{ op: "group", ids: ["a", "b"], id: "g" }]).doc;
    expect(kids(doc0)).toEqual(["g", "c"]);
    const doc = applyOps(doc0, [{ op: "update", id: "a", props: { index: "front" } }]).doc;
    expect((doc.nodes.g as GroupNode).children).toEqual(["b", "a"]);
    expect(kids(doc)).toEqual(["g", "c"]);
    const doc2 = applyOps(doc0, [{ op: "update", id: "c", props: { index: "back" } }]).doc;
    expect(kids(doc2)).toEqual(["c", "g"]);
    expect((doc2.nodes.g as GroupNode).children).toEqual(["a", "b"]);
  });

  it("pages and root nodes reorder at the canvas level", () => {
    const doc0 = applyOps(scene(), [{ op: "add_page", id: "p2", firstId: "p1", name: "Duas" }]).doc;
    expect(doc0.rootIds).toEqual(["p1", "p2"]);
    const h = new History(doc0);
    h.apply([{ op: "update", id: "p1", props: { index: "front" } }]);
    expect(h.doc.rootIds).toEqual(["p2", "p1"]);
    h.undo();
    expect(h.doc.rootIds).toEqual(["p1", "p2"]);
  });

  it("rejects an index that is not a position with an actionable error", () => {
    expect(() => applyOps(scene(), [{ op: "update", id: "a", props: { index: "up" } }])).toThrow(
      /^op\[0\]: props\.index must be a number \(0 is the back\) or "front", "back", "forward" or "backward" \(got "up"\)/,
    );
    expect(() => applyOps(scene(), [{ op: "update", id: "a", props: { index: -1 } }])).toThrow(/\(got -1\)/);
    expect(() => applyOps(scene(), [{ op: "update", id: "a", props: { index: 1.5 } }])).toThrow(/^op\[0\]: props\.index/);
    expect(() => applyOps(scene(), [{ op: "move", id: "a", parentId: "f", index: "up" }])).toThrow(/invalid operation/);
  });
});

function themedBoard(): Document {
  return applyOps(createDocument("T", "d"), [
    { op: "set_tokens", tokens: { bg: "#ffffff", fg: "#1e2336", line: "#c43d27" } },
    { op: "set_tokens", mode: "dark", tokens: { bg: "#14161f", fg: "#f2f2f2", line: "#ff8a75" } },
    {
      op: "create",
      node: {
        type: "frame",
        id: "board",
        name: "Board",
        x: 0,
        y: 0,
        width: 320,
        height: 120,
        fill: "$bg",
        layout: { mode: "column", gap: 8, padding: 16 },
        children: [
          { type: "text", id: "title", text: "Hello", color: "$fg", fontSize: 24, width: "fill", height: "hug" },
          { type: "rect", id: "bar", width: "fill", height: 4, fill: "$line" },
        ],
      },
    },
  ]).doc;
}

function diagramBoard(): Document {
  return applyOps(createDocument("T", "d"), [
    {
      op: "create",
      node: {
        type: "frame",
        id: "flow",
        x: 100,
        y: 50,
        width: 400,
        height: 200,
        children: [
          { type: "shape", id: "a", x: 20, y: 20, width: 80, height: 40, text: "A" },
          { type: "shape", id: "b", x: 200, y: 120, width: 80, height: 40, text: "B" },
          { type: "connector", id: "ab", from: { nodeId: "a" }, to: { nodeId: "b" } },
          { type: "connector", id: "free", from: { nodeId: "a" }, to: { x: 350, y: 20 } },
        ],
      },
    },
    { op: "create", node: { type: "shape", id: "out", x: 600, y: 50, width: 80, height: 40, text: "Out" } },
    { op: "create", node: { type: "connector", id: "outer", from: { nodeId: "b" }, to: { nodeId: "out" } } },
  ]).doc;
}

describe("duplicate_nodes", () => {
  it("copies a board beside the original when offset is omitted", () => {
    const doc0 = themedBoard();
    const plan = duplicateOps(doc0, ["board"]);
    const { doc } = applyOps(doc0, plan.ops);
    const copy = doc.nodes[plan.copies[0]!] as NodeT & { children: string[] };
    expect(plan.copies).toHaveLength(1);
    expect(copy).toMatchObject({ type: "frame", name: "Board", x: 400, y: 0, width: 320, height: 120, fill: "$bg" });
    expect(copy.children).toHaveLength(2);
    expect(copy.children).not.toContain("title");
    expect(Object.keys(plan.map).sort()).toEqual(["bar", "board", "title"]);
    expect(doc.nodes[plan.map.title!]).toMatchObject({ text: "Hello", color: "$fg", parentId: copy.id });
    expect(doc.rootIds).toEqual(["board", copy.id]);
  });

  it("makes the light/dark pair: mode in props, offset beside the original, lint clean on both", () => {
    const doc0 = themedBoard();
    expect(lintDocument(doc0)).toEqual([]);
    const plan = duplicateOps(doc0, ["board"], { offset: 360, props: { mode: "dark", name: "Board dark" } });
    const { doc } = applyOps(doc0, plan.ops);
    const copy = doc.nodes[plan.copies[0]!]!;
    expect(copy).toMatchObject({ mode: "dark", name: "Board dark", x: 360, y: 360 });
    expect(lintDocument(doc, { rootId: "board" })).toEqual([]);
    expect(lintDocument(doc, { rootId: copy.id })).toEqual([]);
    expect(lintDocument(doc)).toEqual([]);
  });

  it("is one undo step", () => {
    const h = new History(themedBoard());
    const plan = duplicateOps(h.doc, ["board", "board"], { props: { mode: "dark" } });
    h.apply(plan.ops, { label: "duplicate" });
    expect(h.doc.rootIds).toHaveLength(2);
    h.undo();
    expect(h.doc.rootIds).toEqual(["board"]);
    expect(Object.keys(h.doc.nodes).sort()).toEqual(["bar", "board", "title"]);
  });

  it("scale multiplies sizes, text, strokes and layout; root keeps its corner plus the offset", () => {
    const doc0 = applyOps(themedBoard(), [{ op: "update", id: "board", props: { x: 100, y: 10, radius: 8, stroke: { color: "#000000", width: 2 } } }]).doc;
    const plan = duplicateOps(doc0, ["board"], { scale: 2, offset: 0 });
    const { doc } = applyOps(doc0, plan.ops);
    expect(doc.nodes[plan.copies[0]!]).toMatchObject({
      x: 100,
      y: 10,
      width: 640,
      height: 240,
      radius: 16,
      stroke: { width: 4 },
      layout: { gap: 16, padding: 32 },
    });
    expect(doc.nodes[plan.map.title!]).toMatchObject({ fontSize: 48, width: "fill", height: "hug" });
    expect(doc.nodes[plan.map.bar!]).toMatchObject({ height: 8, width: "fill" });
  });

  it("an instance stays an instance of the same component and scale multiplies", () => {
    const doc0 = applyOps(themedBoard(), [
      { op: "update", id: "board", props: { component: true } },
      { op: "create", node: { type: "frame", id: "inst", instanceOf: "board", x: 500, y: 0, scale: 1.5 } },
    ]).doc;
    const plan = duplicateOps(doc0, ["inst"], { scale: 2 });
    const { doc } = applyOps(doc0, plan.ops);
    const copy = doc.nodes[plan.copies[0]!]!;
    expect(copy).toMatchObject({ instanceOf: "board", scale: 3, x: 1060, y: 0, width: 960 });
    expect(copy.component).toBeUndefined();
    expect(Object.keys(plan.map)).toEqual(["inst"]);
    expect(Object.values(doc.nodes).filter((n) => n.sourceId === "title")).toHaveLength(2);
  });

  it("re-points connectors between duplicated nodes and leaves the others where they were", () => {
    const doc0 = diagramBoard();
    const plan = duplicateOps(doc0, ["flow"], { scale: 2 });
    const { doc } = applyOps(doc0, plan.ops);
    const kid = (id: string) => doc.nodes[plan.map[id]!] as NodeT & Record<string, any>;
    expect(kid("ab").from.nodeId).toBe(plan.map.a);
    expect(kid("ab").to.nodeId).toBe(plan.map.b);
    expect(kid("free").to).toEqual({ x: 700, y: 40 });
    expect(doc.nodes.ab).toMatchObject({ from: { nodeId: "a" }, to: { nodeId: "b" } });

    const alone = duplicateOps(doc0, ["outer"], { offset: 10 });
    const result = applyOps(doc0, alone.ops).doc;
    expect(result.nodes[alone.copies[0]!]).toMatchObject({ from: { nodeId: "b" }, to: { nodeId: "out" } });

    const both = duplicateOps(doc0, ["flow", "out", "outer"]);
    const pair = applyOps(doc0, both.ops).doc;
    expect(pair.nodes[both.map.outer!]).toMatchObject({ from: { nodeId: both.map.b }, to: { nodeId: both.map.out } });
  });

  it("a node and its descendant are copied once, inside the ancestor's copy", () => {
    const doc0 = themedBoard();
    const plan = duplicateOps(doc0, ["board", "title"]);
    expect(plan.copies).toHaveLength(1);
    expect(Object.keys(plan.map).sort()).toEqual(["bar", "board", "title"]);
  });

  it("duplicates a group without carrying its derived box", () => {
    const doc0 = applyOps(scene(), [{ op: "group", ids: ["a", "b"], id: "g" }]).doc;
    const plan = duplicateOps(doc0, ["g"], { scale: 2, offset: 0 });
    const { doc } = applyOps(doc0, plan.ops);
    const g = doc.nodes[plan.copies[0]!] as GroupNode;
    expect(g).toMatchObject({ type: "group", x: 40, y: 20, width: 180, height: 80 });
    expect(g.children).toHaveLength(2);
  });

  it("parentId moves the copies to another parent or to the canvas", () => {
    const doc0 = scene();
    const out = applyOps(doc0, duplicateOps(doc0, ["a"], { parentId: null, offset: 0 }).ops).doc;
    expect(out.rootIds).toHaveLength(2);
    const into = duplicateOps(doc0, ["a"], { parentId: "f" });
    expect(applyOps(doc0, into.ops).doc.nodes[into.copies[0]!]).toMatchObject({ parentId: "f", x: 140, y: 50 });
  });

  it("refuses with an actionable error", () => {
    const doc0 = applyOps(themedBoard(), [
      { op: "update", id: "board", props: { component: true } },
      { op: "create", node: { type: "frame", id: "inst", instanceOf: "board" } },
    ]).doc;
    const copyOfTitle = Object.values(doc0.nodes).find((n) => n.sourceId === "title")!.id;
    expect(() => duplicateOps(doc0, [])).toThrow("pass at least one id to duplicate");
    expect(() => duplicateOps(doc0, ["board", "zz", "yy"])).toThrow("nodes do not exist: zz, yy");
    expect(() => duplicateOps(doc0, [copyOfTitle])).toThrow(/is a copy inside the instance "inst"; duplicate the instance instead/);
    expect(() => duplicateOps(doc0, ["board"], { scale: 0 })).toThrow("scale must be a number above 0");
    expect(() => duplicateOps(doc0, ["board"], { offset: Number.NaN })).toThrow("offset must be a finite number");
    expect(() => duplicateOps(doc0, ["board"], { props: { id: "x", children: [] } })).toThrow(
      "props cannot set id, children: the copy keeps those from its source",
    );
    const paged = applyOps(scene(), [{ op: "add_page", id: "p2", firstId: "p1" }]).doc;
    expect(() => duplicateOps(paged, ["p1"])).toThrow(/is a page; duplicate the frames on it instead/);
  });
});

describe("align, distribute, wrap and reveal", () => {
  it("aligns to the selection box in one undo, including rotation", () => {
    const h = new History(scene());
    h.apply([{ op: "align", ids: ["b", "a"], edge: "left" }]);
    expect(h.doc.nodes.a).toMatchObject({ x: 40 });
    expect(h.doc.nodes.b).toMatchObject({ x: 40, y: 20 });
    h.undo();
    expect(h.doc.nodes.b).toMatchObject({ x: 100, y: 20 });
    const turned = applyOps(scene(), [{ op: "update", id: "a", props: { rotation: 90 } }]).doc;
    const { doc } = applyOps(turned, alignOps(turned, ["a", "b"], "top").ops);
    expect(doc.nodes.a).toMatchObject({ y: 25 });
    expect(doc.nodes.b).toMatchObject({ y: 20 });
  });

  it("distributes with equal gaps and keeps the outer edges", () => {
    const doc0 = applyOps(scene(), [{ op: "create", parentId: "f", node: { type: "rect", id: "d", x: 200, y: 10, width: 20, height: 10, fill: "#000" } }]).doc;
    const { doc } = applyOps(doc0, distributeOps(doc0, ["a", "d", "b"], "horizontal").ops);
    expect(doc.nodes.a).toMatchObject({ x: 40 });
    expect(doc.nodes.b).toMatchObject({ x: 115 });
    expect(doc.nodes.d).toMatchObject({ x: 200 });
    expect(() => distributeOps(doc0, ["a", "b"], "horizontal")).toThrow("pass at least 3 ids to distribute");
  });

  it("wraps siblings in a frame without moving the drawing, one undo", () => {
    const h = new History(scene());
    h.apply(wrapOps(h.doc, ["b", "a"], { id: "wf", name: "Caixa" }).ops);
    const frame = h.doc.nodes.wf as FrameNode;
    expect(frame).toMatchObject({ type: "frame", parentId: "f", x: 40, y: 20, width: 90, height: 40, fill: "transparent", clip: false, name: "Caixa" });
    expect(frame.children).toEqual(["a", "b"]);
    expect(h.doc.nodes.a).toMatchObject({ x: 0, y: 30, parentId: "wf" });
    expect(h.doc.nodes.b).toMatchObject({ x: 60, y: 0, parentId: "wf" });
    expect((h.doc.nodes.f as FrameNode).children).toEqual(["wf", "c"]);
    h.undo();
    expect(h.doc.nodes.a).toMatchObject({ x: 40, y: 50, parentId: "f" });
    expect(h.doc.nodes.wf).toBeUndefined();
  });

  it("shows and unlocks the page in one step and leaves the other page", () => {
    const doc0 = applyOps(scene(), [
      { op: "add_page", id: "p2", firstId: "p1" },
      { op: "create", parentId: "p2", node: { type: "rect", id: "h", x: 0, y: 0, width: 10, height: 10, visible: false, locked: true } },
      { op: "update", id: "a", props: { visible: false, locked: true } },
    ]).doc;
    const hidden = revealOps(doc0, "hidden", "p1");
    expect(hidden.ids).toEqual(["a"]);
    const shown = applyOps(doc0, [{ op: "reveal", kind: "hidden", pageId: "p1" }]).doc;
    expect(shown.nodes.a).toMatchObject({ visible: true, locked: true });
    expect(shown.nodes.h).toMatchObject({ visible: false, locked: true });
    const unlocked = applyOps(shown, [{ op: "reveal", kind: "locked" }]).doc;
    expect(unlocked.nodes.a).toMatchObject({ locked: false });
    expect(unlocked.nodes.h).toMatchObject({ locked: false });
    expect(revealOps(unlocked, "locked").ids).toEqual([]);
  });

  it("refuses flow parents, connectors and short selections", () => {
    const doc0 = applyOps(scene(), [{ op: "update", id: "f", props: { layout: { mode: "row", gap: 0, padding: 0 } } }]).doc;
    expect(() => alignOps(doc0, ["a", "b"], "left")).toThrow(/cannot be aligned/);
    expect(() => alignOps(scene(), ["a"], "left")).toThrow("pass at least 2 ids to align");
    const withArrow = applyOps(scene(), [
      { op: "create", parentId: "f", node: { type: "connector", id: "k", from: { nodeId: "a" }, to: { nodeId: "b" } } },
    ]).doc;
    expect(() => wrapOps(withArrow, ["a", "k"])).toThrow(/connector/);
  });
});
