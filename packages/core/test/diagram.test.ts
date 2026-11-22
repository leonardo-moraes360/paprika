import { describe, expect, it } from "vitest";
import {
  History,
  applyOps,
  copyId,
  createDocument,
  diagramOps,
  exportReact,
  exportSVG,
  lintDocument,
  outline,
  renderHTML,
  shapeOutline,
  type ConnectorNode,
  type Document,
  type Op,
} from "../src/index.js";

const two = (extra: Op[] = []): Document =>
  applyOps(createDocument("T", "d"), [
    { op: "create", node: { type: "shape", id: "a", x: 0, y: 0, text: "A" } },
    { op: "create", node: { type: "shape", id: "b", x: 300, y: 0, shape: "ellipse", text: "B" } },
    { op: "create", node: { type: "connector", id: "c", from: { nodeId: "a" }, to: { nodeId: "b" } } },
    ...extra,
  ]).doc;
const conn = (d: Document, id = "c") => d.nodes[id] as ConnectorNode;

describe("shape", () => {
  it("fills in the defaults of each kind on create", () => {
    const d = applyOps(createDocument(), [
      { op: "create", node: { type: "shape", id: "r" } },
      { op: "create", node: { type: "shape", id: "n", shape: "note" } },
      { op: "create", node: { type: "shape", id: "x", shape: "diamond", fill: "#000000", width: 90 } },
    ]).doc;
    expect(d.nodes.r).toMatchObject({ width: 160, height: 80, fill: "#ffffff", stroke: { color: "#1e2336", width: 2 }, radius: 8, textAlign: "center" });
    expect(d.nodes.n).toMatchObject({ width: 160, height: 160, fill: "#ffe8a3", textAlign: "left" });
    expect(d.nodes.n).not.toHaveProperty("stroke");
    expect(d.nodes.x).toMatchObject({ width: 90, fill: "#000000", stroke: { width: 2 } });
  });

  it("rejects hug/fill sizes and unknown kinds", () => {
    expect(() => applyOps(createDocument(), [{ op: "create", node: { type: "shape", id: "s", width: "hug" } }])).toThrow(/width/);
    expect(() => applyOps(createDocument(), [{ op: "create", node: { type: "shape", id: "s", shape: "star" } }])).toThrow(/shape/);
  });

  it("outlines keep the stroke inside the box", () => {
    expect(shapeOutline({ shape: "diamond", width: 100, height: 60, radius: 0, stroke: { color: "#000", width: 2 } }).d).toBe("M50 1 L99 30 L50 59 L1 30 Z");
    expect(shapeOutline({ shape: "triangle", width: 100, height: 60, radius: 0, stroke: { color: "#000", width: 2 } }).d).toBe("M50 1 L99 59 L1 59 Z");
    const note = shapeOutline({ shape: "note", width: 100, height: 100, radius: 0 });
    expect(note.fold).toBe("M76 0 L76 24 L100 24 Z");
  });

  it("outlines honor stroke position center and outside", () => {
    expect(shapeOutline({ shape: "diamond", width: 100, height: 60, radius: 0, stroke: { color: "#000", width: 2, position: "center" } }).d).toBe(
      "M50 0 L100 30 L50 60 L0 30 Z",
    );
    expect(shapeOutline({ shape: "diamond", width: 100, height: 60, radius: 0, stroke: { color: "#000", width: 2, position: "outside" } }).d).toBe(
      "M50 -1 L101 30 L50 61 L-1 30 Z",
    );
  });

  it("clips connectors to a triangle outline like a diamond", () => {
    const d = applyOps(createDocument("T", "d"), [
      { op: "create", node: { type: "shape", id: "t", x: 0, y: 0, width: 160, height: 80, shape: "triangle", text: "A" } },
      { op: "create", node: { type: "shape", id: "b", x: 300, y: 0, shape: "ellipse", text: "B" } },
      { op: "create", node: { type: "connector", id: "c", from: { nodeId: "t" }, to: { nodeId: "b" }, route: "straight" } },
    ]).doc;
    const c = d.nodes.c as ConnectorNode;
    expect(c.d.startsWith("M")).toBe(true);
    expect(c.x).toBeGreaterThan(0);
    const plan = diagramOps(d, {
      nodes: [{ id: "q", text: "?", shape: "triangle" }, { id: "y", text: "Yes" }],
      edges: [{ from: "q", to: "y" }],
    });
    expect(plan.nodes).toEqual(["q", "y"]);
    expect(plan.ops[0]).toMatchObject({ node: { type: "shape", shape: "triangle" } });
  });

  it("renders the outline behind the text in HTML, React and SVG", () => {
    const d = two();
    const html = renderHTML(d, { rootId: "a" }).html;
    expect(html).toContain('data-paprika-type="shape"');
    expect(html).toMatch(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="160" height="80" style="position:absolute;left:0;top:0;overflow:visible"><path d="M/);
    expect(html).toContain('<div style="position:relative;width:100%">A</div>');
    expect(exportReact(d, "a")).toContain("<path d=");
    expect(exportSVG(d).svg).toContain('<tspan x="80" y="44.8">A</tspan>');
  });
});

describe("connector", () => {
  it("is routed from outline to outline when created", () => {
    const c = conn(two());
    // a: rect 0..160 × 0..80, centre (80,40); b: ellipse 300..460, centre (380,40)
    expect(c.d.startsWith("M")).toBe(true);
    expect(c.x).toBe(158);
    expect(c.width).toBe(144);
    expect(c.d).toBe("M2 8 L142 8 M130 14 L142 8 L130 2");
  });

  it("follows a shape when it moves (and undo puts it back)", () => {
    const h = new History(two());
    const before = conn(h.doc).d;
    h.apply([{ op: "update", id: "b", props: { x: 300, y: 300 } }], "u", "");
    expect(conn(h.doc).d).not.toBe(before);
    expect(conn(h.doc).height).toBeGreaterThan(200);
    h.undo();
    expect(conn(h.doc).d).toBe(before);
  });

  it("elbow routes leave and enter by the sides", () => {
    const d = two([{ op: "update", id: "c", props: { route: "elbow" } }, { op: "update", id: "b", props: { y: 200 } }]);
    const c = conn(d);
    expect(c.d.split(" M")[0]).toBe("M2 2 L72 2 L72 202 L142 202");
    const sided = applyOps(d, [{ op: "update", id: "c", props: { from: { nodeId: "a", side: "bottom" }, to: { nodeId: "b", side: "top" } } }]).doc;
    expect(conn(sided).d.split(" M")[0]).toBe("M2 2 L2 62 L302 62 L302 122");
  });

  it("free ends use the parent's coordinates; arrows on both ends", () => {
    const d = applyOps(createDocument(), [
      { op: "create", node: { type: "frame", id: "f", x: 100, y: 100, width: 400, height: 300 } },
      { op: "create", parentId: "f", node: { type: "connector", id: "c", from: { x: 10, y: 10 }, to: { x: 110, y: 10 }, startArrow: "arrow", dashed: true } },
    ]).doc;
    const c = conn(d);
    expect([c.x, c.y]).toEqual([8, 2]);
    expect(c.d.match(/M/g)).toHaveLength(3);
    expect(renderHTML(d).html).toContain('stroke-dasharray="6 5"');
  });

  it("keeps its geometry derived", () => {
    expect(() => applyOps(two(), [{ op: "update", id: "c", props: { x: 1 } }])).toThrow(/follow its ends/);
    expect(() => applyOps(createDocument(), [{ op: "create", node: { type: "connector", id: "c", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, d: "M0 0" } }])).toThrow(/follow its ends/);
  });

  it("rejects ends that cannot be resolved", () => {
    const bad = (from: object, to: object = { x: 0, y: 0 }) => () =>
      applyOps(two(), [{ op: "create", node: { type: "connector", id: "z", from, to } }]);
    expect(bad({ nodeId: "nope" })).toThrow('connector "z": from.nodeId "nope" does not exist');
    expect(bad({ x: 1 })).toThrow("from needs a nodeId (attached end) or both x and y (free end)");
    expect(bad({ nodeId: "z" })).toThrow("cannot be the connector itself");
    expect(bad({ nodeId: "c" })).toThrow('is a connector');
    expect(bad({ nodeId: "a", side: "middle" })).toThrow(/side/);
  });

  it("is deleted with the shape it is attached to, and comes back on undo", () => {
    const h = new History(two());
    h.apply([{ op: "delete", id: "a" }], "u", "");
    expect(h.doc.nodes.c).toBeUndefined();
    h.undo();
    expect(Object.keys(h.doc.nodes).sort()).toEqual(["a", "b", "c"]);
    expect(h.doc.rootIds).toEqual(["a", "b", "c"]);
  });

  it("deleting a shape and its connector together is fine, deleting twice is not", () => {
    expect(applyOps(two(), [{ op: "delete", id: "a" }, { op: "delete", id: "c" }]).doc.nodes).not.toHaveProperty("c");
    expect(() => applyOps(two(), [{ op: "delete", id: "a" }, { op: "delete", id: "c" }, { op: "delete", id: "c" }])).toThrow('node "c" does not exist');
    expect(() => applyOps(two(), [{ op: "delete", id: "c" }, { op: "delete", id: "c" }])).toThrow('node "c" does not exist');
  });

  it("inside a component attaches to the copies of each instance", () => {
    const d = applyOps(createDocument(), [
      {
        op: "create",
        node: {
          type: "frame", id: "comp", component: true, width: 300, height: 100,
          children: [
            { type: "shape", id: "s1", x: 0, y: 0, width: 60, height: 40 },
            { type: "shape", id: "s2", x: 200, y: 0, width: 60, height: 40 },
            { type: "connector", id: "k", from: { nodeId: "s1" }, to: { nodeId: "s2" } },
          ],
        },
      },
      { op: "create", node: { type: "frame", id: "i", instanceOf: "comp", x: 0, y: 200, scale: 2 } },
    ]).doc;
    const k = d.nodes[copyId("i", "k")] as ConnectorNode;
    expect(k.from.nodeId).toBe(copyId("i", "s1"));
    expect(k.to.nodeId).toBe(copyId("i", "s2"));
    expect(k.width).toBeGreaterThan(conn(d, "k").width);
  });

  it("does not count in its group's box", () => {
    const d = applyOps(two(), [{ op: "group", ids: ["a", "c"], id: "g" }]).doc;
    expect(d.nodes.g).toMatchObject({ x: 0, y: 0, width: 160, height: 80 });
  });
});

describe("diagramOps", () => {
  it("lays out new shapes in layers and connects them", () => {
    const doc = createDocument();
    const plan = diagramOps(doc, {
      nodes: [{ id: "s", text: "Start", shape: "ellipse" }, { id: "q", text: "?", shape: "diamond" }, { id: "y", text: "Yes" }, { id: "n", text: "No" }],
      edges: [{ from: "s", to: "q" }, { from: "q", to: "y" }, { from: "q", to: "n" }, { from: "n", to: "q" }],
    });
    expect(plan.edges).toEqual(["s-to-q", "q-to-y", "q-to-n", "n-to-q"]);
    const d = applyOps(doc, plan.ops).doc;
    expect(outline(d).split("\n").slice(0, 4)).toEqual([
      'shape#s 160×80 @112,0 fill=#ffffff ellipse "Start"',
      'shape#q 160×80 @112,144 fill=#ffffff diamond "?"',
      'shape#y 160×80 @0,288 fill=#ffffff rect "Yes"',
      'shape#n 160×80 @224,288 fill=#ffffff rect "No"',
    ]);
    expect(conn(d, "s-to-q").route).toBe("elbow");
    expect(lintDocument(d)).toEqual([]);
  });

  it("goes to the right of existing content, into the first page", () => {
    let d = applyOps(createDocument(), [{ op: "add_page", id: "p" }]).doc;
    d = applyOps(d, [{ op: "create", parentId: "p", node: { type: "rect", id: "r", x: 10, y: 20, width: 100, height: 50 } }]).doc;
    const plan = diagramOps(d, { direction: "right", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "r", id: "custom" }] });
    expect(plan.ops.every((o) => o.parentId === "p")).toBe(true);
    const out = applyOps(d, plan.ops).doc;
    expect(out.nodes.a).toMatchObject({ x: 190, y: 20 });
    expect(out.nodes.b).toMatchObject({ x: 414, y: 20 });
    expect(out.nodes.custom?.type).toBe("connector");
  });

  it("explains bad input", () => {
    const d = two();
    expect(() => diagramOps(d, { nodes: [] })).toThrow("pass at least one node or edge");
    expect(() => diagramOps(d, { nodes: [{ id: "a" }] })).toThrow('id "a" already exists');
    expect(() => diagramOps(d, { nodes: [{ id: "x" }, { id: "x" }] })).toThrow("repeated");
    expect(() => diagramOps(d, { nodes: [{ id: "x" }], edges: [{ from: "x", to: "zz" }] })).toThrow('edges[0]: "zz"');
    expect(() => diagramOps(d, { parentId: "a", nodes: [{ id: "x" }] })).toThrow("only frame, group and page");
  });
});

