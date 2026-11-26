import { describe, expect, it } from "vitest";
import { blockedIndexes, buildItems, canDrop, dropPosition, subtreeEnd, topmostIds } from "./tree-data";
import type { LayerRowData } from "./types";

const row = (id: string, level: number, extra: Partial<LayerRowData> = {}): LayerRowData => ({
  id,
  name: id,
  kind: "frame",
  level,
  hasChildren: false,
  visible: true,
  locked: false,
  selected: false,
  ...extra,
});

const rows = [row("a", 0), row("b", 1), row("c", 2), row("d", 1), row("e", 0), row("f", 1, { kind: "text" })];

describe("tree-data", () => {
  it("builds nested items from the flat pre-order rows", () => {
    expect(buildItems(rows)).toEqual([
      { value: "a", label: "a", children: [{ value: "b", label: "b", children: [{ value: "c", label: "c" }] }, { value: "d", label: "d" }] },
      { value: "e", label: "e", children: [{ value: "f", label: "f" }] },
    ]);
  });

  it("finds where a subtree ends", () => {
    expect(subtreeEnd(rows, 0)).toBe(4);
    expect(subtreeEnd(rows, 1)).toBe(3);
    expect(subtreeEnd(rows, 5)).toBe(6);
  });

  it("keeps only the outermost ids of a selection", () => {
    expect(topmostIds(rows, new Set(["a", "c", "e", "f"]))).toEqual(["a", "e"]);
    expect(topmostIds(rows, new Set(["c", "d"]))).toEqual(["c", "d"]);
  });

  it("blocks the moved rows and their descendants as targets", () => {
    const blocked = blockedIndexes(rows, ["b"]);
    expect([...blocked].sort()).toEqual([1, 2]);
    expect(canDrop(rows, blocked, 2, "inside")).toBe(false);
    expect(canDrop(rows, blocked, 1, "after")).toBe(false);
    expect(canDrop(rows, blocked, 3, "after")).toBe(true);
  });

  it("only allows dropping inside containers and on droppable rows", () => {
    const list = [row("p", 0), row("t", 0, { kind: "text" }), row("x", 0, { dropTarget: false }), row("i", 0, { kind: "instance" }), row("c", 0, { kind: "rect", container: true })];
    const none = new Set<number>();
    expect(canDrop(list, none, 0, "inside")).toBe(true);
    expect(canDrop(list, none, 1, "inside")).toBe(false);
    expect(canDrop(list, none, 1, "before")).toBe(true);
    expect(canDrop(list, none, 2, "after")).toBe(false);
    expect(canDrop(list, none, 3, "inside")).toBe(false);
    expect(canDrop(list, none, 4, "inside")).toBe(true);
    expect(canDrop(list, none, 9, "before")).toBe(false);
  });

  it("splits a row into before, inside and after", () => {
    expect(dropPosition(0.1, true)).toBe("before");
    expect(dropPosition(0.5, true)).toBe("inside");
    expect(dropPosition(0.9, true)).toBe("after");
    expect(dropPosition(0.5, false)).toBe("after");
    expect(dropPosition(0.4, false)).toBe("before");
  });
});
