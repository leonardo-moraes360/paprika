import type { Gesture } from "../types";

/**
 * The example every gesture follows: a click on a node selects it, a click on nothing clears the selection. It acts on
 * `pointerdown` (as the old canvas did) and has nothing to follow, so it returns no run.
 */
export const selectClick: Gesture = {
  id: "select-click",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select",
  start: (rt, event) => {
    const id = rt.nodeAt(event.target);
    if (id) {
      if (!(rt.selection().length === 1 && rt.selection()[0] === id)) rt.select([id]);
    } else if (rt.selection().length > 0) rt.select([]);
    return undefined;
  },
};
