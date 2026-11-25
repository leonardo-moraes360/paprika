import { describe, expect, it } from "vitest";
import { applyOps, createDocument } from "../src/ops.js";

describe("ids that name Object.prototype members", () => {
  const doc = () => applyOps(createDocument("t"), [{ op: "create", node: { type: "frame", id: "board" } }]).doc;

  it("never resolve to the prototype", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(() => applyOps(doc(), [{ op: "update", id, props: { name: "x" } }])).toThrow(`node "${id}" does not exist`);
      expect(() => applyOps(doc(), [{ op: "delete", id }])).toThrow(`node "${id}" does not exist`);
      expect(() => applyOps(doc(), [{ op: "move", id: "board", parentId: id, index: 0 }])).toThrow(`parent "${id}" does not exist`);
    }
    expect(({} as Record<string, unknown>).name).toBeUndefined();
  });

  it("refuses __proto__ as a new id and accepts the other names", () => {
    expect(() => applyOps(doc(), [{ op: "create", node: { type: "rect", id: "__proto__" } }])).toThrow('id "__proto__" is reserved');
    const r = applyOps(doc(), [{ op: "create", node: { type: "rect", id: "constructor" } }]);
    expect(Object.hasOwn(r.doc.nodes, "constructor")).toBe(true);
  });
});
