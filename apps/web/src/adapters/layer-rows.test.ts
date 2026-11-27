import type { Document } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { makeDocument } from "@/test/live-harness";
import { createLayerRowsCache, deriveLayerRows, layerLabel, moveOps, resolveLayerSelection } from "./layer-rows";

const none = new Set<string>();
const noAgents = new Map<string, { name: string; tone: "agent-1" }>();

const edit = (doc: Document, id: string, props: Record<string, unknown>): Document => ({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...props } as never } });

/** page > A(frame) > [a1, a2], B(frame) > [b1], C(rect) */
function tree(): Document {
  const n = (id: string, type: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), type, parentId, visible: true, locked: false, x: 0, y: 0, width: 10, height: 10, ...extra });
  const nodes = {
    p: n("p", "page", null, { children: ["A", "B", "C"] }),
    A: n("A", "frame", "p", { children: ["a1", "a2"] }),
    a1: n("a1", "rect", "A"),
    a2: n("a2", "text", "A", { text: "hello", name: "" }),
    B: n("B", "frame", "p", { children: ["b1"] }),
    b1: n("b1", "rect", "B"),
    C: n("C", "rect", "p"),
  };
  return { format: "paprika/1", id: "d", name: "d", tokens: {}, rootIds: ["p"], nodes } as unknown as Document;
}

describe("deriveLayerRows", () => {
  it("lists the page in tree order with level, kind, flags and the label of an unnamed text", () => {
    const rows = deriveLayerRows(createLayerRowsCache(), tree(), "p", none, noAgents);
    expect(rows.map((r) => [r.id, r.level, r.kind, r.hasChildren])).toEqual([
      ["A", 0, "frame", true],
      ["a1", 1, "rect", false],
      ["a2", 1, "text", false],
      ["B", 0, "frame", true],
      ["b1", 1, "rect", false],
      ["C", 0, "rect", false],
    ]);
    expect(rows[2]?.name).toBe("hello");
    expect(rows[0]).toMatchObject({ visible: true, locked: false, selected: false, renamable: true, lockable: true, container: true, dropTarget: true });
  });

  it("marks the selection and the agent touching a layer", () => {
    const rows = deriveLayerRows(createLayerRowsCache(), tree(), "p", new Set(["a1"]), new Map([["B", { name: "claude", tone: "agent-2" as never }]]));
    expect(rows.find((r) => r.id === "a1")?.selected).toBe(true);
    expect(rows.find((r) => r.id === "B")?.agent).toEqual({ name: "claude", tone: "agent-2" });
    expect(rows.find((r) => r.id === "A")?.selected).toBe(false);
  });

  it("without pages the layers under the root are the rows; another page shows another list", () => {
    const doc = tree();
    const two = { ...doc, rootIds: ["p", "q"], nodes: { ...doc.nodes, q: { id: "q", type: "page", name: "Q", parentId: null, children: ["z"] }, z: { id: "z", type: "rect", name: "Z", parentId: "q", visible: true, locked: false } } } as unknown as Document;
    const cache = createLayerRowsCache();
    expect(deriveLayerRows(cache, two, "q", none, noAgents).map((r) => r.id)).toEqual(["z"]);
    expect(deriveLayerRows(cache, two, "p", none, noAgents)).toHaveLength(6);
    const flat = { ...doc, rootIds: ["C"], nodes: { C: { ...doc.nodes.C, parentId: null } } } as unknown as Document;
    expect(deriveLayerRows(createLayerRowsCache(), flat, null, none, noAgents).map((r) => r.id)).toEqual(["C"]);
  });

  it("returns the SAME array and rows when a node changed in something no row shows (its position)", () => {
    const doc = tree();
    const cache = createLayerRowsCache();
    const first = deriveLayerRows(cache, doc, "p", none, noAgents);
    const moved = edit(doc, "a1", { x: 99 });
    const second = deriveLayerRows(cache, moved, "p", none, noAgents);
    expect(second).toBe(first);
  });

  it("a rename gives a new array with ONE new row object", () => {
    const doc = tree();
    const cache = createLayerRowsCache();
    const first = deriveLayerRows(cache, doc, "p", none, noAgents);
    const second = deriveLayerRows(cache, edit(doc, "a1", { name: "Renamed" }), "p", none, noAgents);
    expect(second).not.toBe(first);
    const fresh = second.filter((row, i) => row !== first[i]);
    expect(fresh.map((r) => r.id)).toEqual(["a1"]);
    expect(fresh[0]?.name).toBe("Renamed");
  });

  it("a selection change renews only the rows that gained or lost it", () => {
    const doc = tree();
    const cache = createLayerRowsCache();
    const first = deriveLayerRows(cache, doc, "p", new Set(["a1"]), noAgents);
    const second = deriveLayerRows(cache, doc, "p", new Set(["b1"]), noAgents);
    expect(second.filter((row, i) => row !== first[i]).map((r) => r.id)).toEqual(["a1", "b1"]);
  });

  it("a layer that appears or leaves changes the array; the other rows keep their objects", () => {
    const doc = tree();
    const cache = createLayerRowsCache();
    const first = deriveLayerRows(cache, doc, "p", none, noAgents);
    const without = { ...doc, nodes: { ...doc.nodes, B: { ...doc.nodes.B, children: [] } } } as unknown as Document;
    const second = deriveLayerRows(cache, without, "p", none, noAgents);
    expect(second.map((r) => r.id)).toEqual(["A", "a1", "a2", "B", "C"]);
    expect(second.find((r) => r.id === "a1")).toBe(first.find((r) => r.id === "a1"));
    expect(second.find((r) => r.id === "B")?.hasChildren).toBe(false);
  });

  it("an instance's copies cannot be locked, dragged into or renamed", () => {
    const doc = tree();
    const inst = { ...doc, nodes: { ...doc.nodes, B: { ...doc.nodes.B, instanceOf: "A" }, b1: { ...doc.nodes.b1, sourceId: "a1" } } } as unknown as Document;
    const rows = deriveLayerRows(createLayerRowsCache(), inst, "p", none, noAgents);
    expect(rows.find((r) => r.id === "B")).toMatchObject({ kind: "instance", container: false });
    expect(rows.find((r) => r.id === "b1")).toMatchObject({ lockable: false, renamable: false, draggable: false, dropTarget: false });
  });

  it("names a connector by its ends and follows the name of an end", () => {
    const doc = tree();
    const withConn = { ...doc, nodes: { ...doc.nodes, p: { ...doc.nodes.p, children: [...(doc.nodes.p as { children: string[] }).children, "k"] }, k: { id: "k", type: "connector", name: "", parentId: "p", visible: true, locked: false, from: { nodeId: "A" }, to: { nodeId: "C" } } } } as unknown as Document;
    const cache = createLayerRowsCache();
    expect(deriveLayerRows(cache, withConn, "p", none, noAgents).at(-1)?.name).toBe("A → C");
    expect(layerLabel(edit(withConn, "C", { name: "Cee" }), withConn.nodes.k as never)).toBe("A → Cee");
    expect(deriveLayerRows(cache, edit(withConn, "C", { name: "Cee" }), "p", none, noAgents).at(-1)?.name).toBe("A → Cee");
  });

  it("with 5 000 nodes a one-node rename touches one row object", () => {
    const doc = makeDocument(5000);
    const cache = createLayerRowsCache();
    const first = deriveLayerRows(cache, doc, "page-0", none, noAgents);
    expect(first.length).toBeGreaterThan(4900);
    const target = first[2500]?.id as string;
    const second = deriveLayerRows(cache, edit(doc, target, { name: "X" }), "page-0", none, noAgents);
    expect(second.filter((row, i) => row !== first[i])).toHaveLength(1);
  });
});

