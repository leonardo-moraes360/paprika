import { applyOps, createDocument, type ConnectorNode, type Document, type Op } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { hasContentPatch, linkedPatches, NO_LINKS, routedConnector, sameLinked, withPatch } from "./preview-node";

const doc = (): Document =>
  applyOps(createDocument("T", "d"), [
    { op: "add_page", id: "page", name: "P" },
    { op: "create", parentId: "page", node: { type: "frame", id: "fr", name: "Fr", x: 0, y: 0, width: 300, height: 300 } },
    { op: "create", parentId: "fr", node: { type: "shape", id: "a", name: "A", x: 0, y: 0, width: 100, height: 50, text: "A", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "b", name: "B", x: 500, y: 0, width: 100, height: 50, text: "B", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "z", name: "Z", x: 900, y: 900, width: 10, height: 10, text: "Z", shape: "rect" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "c", from: { nodeId: "a" }, to: { nodeId: "b" }, route: "elbow" } },
  ] as unknown as Op[]).doc;

describe("preview-node", () => {
  it("withPatch lays the patch over a copy; the node is untouched", () => {
    const d = doc();
    const a = d.nodes.a!;
    const shown = withPatch(a, { x: 40 });
    expect(shown).toMatchObject({ x: 40 });
    expect(shown).not.toBe(a);
    expect((a as { x: number }).x).toBe(0);
  });

  it("hasContentPatch is true only for what changes the node's outline, ends or layout", () => {
    expect(hasContentPatch(undefined)).toBe(false);
    expect(hasContentPatch({ x: 1 })).toBe(false);
    expect(hasContentPatch({ d: "M0 0" })).toBe(true);
    expect(hasContentPatch({ control: { x: 1, y: 2 } })).toBe(true);
  });

  it("linkedPatches: a connector follows itself, its ends and their ancestors; nothing else, nothing for a non-connector", () => {
    const d = doc();
    const c = d.nodes.c!;
    expect(linkedPatches({}, d, c)).toBe(NO_LINKS);
    expect(linkedPatches({ z: { x: 1 } }, d, c)).toBe(NO_LINKS);
    expect(linkedPatches({ a: { x: 1 } }, d, d.nodes.a)).toBe(NO_LINKS);
    const own = { x: 5 };
    const frame = { x: 7 };
    expect(linkedPatches({ c: own, fr: frame, z: { x: 1 } }, d, c)).toEqual(["c", own, "fr", frame]);
  });

  it("sameLinked compares element by element", () => {
    const p = { x: 1 };
    expect(sameLinked(["a", p], ["a", p])).toBe(true);
    expect(sameLinked(["a", p], ["a", { x: 1 }])).toBe(false);
    expect(sameLinked(["a", p], [])).toBe(false);
  });

  it("routedConnector routes a copy over the shown nodes; the document's connector is untouched", () => {
    const d = doc();
    const c = d.nodes.c as ConnectorNode;
    const before = JSON.stringify(c);
    const moved = routedConnector(d, c, ["b", { x: 800 }]);
    expect(moved).not.toBe(c);
    expect(moved.x + moved.width).toBeGreaterThan(c.x + c.width);
    expect(JSON.stringify(c)).toBe(before);
    expect(JSON.stringify(d.nodes.b)).toContain('"x":500');
  });
});
