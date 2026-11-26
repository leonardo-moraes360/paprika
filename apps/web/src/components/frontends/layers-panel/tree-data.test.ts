import { describe, expect, it } from "vitest";
import { blockedIndexes, buildItems, canDrop, dropPosition, keyboardMove, subtreeEnd, topmostIds } from "./tree-data";
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

  describe("keyboardMove", () => {
    it("swaps with the neighbouring sibling", () => {
      expect(keyboardMove(rows, ["d"], "up")).toEqual({ ids: ["d"], targetId: "b", position: "before" });
      expect(keyboardMove(rows, ["b"], "down")).toEqual({ ids: ["b"], targetId: "d", position: "after" });
      expect(keyboardMove(rows, ["a"], "down")).toEqual({ ids: ["a"], targetId: "e", position: "after" });
    });

    it("stops at the edges of the parent", () => {
      expect(keyboardMove(rows, ["b"], "up")).toBeNull();
      expect(keyboardMove(rows, ["d"], "down")).toBeNull();
      expect(keyboardMove(rows, ["a"], "up")).toBeNull();
    });

    it("indents into the sibling above and outdents after the parent", () => {
      expect(keyboardMove(rows, ["d"], "indent")).toEqual({ ids: ["d"], targetId: "b", position: "inside" });
      expect(keyboardMove(rows, ["e"], "indent")).toEqual({ ids: ["e"], targetId: "a", position: "inside" });
      expect(keyboardMove(rows, ["c"], "outdent")).toEqual({ ids: ["c"], targetId: "b", position: "after" });
      expect(keyboardMove(rows, ["a"], "outdent")).toBeNull();
    });

    it("does not indent into a sibling that cannot take children", () => {
      const flat = [row("a", 0, { kind: "text" }), row("b", 0)];
      expect(keyboardMove(flat, ["b"], "indent")).toBeNull();
    });

    it("moves only the topmost rows of a selection and skips locked targets", () => {
      expect(keyboardMove(rows, ["e", "f"], "up")).toEqual({ ids: ["e"], targetId: "a", position: "before" });
      expect(keyboardMove(rows, ["d"], "up")).not.toBeNull();
      const blocked = [row("a", 0), row("b", 0, { dropTarget: false }), row("c", 0)];
      expect(keyboardMove(blocked, ["c"], "up")).toBeNull();
      expect(keyboardMove(rows, ["b"], "up")).toBeNull();
      expect(keyboardMove([row("a", 0, { draggable: false }), row("b", 0)], ["a"], "down")).toBeNull();
    });
  });
});
