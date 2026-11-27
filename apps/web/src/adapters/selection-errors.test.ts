import { groupOps, ungroupOps, wrapOps, type Document } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { selectionErrorNote } from "./selection-errors";

const base = { rotation: 0, opacity: 1, visible: true, locked: false };
const doc = {
  id: "d",
  name: "d",
  rootIds: ["p"],
  tokens: {},
  nodes: {
    p: { id: "p", type: "page", name: "P", parentId: null, children: ["a", "f"] },
    a: { id: "a", type: "rect", name: "A", parentId: "p", x: 0, y: 0, width: 10, height: 10, ...base },
    f: { id: "f", type: "frame", name: "F", parentId: "p", x: 20, y: 0, width: 100, height: 100, children: ["b", "c"], layout: { mode: "row", gap: 0, padding: 0 }, ...base },
    b: { id: "b", type: "rect", name: "B", parentId: "f", x: 0, y: 0, width: 10, height: 10, ...base },
    c: { id: "c", type: "rect", name: "C", parentId: "f", x: 0, y: 0, width: 10, height: 10, ...base },
  },
} as unknown as Document;

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the core to refuse");
};

describe("selectionErrorNote", () => {
  it("maps the refusals of group, wrap and ungroup of the core, written by the core itself, to keys of the app", () => {
    const cases: [() => unknown, string][] = [
      [() => groupOps(doc, []), "nothingToGroup"],
      [() => groupOps(doc, ["ghost"]), "missing"],
      [() => groupOps(doc, ["p"]), "page"],
      [() => groupOps(doc, ["a", "b"]), "sameParent"],
      [() => groupOps(doc, ["b", "c"]), "flowLayout"],
      [() => wrapOps(doc, []), "nothingToGroup"],
      [() => wrapOps(doc, ["ghost"]), "missing"],
      [() => wrapOps(doc, ["p"]), "page"],
      [() => wrapOps(doc, ["a", "b"]), "sameParent"],
      [() => ungroupOps(doc, []), "nothingToUngroup"],
      [() => ungroupOps(doc, ["ghost"]), "missing"],
      [() => ungroupOps(doc, ["a"]), "notGroup"],
    ];
    for (const [run, key] of cases) {
      const text = refusal(run);
      expect(selectionErrorNote(text), text).toMatchObject({ key });
    }
  });

  it("carries the layout in the flow message, and shows a refusal it does not know as the detail of `other`", () => {
    expect(selectionErrorNote(refusal(() => groupOps(doc, ["b", "c"]))).values).toEqual({ layout: "row" });
    expect(selectionErrorNote("something new")).toEqual({ key: "other", values: { detail: "something new" } });
  });
});
