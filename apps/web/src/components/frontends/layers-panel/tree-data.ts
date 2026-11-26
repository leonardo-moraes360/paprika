import type { TreeItemData } from "@ui-sdk/react/tree";
import { isContainerKind } from "./layer-icons";
import type { LayerDropPosition, LayerRowData } from "./types";

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
