import type { Document, Node } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { makeDocument } from "@/test/live-harness";
import { affectsPanel, panelInput } from "./properties";

const doc = makeDocument(200, { perFrame: 10 });
const ids = Object.keys(doc.nodes);
const rectA = ids.find((id) => id.startsWith("n")) as string;
const rectB = ids.filter((id) => id.startsWith("n"))[1] as string;
const farRect = ids.filter((id) => id.startsWith("n")).at(-1) as string;
const parentOf = (d: Document, id: string) => d.nodes[id]?.parentId as string;

/** What a delta does: a new document and a new `nodes` map, the touched node replaced, every other node the same reference. */
const patch = (from: Document, id: string, props: Record<string, unknown>): Document => ({ ...from, nodes: { ...from.nodes, [id]: { ...from.nodes[id], ...props } as Node } });
const patchMany = (from: Document, patches: [string, Record<string, unknown>][]) => patches.reduce((d, [id, props]) => patch(d, id, props), from);

describe("panelInput: what the panel is handed", () => {
  it("has no document, no node and no selection before the document arrives", () => {
    const input = panelInput(null, null, ["x"]);
    expect(input).toEqual({ doc: null, node: null, selected: [] });
    expect(panelInput(input, null, [])).toBe(input);
  });

  it("selects the last id as the primary node and drops ids that are not in the document", () => {
    const input = panelInput(null, doc, [rectA, "ghost", rectB]);
    expect(input.selected).toEqual([rectA, rectB]);
    expect(input.node).toBe(doc.nodes[rectB]);
  });

  it("keeps the same input for the same document and selection, and the same selected array for an equal selection", () => {
    const first = panelInput(null, doc, [rectA]);
    expect(panelInput(first, doc, [rectA])).toBe(first);
    const moved = panelInput(first, patch(doc, farRect, { x: 9 }), [rectA]);
    expect(moved).toBe(first);
  });

  it("a new selection is a new input and sees the CURRENT document, even after skipped deltas", () => {
    const first = panelInput(null, doc, [rectA]);
    const changed = patch(doc, farRect, { x: 777 });
    expect(panelInput(first, changed, [rectA])).toBe(first);
    const next = panelInput(first, changed, [farRect]);
    expect(next).not.toBe(first);
    expect((next.node as { x: number }).x).toBe(777);
  });

  it("an id that arrives later (an ack before its delta) joins the selection when the node shows up", () => {
    const first = panelInput(null, doc, [rectA, "later"]);
    expect(first.selected).toEqual([rectA]);
    const created = { ...doc, nodes: { ...doc.nodes, later: { ...(doc.nodes[rectA] as Node), id: "later" } as Node } };
    const next = panelInput(first, created, [rectA, "later"]);
    expect(next.selected).toEqual([rectA, "later"]);
  });

  it("a deleted selected node leaves the selection", () => {
    const first = panelInput(null, doc, [rectA]);
    const nodes = { ...doc.nodes };
    delete nodes[rectA];
    const next = panelInput(first, { ...doc, nodes }, [rectA]);
    expect(next.selected).toEqual([]);
    expect(next.node).toBeNull();
  });

  it("a snapshot of another workspace replaces the input", () => {
    const first = panelInput(null, doc, [rectA]);
    const other = makeDocument(200, { id: "other", perFrame: 10 });
    expect(panelInput(first, other, [rectA]).doc).toBe(other);
  });
});

describe("affectsPanel: which deltas reach the panel", () => {
  const selected = [rectA];

  it("ignores a node that is not selected, not an ancestor and not something the selection points at", () => {
    expect(affectsPanel(doc, patch(doc, farRect, { fill: "#000000" }), selected)).toBe(false);
    expect(affectsPanel(doc, patch(doc, rectB, { x: 1 }), selected)).toBe(false);
  });

  it("sees the selected node, its parent frame, its page and the document-level fields", () => {
    expect(affectsPanel(doc, patch(doc, rectA, { x: 1 }), selected)).toBe(true);
    expect(affectsPanel(doc, patch(doc, parentOf(doc, rectA), { name: "F" }), selected)).toBe(true);
    expect(affectsPanel(doc, patch(doc, parentOf(doc, parentOf(doc, rectA)), { name: "P" }), selected)).toBe(true);
    expect(affectsPanel(doc, { ...doc, name: "Renamed" }, selected)).toBe(true);
    expect(affectsPanel(doc, { ...doc, tokens: { a: 1 } as Document["tokens"] }, [])).toBe(true);
  });

  it("with nothing selected only the document-level fields matter", () => {
    expect(affectsPanel(doc, patch(doc, rectA, { x: 1 }), [])).toBe(false);
  });

  it("follows what a node points at: the component of an instance and its subtree, the ends of a connector, the source of a copy", () => {
    const component = ids.find((id) => id.startsWith("frame-"))!;
    const inner = (doc.nodes[component] as { children: string[] }).children[0] as string;
    const withInstance = patchMany(doc, [[rectB, { instanceOf: component }]]);
    expect(affectsPanel(withInstance, patch(withInstance, component, { name: "C" }), [rectB])).toBe(true);
    expect(affectsPanel(withInstance, patch(withInstance, inner, { name: "inner" }), [rectB])).toBe(true);
    expect(affectsPanel(withInstance, patch(withInstance, farRect, { name: "x" }), [rectB])).toBe(false);
    const withConnector = patchMany(doc, [[rectB, { type: "connector", from: { nodeId: rectA }, to: { nodeId: farRect } }]]);
    expect(affectsPanel(withConnector, patch(withConnector, farRect, { x: 5 }), [rectB])).toBe(true);
    expect(affectsPanel(withConnector, patch(withConnector, ids.filter((id) => id.startsWith("n"))[5] as string, { x: 5 }), [rectB])).toBe(false);
    const copy = patchMany(doc, [[rectB, { sourceId: rectA }]]);
    expect(affectsPanel(copy, patch(copy, rectA, { x: 5 }), [rectB])).toBe(true);
  });

  it("sees a created or deleted selected node", () => {
    const nodes = { ...doc.nodes };
    delete nodes[farRect];
    expect(affectsPanel(doc, { ...doc, nodes }, [farRect])).toBe(true);
    expect(affectsPanel(doc, { ...doc, nodes }, [rectA])).toBe(false);
  });
});
