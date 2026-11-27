import type { CanvasRuntime, DoubleClickHandler } from "../types";

/** Double click on a node: select that node itself, however deep (a click picks the group, a second one goes in). */
const deepSelect: DoubleClickHandler = (rt, event) => {
  const id = rt.nodeAt(event.target);
  if (!id) return false;
  rt.select([id]);
  return true;
};

/**
 * What a double click does, in the order it is asked. The editors (the text of a node, a path's points, a connector's label) are
 * other batches' to add: each puts its handler BEFORE `deepSelect`, tests that the node under the pointer is the one it edits
 * (`pickTarget` from `../target` says whether a click would have picked it) and returns `true`.
 */
export const doubleClickHandlers: readonly DoubleClickHandler[] = [deepSelect];

export function runDoubleClick(rt: CanvasRuntime, event: MouseEvent, handlers: readonly DoubleClickHandler[] = doubleClickHandlers): boolean {
  if (rt.tool() !== "select") return false;
  return handlers.some((handler) => handler(rt, event));
}
