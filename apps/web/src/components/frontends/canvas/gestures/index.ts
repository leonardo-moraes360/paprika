import type { Gesture } from "../types";
import { pan } from "./pan";
import { selectClick } from "./select-click";

/**
 * Every gesture of the canvas, in the order they are asked on a `pointerdown`: the first whose `accepts` is true starts and
 * the rest never see that press. Put a specific gesture before a general one (the marquee and the move before the click that
 * selects). Each batch adds its own lines here and nothing else is shared, so a merge is the union of the lists.
 */
export const gestures: readonly Gesture[] = [pan, selectClick];
