import type { Gesture } from "../types";
import { boxHitsRect, DRAG_THRESHOLD } from "../transform";
import { isAdditive } from "../target";
import { cornerOf, isRotateHandle } from "./shared";

/**
 * A press on the empty page: drag a box and select the top-level nodes it touches (a turned one by its real outline, not by its
 * bounding box). With Shift, Cmd or Ctrl the nodes add to what was selected. A press that does not travel 3 px clears the selection.
 */
export const marquee: Gesture = {
  id: "marquee",
  accepts: (rt, event) => event.button === 0 && rt.tool() === "select" && rt.nodeAt(event.target) === null && cornerOf(event.target) === null && !isRotateHandle(event.target),
  start: (rt, event) => {
    const additive = isAdditive(event);
    const base = additive ? rt.selection() : [];
    const origin = rt.toWorld(event.clientX, event.clientY);
    const zoom = rt.view.get().zoom;
    if (!additive && rt.selection().length > 0) rt.select([]);
    let dragged = false;
    let emitted: readonly string[] = base;
    return {
      move: (ev) => {
        const p = rt.toWorld(ev.clientX, ev.clientY);
        if (!dragged && Math.hypot(p.x - origin.x, p.y - origin.y) * zoom < DRAG_THRESHOLD) return;
        dragged = true;
        const rect = { left: Math.min(origin.x, p.x), top: Math.min(origin.y, p.y), right: Math.max(origin.x, p.x), bottom: Math.max(origin.y, p.y) };
        rt.overlay.set("marquee", { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
        // Layout is read for every top-level node, once, before anything is written.
        const hits = rt.index.roots().filter((id) => {
          const box = rt.measure(id);
          return box !== null && boxHitsRect(box, rect);
        });
        const next = [...new Set([...base, ...hits])];
        if (next.length !== emitted.length || next.some((id, i) => id !== emitted[i])) {
          emitted = next;
          rt.select(next);
        }
      },
      up: () => rt.overlay.set("marquee", null),
      cancel: () => rt.overlay.set("marquee", null),
    };
  },
};
