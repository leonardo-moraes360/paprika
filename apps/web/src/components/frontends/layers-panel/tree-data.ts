import type { TreeItemData } from "@ui-sdk/react/tree";
import { isContainerKind } from "./layer-icons";
import type { LayerDropPosition, LayerMove, LayerRowData } from "./types";

export function buildItems(rows: readonly LayerRowData[]): TreeItemData[] {
  const roots: TreeItemData[] = [];
  const stack: { level: number; item: TreeItemData }[] = [];
  for (const row of rows) {
    const item: TreeItemData = { value: row.id, label: row.name };
    while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= row.level) stack.pop();
    const parent = stack[stack.length - 1]?.item;
    if (parent) (parent.children ??= []).push(item);
    else roots.push(item);
    stack.push({ level: row.level, item });
  }
  return roots;
}

export function subtreeEnd(rows: readonly LayerRowData[], index: number): number {
  const level = rows[index]?.level ?? 0;
  let end = index + 1;
  while (end < rows.length && (rows[end] as LayerRowData).level > level) end += 1;
  return end;
}

export function topmostIds(rows: readonly LayerRowData[], ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let skipUntil = -1;
  rows.forEach((row, index) => {
    if (index < skipUntil || !ids.has(row.id)) return;
    out.push(row.id);
    skipUntil = subtreeEnd(rows, index);
  });
  return out;
}

export function blockedIndexes(rows: readonly LayerRowData[], moving: readonly string[]): Set<number> {
  const blocked = new Set<number>();
  const wanted = new Set(moving);
  rows.forEach((row, index) => {
    if (!wanted.has(row.id)) return;
    const end = subtreeEnd(rows, index);
    for (let at = index; at < end; at += 1) blocked.add(at);
  });
  return blocked;
}

export const acceptsChildren = (row: LayerRowData) => row.container ?? isContainerKind(row.kind);

export function canDrop(rows: readonly LayerRowData[], blocked: ReadonlySet<number>, targetIndex: number, position: LayerDropPosition): boolean {
  const target = rows[targetIndex];
  if (!target || blocked.has(targetIndex) || target.dropTarget === false) return false;
  return position !== "inside" || acceptsChildren(target);
}

export function dropPosition(fraction: number, container: boolean): LayerDropPosition {
  if (container && fraction > 0.28 && fraction < 0.72) return "inside";
  return fraction < 0.5 ? "before" : "after";
}

export type LayerMoveKey = "up" | "down" | "indent" | "outdent";

/**
 * The move that a keyboard step asks for, in the same shape the pointer drag emits.
 * `up` and `down` swap with the neighbouring sibling, `indent` goes inside the sibling above (when it takes children)
 * and `outdent` lands after the parent. Returns `null` when the step goes nowhere.
 */
export function keyboardMove(rows: readonly LayerRowData[], ids: readonly string[], key: LayerMoveKey): LayerMove | null {
  const moving = topmostIds(rows, new Set(ids)).filter((id) => rows.find((row) => row.id === id)?.draggable !== false);
  if (moving.length === 0) return null;
  const blocked = blockedIndexes(rows, moving);
  const indexOf = (id: string) => rows.findIndex((row) => row.id === id);
  const first = indexOf(moving[0] as string);
  const last = indexOf(moving[moving.length - 1] as string);
  const level = (rows[first] as LayerRowData).level;
  const previousSibling = () => {
    for (let at = first - 1; at >= 0; at -= 1) {
      const siblingLevel = (rows[at] as LayerRowData).level;
      if (siblingLevel < level) return -1;
      if (siblingLevel === level && !blocked.has(at)) return at;
    }
    return -1;
  };
  let targetIndex = -1;
  let position: LayerDropPosition = "before";
  if (key === "up") {
    targetIndex = previousSibling();
  } else if (key === "down") {
    const end = subtreeEnd(rows, last);
    if (end < rows.length && (rows[end] as LayerRowData).level === (rows[last] as LayerRowData).level) {
      targetIndex = end;
      position = "after";
    }
  } else if (key === "indent") {
    targetIndex = previousSibling();
    position = "inside";
  } else {
    for (let at = first - 1; at >= 0; at -= 1) {
      if ((rows[at] as LayerRowData).level < level) {
        targetIndex = at;
        position = "after";
        break;
      }
    }
  }
  if (targetIndex < 0 || !canDrop(rows, blocked, targetIndex, position)) return null;
  return { ids: moving, targetId: (rows[targetIndex] as LayerRowData).id, position };
}
