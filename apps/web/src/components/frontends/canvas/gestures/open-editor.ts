import { copyOwner, isInstance, type Document } from "@paprika/core";
import type { DoubleClickHandler } from "../types";

/**
 * Is `id` what a click on it would select (not a group or an instance above it)? The same walk as the old canvas: from the
 * outermost group or instance down, the first one that is selected, or that holds nothing selected, is the target.
 */
export function isClickTarget(doc: Document, id: string, selected: readonly string[]): boolean {
  const above: string[] = [];
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) {
    const node = doc.nodes[p];
    if (node?.type === "group" || (node && isInstance(node))) above.push(p);
  }
  const within = (group: string) =>
    selected.some((s) => {
      for (let cur = doc.nodes[s]?.parentId ?? null; cur; cur = doc.nodes[cur]?.parentId ?? null) if (cur === group) return true;
      return false;
    });
  for (let k = above.length - 1; k >= 0; k--) {
    const group = above[k]!;
    if (selected.includes(group) || !within(group)) return false;
  }
  return true;
}

/**
 * A double click on a text, a diagram shape or a connector opens its editor over it (`region.editingId`): the text editor,
 * the shape's textarea or the arrow's label field. The node must be one a click would select now, and not locked or part of
 * a component instance. The double click of a frame's label is the label's own (`overlays/frame-labels.tsx`).
 */
export const openEditor: DoubleClickHandler = (rt, event) => {
  if (rt.tool() !== "select") return false;
  const id = rt.nodeAt(event.target);
  if (!id) return false;
  const doc = rt.doc();
  const node = doc.nodes[id];
  if (!node || (node.type !== "text" && node.type !== "shape" && node.type !== "connector")) return false;
  if (node.locked) return false;
  if (node.type !== "text" && copyOwner(doc, node)) return false;
  const selected = rt.selection();
  if (!selected.includes(id) && !isClickTarget(doc, id, selected)) return false;
  rt.select([id]);
  rt.store.actions.setEditing(id);
  return true;
};
