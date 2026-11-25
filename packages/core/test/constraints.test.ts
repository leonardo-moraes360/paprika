import { describe, expect, it } from "vitest";
import { applyOps, createDocument, History, layout, type Node } from "../src/index.js";

function resize(doc: ReturnType<typeof createDocument>, id: string, width: number, height: number) {
  return applyOps(doc, [{ op: "update", id, props: { width, height } }]).doc;
}

describe("constraints when the parent resizes", () => {
  it("keeps left and top, pins right and bottom, centers, and scales", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 200,
          height: 100,
          children: [
            { type: "rect", id: "stay", x: 10, y: 8, width: 20, height: 10 },
            { type: "rect", id: "pin", x: 140, y: 70, width: 40, height: 16, constraints: { horizontal: "right", vertical: "bottom" } },
            { type: "rect", id: "mid", x: 80, y: 40, width: 20, height: 10, constraints: { horizontal: "center", vertical: "center" } },
            { type: "rect", id: "grow", x: 20, y: 10, width: 40, height: 20, constraints: { horizontal: "scale", vertical: "scale" } },
          ],
        },
      },
    ]);
    const next = resize(doc, "board", 400, 160);
    expect(next.nodes.stay).toMatchObject({ x: 10, y: 8, width: 20, height: 10 });
    expect(next.nodes.pin).toMatchObject({ x: 340, y: 130, width: 40, height: 16 });
    expect(next.nodes.mid).toMatchObject({ x: 180, y: 70, width: 20, height: 10 });
    expect(next.nodes.grow).toMatchObject({ x: 40, y: 16, width: 80, height: 32 });
  });

  it("leaves a flow child and moves an absolute one", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "row",
          width: 200,
          height: 80,
          layout: { mode: "row", gap: 8, padding: 0 },
          children: [
            { type: "rect", id: "flow", x: 5, y: 5, width: 40, height: 20, constraints: { horizontal: "right" } },
            { type: "rect", id: "abs", x: 150, y: 12, width: 16, height: 16, layoutPositioning: "absolute", constraints: { horizontal: "right", vertical: "top" } },
          ],
        },
      },
    ]);
    const next = resize(doc, "row", 280, 80);
    expect(next.nodes.flow).toMatchObject({ x: 5, y: 5, width: 40 });
    expect(next.nodes.abs).toMatchObject({ x: 230, y: 12, width: 16 });
  });

  it("applies a nested frame's own constraints after it scales", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 100,
          height: 100,
          children: [
            {
              type: "frame",
              id: "inner",
              x: 10,
              y: 10,
              width: 40,
              height: 40,
              constraints: { horizontal: "scale", vertical: "scale" },
              children: [
                { type: "rect", id: "dot", x: 4, y: 4, width: 10, height: 10, constraints: { horizontal: "right", vertical: "bottom" } },
              ],
            },
          ],
        },
      },
    ]);
    const next = resize(doc, "board", 200, 200);
    expect(next.nodes.inner).toMatchObject({ x: 20, y: 20, width: 80, height: 80 });
    expect(next.nodes.dot).toMatchObject({ x: 44, y: 44, width: 10, height: 10 });
  });

  it("scales a group's children and lets fitGroups follow", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 100,
          height: 100,
          children: [
            {
              type: "group",
              id: "g",
              constraints: { horizontal: "scale", vertical: "scale" },
              children: [{ type: "rect", id: "r", x: 0, y: 0, width: 20, height: 10 }],
            },
          ],
        },
      },
    ]);
    const next = resize(doc, "board", 200, 200);
    expect(next.nodes.g).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
    expect(next.nodes.r).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
    expect(layout(next).r).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
  });

  it("scales position of a hug child and keeps hug", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 100,
          height: 40,
          children: [{ type: "text", id: "t", x: 10, y: 4, text: "Oi", constraints: { horizontal: "scale", vertical: "top" } }],
        },
      },
    ]);
    const next = resize(doc, "board", 200, 40);
    const text = next.nodes.t as Extract<Node, { type: "text" }>;
    expect(text.x).toBe(20);
    expect(text.width).toBe("hug");
    expect(text.height).toBe("hug");
  });

  it("uses the post-update box when the child also moves in the transaction", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 100,
          height: 40,
          children: [{ type: "rect", id: "r", x: 10, y: 0, width: 20, height: 10, constraints: { horizontal: "right" } }],
        },
      },
    ]);
    const next = applyOps(doc, [
      { op: "update", id: "r", props: { x: 30 } },
      { op: "update", id: "board", props: { width: 180 } },
    ]).doc;
    expect(next.nodes.r).toMatchObject({ x: 110, width: 20 });
  });

  it("rejects an unknown constraint and clears back to the default", () => {
    expect(() =>
      applyOps(createDocument("t", "d"), [{ op: "create", node: { type: "rect", id: "r", constraints: { horizontal: "stretch" } } }]),
    ).toThrow(/constraints/);
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 80,
          height: 40,
          children: [{ type: "rect", id: "r", x: 4, y: 4, width: 10, height: 10, constraints: { horizontal: "right" } }],
        },
      },
    ]);
    const cleared = applyOps(doc, [{ op: "update", id: "r", props: { constraints: null } }]).doc;
    expect(cleared.nodes.r).not.toHaveProperty("constraints");
    const next = resize(cleared, "board", 120, 40);
    expect(next.nodes.r).toMatchObject({ x: 4 });
  });

  it("undo and redo restore both the parent and the pinned child", () => {
    const history = new History(createDocument("t", "d"));
    history.apply([
      {
        op: "create",
        node: {
          type: "frame",
          id: "board",
          width: 100,
          height: 50,
          children: [{ type: "rect", id: "r", x: 60, y: 8, width: 20, height: 10, constraints: { horizontal: "right", vertical: "center" } }],
        },
      },
    ]);
    history.apply([{ op: "update", id: "board", props: { width: 160, height: 90 } }]);
    expect(history.doc.nodes.r).toMatchObject({ x: 120, y: 28 });
    history.undo();
    expect(history.doc.nodes.board).toMatchObject({ width: 100, height: 50 });
    expect(history.doc.nodes.r).toMatchObject({ x: 60, y: 8 });
    history.redo();
    expect(history.doc.nodes.board).toMatchObject({ width: 160, height: 90 });
    expect(history.doc.nodes.r).toMatchObject({ x: 120, y: 28 });
  });

  it("copies the pinned position into an instance", () => {
    const { doc } = applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "btn",
          component: true,
          width: 100,
          height: 40,
          children: [{ type: "rect", id: "dot", x: 70, y: 10, width: 16, height: 16, constraints: { horizontal: "right", vertical: "top" } }],
        },
      },
      { op: "create", node: { type: "frame", id: "i1", instanceOf: "btn", x: 0, y: 80 } },
    ]);
    const next = applyOps(doc, [{ op: "update", id: "btn", props: { width: 160 } }]).doc;
    expect(next.nodes.dot).toMatchObject({ x: 130 });
    const copy = Object.values(next.nodes).find((n) => n.type === "rect" && "sourceId" in n && n.sourceId === "dot");
    expect(copy).toMatchObject({ x: 130, width: 16 });
  });
});

