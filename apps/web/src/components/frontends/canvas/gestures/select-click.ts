import type { Gesture } from "../types";
import { isDeep, pickTarget } from "../target";
import { cornerOf, isRotateHandle } from "./shared";

/**
 * The press the move does not take: Shift or Cmd on a node toggles it in the selection (the group or instance it belongs to). It acts on `pointerdown` (as the old canvas did) and has nothing to follow, so it returns no run.
 */
export const selectClick: Gesture = {
  id: "select-click",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && cornerOf(event.target) === null && !isRotateHandle(event.target),
  start: (rt, event) => {
    const hit = rt.nodeAt(event.target);
    const selected = rt.selection();
    if (hit) {
      const id = isDeep(event) ? hit : pickTarget(rt.doc(), hit, selected);
      if (event.shiftKey || event.metaKey) rt.select(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      else if (!(selected.length === 1 && selected[0] === id)) rt.select([id]);
    } else if (selected.length > 0) rt.select([]);
    return undefined;
  },
};