describe("connector labels (fb#57)", () => {
  it("connectorMidpoint walks the line by length and ignores the arrowheads", async () => {
    const { connectorMidpoint } = await import("../src/index.js");
    expect(connectorMidpoint("M116 2 L116 30 L8 30 L8 58 M2 46 L8 58 L14 46")).toEqual({ x: 62, y: 30 });
    expect(connectorMidpoint("M0 0 L10 0")).toEqual({ x: 5, y: 0 });
    expect(connectorMidpoint("")).toBeNull();
  });

  it("a label is drawn halfway along the route with a halo of the background, in every export", () => {
    const d0 = applyOps(createDocument("T", "d"), [
      { op: "create", node: { type: "frame", id: "f", width: 400, height: 300, fill: "#fbf8f4", children: [] } },
    ]).doc;
    const plan = diagramOps(d0, {
      parentId: "f",
      nodes: [{ id: "a", text: "A", x: 0, y: 0 }, { id: "b", text: "B", x: 0, y: 200 }],
      edges: [{ from: "a", to: "b", route: "straight", label: "sim <ok>" }],
    });
    const doc = applyOps(d0, plan.ops).doc;
    const c = doc.nodes["a-to-b"] as ConnectorNode;
    expect(c.label).toBe("sim <ok>");
    expect(outline(doc)).toContain('label="sim <ok>"');
    const html = renderHTML(doc, { rootId: "f" }).html;
    expect(html).toMatch(/<text [^>]*stroke="#fbf8f4"[^>]*paint-order="stroke"[^>]*>sim &lt;ok&gt;<\/text>/);
    expect(exportReact(doc, "f")).toContain('{"sim <ok>"}</text>');
    const { svg } = exportSVG(doc, "f");
    expect(svg).toContain(">sim &lt;ok&gt;</text>");
    // Without a label nothing changes.
    const plain = applyOps(doc, [{ op: "update", id: "a-to-b", props: { label: null } }]).doc;
    expect(renderHTML(plain, { rootId: "f" }).html).not.toContain("<text");
  });
});
