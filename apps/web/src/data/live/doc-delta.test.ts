import { describe, expect, it } from "vitest";
import { deltaMessage, makeDocument } from "@/test/live-harness";
import { applyDelta, changedBetween } from "./doc-delta";

const doc = makeDocument(200, { id: "d" });
const nodeIds = Object.keys(doc.nodes);
const target = nodeIds[10] as string;
const other = nodeIds[11] as string;

describe("applyDelta (copy on write)", () => {
  it("keeps the reference of every node the delta does not touch", () => {
    const next = applyDelta(doc, deltaMessage(doc, 2, { nodes: { set: { [target]: { ...doc.nodes[target], name: "renamed" } as never } } })).doc;
    expect(next.nodes[target]).not.toBe(doc.nodes[target]);
    expect((next.nodes[target] as { name: string }).name).toBe("renamed");
    let same = 0;
    for (const id of nodeIds) if (id !== target && next.nodes[id] === doc.nodes[id]) same += 1;
    expect(same).toBe(nodeIds.length - 1);
    expect(next.nodes[other]).toBe(doc.nodes[other]);
  });

  it("copies the document and the nodes map, and leaves the other maps and the previous document alone", () => {
    const withTokens = { ...doc, tokens: { brand: "#fff" } } as typeof doc;
    const before = JSON.stringify(withTokens);
    const next = applyDelta(withTokens, deltaMessage(withTokens, 2, { nodes: { set: { [target]: { ...withTokens.nodes[target], x: 9 } as never } } })).doc;
    expect(next).not.toBe(withTokens);
    expect(next.nodes).not.toBe(withTokens.nodes);
    expect(next.tokens).toBe(withTokens.tokens);
    expect(next.rootIds).toBe(withTokens.rootIds);
    expect(JSON.stringify(withTokens)).toBe(before);
  });

  it("reports the ids it set, and which of them are new", () => {
    const fresh = { ...doc.nodes[target], id: "fresh" } as never;
    const result = applyDelta(doc, deltaMessage(doc, 2, { nodes: { set: { [target]: doc.nodes[target] as never, fresh } } }));
    expect(result.changed).toEqual([target, "fresh"]);
    expect(result.created).toEqual(["fresh"]);
    expect(result.doc.nodes.fresh).toBe(fresh);
  });

  it("deletes ids, replaces rootIds and name, patches the other maps", () => {
    const rootIds = ["x"];
    const result = applyDelta(doc, deltaMessage(doc, 2, { nodes: { del: [target, "missing"] }, rootIds, name: "N", tokens: { set: { a: 1 } }, assets: { set: { logo: "data:" } } })).doc;
    expect(target in result.nodes).toBe(false);
    expect(target in doc.nodes).toBe(true);
    expect(result.rootIds).toBe(rootIds);
    expect(result.name).toBe("N");
    expect(result.tokens).toEqual({ a: 1 });
    expect(result.assets).toEqual({ logo: "data:" });
  });

  it("copies each map once for a whole batch when it is given the same owned set", () => {
    const owned = new Set<object>();
    const first = applyDelta(doc, deltaMessage(doc, 2, { nodes: { set: { [target]: { ...doc.nodes[target], x: 1 } as never } } }), owned).doc;
    const second = applyDelta(first, deltaMessage(doc, 3, { nodes: { set: { [other]: { ...doc.nodes[other], x: 2 } as never } } }), owned).doc;
    expect(second).toBe(first);
    expect(second.nodes).toBe(first.nodes);
    expect((second.nodes[target] as { x: number }).x).toBe(1);
    expect((second.nodes[other] as { x: number }).x).toBe(2);
    expect(doc.nodes[other]).not.toBe(second.nodes[other]);
  });

  it("copies again for a new batch (the document of the previous batch is immutable)", () => {
    const first = applyDelta(doc, deltaMessage(doc, 2, { name: "A" })).doc;
    const second = applyDelta(first, deltaMessage(doc, 3, { name: "B" })).doc;
    expect(second).not.toBe(first);
    expect(first.name).toBe("A");
  });

  it("does not let a key named __proto__ change the prototype", () => {
    const result = applyDelta(doc, JSON.parse('{"type":"delta","id":"d","version":2,"base":1,"actor":"a","label":"","kind":"ops","canUndo":true,"canRedo":false,"nodes":{"set":{"__proto__":{"id":"p"}}}}')).doc;
    expect(Object.getPrototypeOf(result.nodes)).toBe(Object.prototype);
    expect(Object.hasOwn(result.nodes, "__proto__")).toBe(true);
  });
});

describe("changedBetween", () => {
  it("lists nodes whose content differs and ignores equal copies", () => {
    const copy = JSON.parse(JSON.stringify(doc)) as typeof doc;
    (copy.nodes[target] as { x: number }).x = 77;
    expect(changedBetween(doc, copy)).toEqual([target]);
    expect(changedBetween(null, copy)).toEqual([]);
  });
});
