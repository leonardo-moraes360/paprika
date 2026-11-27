import type { CanvasRuntime, DoubleClickHandler } from "../types";
import { openEditor } from "./open-editor";
import { editPath } from "./path-edit";

/** Double click on a node: select that node itself, however deep (a click picks the group, a second one goes in). */
const deepSelect: DoubleClickHandler = (rt, event) => {
  const id = rt.nodeAt(event.target);
  if (!id) return false;
  rt.select([id]);
  return true;
};

/**
 * What a double click does: the ONE list, in the order it is asked (the first handler that returns `true` takes the click and
 * the rest never see it). A double click is the browser's `dblclick`, which comes after the two presses the gestures already
 * handled (the first press selected the node). The order: edit a path's points (a path that is already selected), open the
 * editor of a text, a diagram shape or an arrow's label, and last select the node under the pointer itself, however deep.
 */
export const doubleClickHandlers: readonly DoubleClickHandler[] = [editPath, openEditor, deepSelect];

export function runDoubleClick(rt: CanvasRuntime, event: MouseEvent, handlers: readonly DoubleClickHandler[] = doubleClickHandlers): boolean {
  if (rt.tool() !== "select") return false;
  return handlers.some((handler) => handler(rt, event));
}
