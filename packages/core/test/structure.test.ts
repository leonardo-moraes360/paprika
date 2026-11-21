import { describe, expect, it } from "vitest";
import {
  History,
  addPageOps,
  applyOps,
  canvasBounds,
  createDocument,
  displayList,
  exportReact,
  groupOps,
  lintDocument,
  nodeStyle,
  outline,
  pageRoots,
  parseDocument,
  renderHTML,
  ungroupOps,
  type Box,
  type Document,
  type GroupNode,
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
    expect(g.children).toEqual(["a", "b"]); // sibling order, not argument order
    expect((doc.nodes.f as { children: string[] }).children).toEqual(["g", "c"]);
    expect(doc.nodes.a).toMatchObject({ x: 0, y: 30 });
    expect(doc.nodes.b).toMatchObject({ x: 60, y: 0 });
    // Same pixels: the HTML of the frame has the children at the same absolute spot.
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
    // 20×10 rotated 90° around its center (50,55) covers 45..55 × 45..65.
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
    // rect "a" inherits the group opacity (entry 1 after the frame clip push).
    expect(dl.data[25 + 7]).toBeCloseTo(0.5);
  });
});

describe("pages", () => {
  it("the first page wraps the existing canvas, then pages hold every top-level node", () => {
    const doc0 = scene();
    const plan = addPageOps(doc0, { id: "p2", name: "Rascunhos", firstId: "p1" });
    const { doc } = applyOps(doc0, plan.ops);
    expect(doc.rootIds).toEqual(["p1", "p2"]);
    expect(doc.nodes.p1).toMatchObject({ type: "page", name: "Página 1", children: ["f"], parentId: null });
    expect(doc.nodes.f!.parentId).toBe("p1");
    expect(pageRoots(doc)).toEqual(["f"]);
    expect(pageRoots(doc, "p2")).toEqual([]);
    expect(addPageOps(doc).ops).toHaveLength(1);
    expect(outline(doc)).toBe(
      ['page#p1 "Página 1"', '  frame#f "Tela" 400×300 @0,0 fill=#ffffff', "    rect#a 20×10 @40,50 fill=#ff0000", "    ellipse#b 30×30 @100,20 fill=#00ff00", '    text#c 100×20 @10,200 "fora" 16/400 color=#111111', 'page#p2 "Rascunhos"'].join("\n"),
    );
  });

  it("enforces where pages and loose nodes can live", () => {
    const paged = applyOps(scene(), addPageOps(scene(), { id: "p2", firstId: "p1" }).ops).doc;
    expect(() => applyOps(paged, [{ op: "create", node: { type: "rect", id: "r" } }])).toThrow(/has pages/);
    expect(() => applyOps(paged, [{ op: "move", id: "f", parentId: null }])).toThrow(/has pages/);
    expect(() => applyOps(paged, [{ op: "create", parentId: "f", node: { type: "page", id: "px" } }])).toThrow(/canvas level/);
    expect(() => applyOps(paged, [{ op: "move", id: "p2", parentId: "p1" }])).toThrow(/canvas level/);
    expect(() => applyOps(paged, [{ op: "create", node: { type: "page", id: "px", x: 1 } }])).toThrow(/unknown fields for page: x/);
    // Mixed top level created in one transaction is caught at the end.
    expect(() => applyOps(scene(), [{ op: "create", node: { type: "page", id: "px" } }])).toThrow(/"f" is at the canvas level/);
    expect(() => parseDocument({ ...paged, rootIds: ["p1", "p2", "f"], nodes: { ...paged.nodes, f: { ...paged.nodes.f, parentId: null }, p1: { ...paged.nodes.p1, children: [] } } })).toThrow(
      /every top-level node must be a page/,
    );
    // Creating on a page works and the page is a valid parent.
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
    // Without a root: the first page, white.
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
    // A move in the same transaction, before the group: the plan sees the moved node.
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
