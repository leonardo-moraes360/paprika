import { describe, expect, it } from "vitest";
import {
  applyOps,
  createDocument,
  duplicateOps,
  lintDocument,
  outline,
  placementSummary,
  type Document,
} from "../src/index.js";

function frame(id: string, x: number | undefined, y: number | undefined, w = 200, h = 100, name = id) {
  const node: Record<string, unknown> = { type: "frame", id, name, width: w, height: h, fill: "#ffffff" };
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
  return node;
}

function docWith(nodes: Record<string, unknown>[]): Document {
  return applyOps(createDocument("T", "d"), nodes.map((node) => ({ op: "create" as const, node }))).doc;
}

describe("placement", () => {
  it("puts top-level frames with no x/y in a row, then wraps", () => {
    const doc = applyOps(createDocument("T", "d"), [
      { op: "create", place: "free", node: frame("a", undefined, undefined, 200, 100) },
      { op: "create", place: "free", node: frame("b", undefined, undefined, 200, 100) },
      { op: "create", place: "free", node: frame("c", undefined, undefined, 2200, 100) },
    ]).doc;
    expect(doc.nodes.a).toMatchObject({ x: 0, y: 0 });
    expect(doc.nodes.b).toMatchObject({ x: 280, y: 0 });
    expect(doc.nodes.c).toMatchObject({ x: 0, y: 180 });
    const sum = placementSummary(doc);
    expect(sum.content).toMatchObject({ x: 0, y: 0, w: 2200, h: 280 });
    expect(sum.next).toEqual({ x: 2280, y: 0 });
    expect(outline(doc)).toContain("content: x=0 y=0 w=2200 h=280");
    expect(outline(doc)).toContain("next: x=2280 y=0");
  });

  it("keeps explicit x/y and warns through lint when boards overlap", () => {
    const doc = applyOps(createDocument("T", "d"), [
      { op: "create", node: frame("light", 0, 0, 400, 300, "Light") },
      { op: "create", place: "none", node: frame("dark", 40, 40, 400, 300, "Dark") },
    ]).doc;
    expect(doc.nodes.dark).toMatchObject({ x: 40, y: 40 });
    const hit = lintDocument(doc).filter((i) => i.rule === "overlapping-boards");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ nodeId: "dark" });
    expect(hit[0]!.message).toContain('overlaps "Light"');
    expect(hit[0]!.message).toContain("nearest free spot is 0,380");
  });

  it("flags text painted above an opaque modal", () => {
    const doc = applyOps(createDocument("T", "d"), [
      {
        op: "create",
        node: {
          type: "frame", id: "card", name: "Card", x: 0, y: 0, width: 220, height: 140, fill: "#f4f1ea",
          children: [{ type: "text", id: "label", x: 16, y: 16, width: 120, height: 24, text: "Landing page", color: "#111111" }],
        },
      },
      { op: "create", node: { type: "frame", id: "modal", name: "Delete", x: 8, y: 8, width: 200, height: 100, fill: "#ffffff" } },
      { op: "update", id: "modal", props: { index: "back" } },
    ]).doc;
    const covered = lintDocument(doc).filter((i) => i.rule === "covered-by-overlay");
    expect(covered.map((i) => i.nodeId)).toEqual(["label"]);
    expect(covered[0]!.message).toContain('opaque frame "Delete"');
    expect(covered[0]!.message).toContain('index: "front"');
    const overlap = lintDocument(doc).filter((i) => i.rule === "overlapping-boards");
    expect(overlap.map((i) => i.nodeId)).toEqual(["card"]);
  });

  it("lands a dark duplicate beside the original", () => {
    const base = docWith([frame("board", 0, 0, 320, 120, "Board")]);
    const plan = duplicateOps(base, ["board"], { props: { mode: "dark", name: "Board dark" } });
    const doc = applyOps(base, plan.ops).doc;
    expect(doc.nodes[plan.copies[0]!]).toMatchObject({ mode: "dark", name: "Board dark", x: 400, y: 0 });
  });

  it("place free on a paged document uses the page that holds the content", () => {
    const base = applyOps(createDocument("T", "d"), [
      { op: "create", node: { type: "page", id: "p1", name: "Página 1" } },
      { op: "create", parentId: "p1", node: frame("board", 0, 0, 300, 200, "Board") },
      { op: "create", node: { type: "page", id: "p2", name: "Empty" } },
    ]).doc;
    const doc = applyOps(base, [{ op: "create", place: "free", node: frame("next", undefined, undefined, 100, 80, "Next") }]).doc;
    expect(doc.nodes.next).toMatchObject({ parentId: "p1", x: 380, y: 0 });
    expect(doc.rootIds).toEqual(["p1", "p2"]);
    expect(placementSummary(doc).pageId).toBe("p1");
  });

  it("places below, right and beside a node", () => {
    const base = docWith([frame("board", 10, 20, 100, 50, "Board")]);
    const below = applyOps(base, [{ op: "create", place: "below", node: frame("u", undefined, undefined, 40, 40) }]).doc;
    expect(below.nodes.u).toMatchObject({ x: 10, y: 150 });
    const right = applyOps(base, [{ op: "create", place: "right", node: frame("r", undefined, undefined, 40, 40) }]).doc;
    expect(right.nodes.r).toMatchObject({ x: 190, y: 20 });
    const near = applyOps(base, [{ op: "create", place: { near: "board", side: "above" }, node: frame("a", undefined, undefined, 40, 30) }]).doc;
    expect(near.nodes.a).toMatchObject({ x: 10, y: -90 });
  });
});
