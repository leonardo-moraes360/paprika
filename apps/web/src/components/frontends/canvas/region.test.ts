import { applyOps, createDocument, type Document, type Op } from "@paprika/core";
import { createStore } from "@tanstack/react-store";
import { describe, expect, it } from "vitest";
import { canvasActions, createNodeSlices, EDITING, HOVERED, initialCanvasState, SELECTED, type CanvasActions, type CanvasState } from "./region";

const NODES = 5000;
const doc = (): Document =>
  applyOps(createDocument("T", "d"), [
    { op: "add_page", id: "page", name: "P" },
    { op: "create", parentId: "page", node: { type: "frame", id: "fr", name: "Fr", x: 0, y: 0, width: 300, height: 300 } },
    { op: "create", parentId: "fr", node: { type: "shape", id: "a", name: "A", x: 0, y: 0, width: 100, height: 50, text: "A", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "b", name: "B", x: 500, y: 0, width: 100, height: 50, text: "B", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "c", from: { nodeId: "a" }, to: { nodeId: "b" }, route: "elbow" } },
    ...Array.from({ length: NODES }, (_, i) => ({ op: "create", parentId: "page", node: { type: "rect", id: `n${i}`, name: `N${i}`, x: i, y: 0, width: 10, height: 10 } })),
  ] as unknown as Op[]).doc;

/** Every node of the page listens, and answers when told, as `useSyncExternalStore` does: the cost a write has is what this counts. */
function setup() {
  const store = createStore<CanvasState, CanvasActions>(initialCanvasState(), canvasActions);
  const d = doc();
  const slices = createNodeSlices(store, () => d);
  const told = new Map<string, number>();
  const ids = [...Object.keys(d.nodes).filter((id) => id !== "page")];
  for (const id of ids) {
    slices.read(id, d.nodes[id]);
    slices.subscribe(id, () => {
      told.set(id, (told.get(id) ?? 0) + 1);
      slices.read(id, d.nodes[id]);
    });
  }
  const mark = () => {
    told.clear();
    return slices.evaluations();
  };
  return { store, slices, told, mark, d };
}

describe("per-node slices of the canvas state", () => {
  it("with 5 000 nodes, changing the hover tells two nodes and computes two slices", () => {
    const { store, slices, told, mark } = setup();
    store.actions.setHovered("n10");
    const base = mark();
    store.actions.setHovered("n11");
    expect([...told.keys()].sort()).toEqual(["n10", "n11"]);
    expect(slices.evaluations() - base).toBe(2);
    expect(slices.read("n11", undefined).flags & HOVERED).toBe(HOVERED);
    const again = mark();
    store.actions.setHovered(null);
    expect(told.size).toBe(1);
    expect(slices.evaluations() - again).toBe(1);
  });

  it("a write that changes nothing tells nobody", () => {
    const { store, told, mark, slices } = setup();
    store.actions.setHovered("n1");
    const base = mark();
    store.actions.setHovered("n1");
    store.actions.setTool("select");
    store.actions.setPreview({});
    expect(told.size).toBe(0);
    expect(slices.evaluations()).toBe(base);
  });

  it("selecting tells the nodes that enter and leave the selection, and only them", () => {
    const { store, told, mark } = setup();
    store.actions.setSelection(["n1", "n2"]);
    mark();
    store.actions.setSelection(["n2", "n3"]);
    expect([...told.keys()].sort()).toEqual(["n1", "n3"]);
  });

  it("a preview tells the nodes whose patch changed, by key, not the others", () => {
    const { store, slices, told, mark } = setup();
    store.actions.setPreview({ n5: { x: 1 }, n6: { x: 1 } });
    mark();
    store.actions.setPreview({ n5: { x: 2 }, n6: { x: 1 } });
    expect([...told.keys()]).toEqual(["n5"]);
    expect(slices.read("n5", undefined).patch).toEqual({ x: 2 });
    mark();
    store.actions.clearPreview();
    expect([...told.keys()].sort()).toEqual(["n5", "n6"]);
  });

  it("a connector is told when a node it follows is previewed (an end, or the end's ancestor), and a bystander is not", () => {
    const { store, slices, told, mark, d } = setup();
    mark();
    store.actions.setPreview({ fr: { x: 40 } });
    expect([...told.keys()].sort()).toEqual(["c", "fr"]);
    expect(slices.read("c", d.nodes.c).linked).toEqual(["fr", { x: 40 }]);
    mark();
    store.actions.setPreview({ n7: { x: 9 } });
    expect([...told.keys()]).toEqual(["n7"]);
  });

  it("the edited node is told when the editor opens and closes", () => {
    const { store, slices, told, mark } = setup();
    mark();
    store.actions.setEditing("n9");
    expect([...told.keys()]).toEqual(["n9"]);
    expect(slices.read("n9", undefined).flags & EDITING).toBe(EDITING);
    store.actions.setSelection(["n9"]);
    expect(slices.read("n9", undefined).flags & SELECTED).toBe(SELECTED);
  });

  it("a slice is the same object while its answer does not change, and nothing listens after the last node leaves", () => {
    const store = createStore<CanvasState, CanvasActions>(initialCanvasState(), canvasActions);
    const d = doc();
    const slices = createNodeSlices(store, () => d);
    const first = slices.read("n1", undefined);
    store.actions.setHovered("n2");
    expect(slices.read("n1", undefined)).toBe(first);
    let calls = 0;
    const stop = slices.subscribe("n1", () => (calls += 1));
    store.actions.setHovered("n1");
    expect(calls).toBe(1);
    stop();
    store.actions.setHovered("n2");
    expect(calls).toBe(1);
  });
});
