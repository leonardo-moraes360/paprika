import type { Gesture } from "../types";

/** Middle button, or the primary button while Space is held: the world follows the pointer. */
export const pan: Gesture = {
  id: "pan",
  accepts: (rt, event) => event.button === 1 || (event.button === 0 && rt.input.space),
  start: (rt, event) => {
    const x0 = event.clientX;
    const y0 = event.clientY;
    const start = rt.view.getTarget();
    rt.setPan("panning");
    const done = () => rt.setPan(rt.input.space ? "ready" : "off");
    return {
      move: (e) => rt.view.set({ ...start, x: start.x + e.clientX - x0, y: start.y + e.clientY - y0 }),
      up: done,
      cancel: done,
    };
  },
};