describe("constraints reach fill frames nested in a resized ancestor", () => {
  const base = () =>
    applyOps(createDocument("t", "d"), [
      {
        op: "create",
        node: {
          type: "frame",
          id: "root",
          width: 1440,
          height: 200,
          layout: { mode: "column", gap: 0, padding: 0 },
          children: [
            { type: "rect", id: "pin-root", x: 1380, y: 0, width: 40, height: 10, layoutPositioning: "absolute", constraints: { horizontal: "right" } },
            {
              type: "frame",
              id: "header",
              width: "fill",
              height: 60,
              children: [
                { type: "rect", id: "pin-header", x: 1380, y: 10, width: 40, height: 20, constraints: { horizontal: "right" } },
                { type: "rect", id: "mid-header", x: 700, y: 10, width: 40, height: 20, constraints: { horizontal: "center" } },
                { type: "rect", id: "left-header", x: 20, y: 10, width: 40, height: 20 },
              ],
            },
            {
              type: "frame",
              id: "row",
              width: "fill",
              height: 60,
              layout: { mode: "row", gap: 0, padding: 0 },
              children: [
                { type: "frame", id: "a", width: "fill", height: 60, children: [{ type: "rect", id: "pin-a", x: 700, y: 0, width: 10, height: 10, constraints: { horizontal: "right" } }] },
                { type: "frame", id: "b", width: "fill", height: 60 },
              ],
            },
          ],
        },
      },
    ]).doc;

  it("moves a right-pinned child of a fill frame in a column by the full width delta", () => {
    const next = resize(base(), "root", 1640, 200);
    expect(next.nodes["pin-root"]).toMatchObject({ x: 1580 });
    expect(next.nodes["pin-header"]).toMatchObject({ x: 1580, y: 10 });
    expect(next.nodes["mid-header"]).toMatchObject({ x: 800 });
    expect(next.nodes["left-header"]).toMatchObject({ x: 20 });
  });

  it("gives a fill frame in a row only its share of the free space", () => {
    const next = resize(base(), "root", 1640, 200);
    expect(next.nodes["pin-a"]).toMatchObject({ x: 800 });
    expect(layout(next).a?.width).toBe(820);
  });

  it("leaves everything alone when the layout size does not change", () => {
    const next = applyOps(base(), [{ op: "update", id: "left-header", props: { x: 30 } }]).doc;
    expect(next.nodes["pin-header"]).toMatchObject({ x: 1380 });
  });
});