describe("moveOps", () => {
  const ids = (ops: ReturnType<typeof moveOps>) => ops.map((o) => (o.op === "move" ? [o.id, o.parentId, o.index] : o));

  it("before and after a sibling: the index counts the siblings without the moved layer", () => {
    const doc = tree();
    expect(ids(moveOps(doc, { ids: ["C"], targetId: "A", position: "before" }))).toEqual([["C", "p", 0]]);
    expect(ids(moveOps(doc, { ids: ["A"], targetId: "C", position: "after" }))).toEqual([["A", "p", 2]]);
    expect(ids(moveOps(doc, { ids: ["A"], targetId: "B", position: "after" }))).toEqual([["A", "p", 1]]);
  });

  it("a move to where it already is gives no op", () => {
    expect(moveOps(tree(), { ids: ["A"], targetId: "B", position: "before" })).toEqual([]);
  });

  it("inside goes to the end of the container's children, across parents", () => {
    expect(ids(moveOps(tree(), { ids: ["C"], targetId: "A", position: "inside" }))).toEqual([["C", "A", 2]]);
    expect(ids(moveOps(tree(), { ids: ["b1"], targetId: "A", position: "before" }))).toEqual([["b1", "p", 0]]);
  });

  it("several layers keep their order after a target", () => {
    const ops = moveOps(tree(), { ids: ["a1", "a2"], targetId: "C", position: "after" });
    expect(ids(ops)).toEqual([["a1", "p", 3], ["a2", "p", 4]]);
    const before = moveOps(tree(), { ids: ["a1", "a2"], targetId: "C", position: "before" });
    expect(ids(before)).toEqual([["a1", "p", 2], ["a2", "p", 3]]);
  });

  it("never moves a layer into itself or its descendants, nor a locked layer, a copy or a connector", () => {
    const doc = tree();
    expect(moveOps(doc, { ids: ["A"], targetId: "a1", position: "inside" })).toEqual([]);
    expect(moveOps(doc, { ids: ["A"], targetId: "A", position: "before" })).toEqual([]);
    expect(moveOps(edit(doc, "C", { locked: true }), { ids: ["C"], targetId: "A", position: "before" })).toEqual([]);
    expect(moveOps(edit(doc, "C", { sourceId: "x" }), { ids: ["C"], targetId: "A", position: "before" })).toEqual([]);
  });
});

describe("resolveLayerSelection", () => {
  it("a plain click selects only the clicked layer, whether the tree added or removed it", () => {
    expect(resolveLayerSelection(["a", "b"], ["a", "b", "c"], "replace")).toEqual(["c"]);
    expect(resolveLayerSelection(["a", "b"], ["b"], "replace")).toEqual(["a"]);
    expect(resolveLayerSelection(["a"], [], "replace")).toEqual(["a"]);
    expect(resolveLayerSelection([], ["a"], "replace")).toEqual(["a"]);
    expect(resolveLayerSelection(["a", "b"], ["c"], "replace")).toEqual(["c"]);
  });

  it("Ctrl and Shift take the list as it comes", () => {
    expect(resolveLayerSelection(["a"], ["a", "b"], "toggle")).toEqual(["a", "b"]);
    expect(resolveLayerSelection(["a"], ["a", "b", "c"], "extend")).toEqual(["a", "b", "c"]);
  });
});
