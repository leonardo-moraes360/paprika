import { sampleCanvasColor } from "../eyedropper";
import type { Gesture } from "../types";

/**
 * While the eyedropper is armed, the next click reads the colour of the layer under the pointer and hands it to the owner
 * (the old canvas took the press in the capture phase, so nothing else sees it). It acts on `pointerdown` and has nothing to follow.
 */
export const eyedropper: Gesture = {
  id: "eyedropper",
  accepts: (rt, event) => event.button === 0 && rt.sampling(),
  start: (rt, event) => {
    event.preventDefault();
    rt.sample(sampleCanvasColor(rt.doc(), event.clientX, event.clientY, rt.viewport()));
    return undefined;
  },
};
