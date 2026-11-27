import type { DoubleClickHandler, Gesture } from "../types";
import { create } from "./create";
import { openEditor } from "./open-editor";
import { pan } from "./pan";
import { selectClick } from "./select-click";

/**
 * Every gesture of the canvas, in the order they are asked on a `pointerdown`: the first whose `accepts` is true starts and
 * the rest never see that press. Put a specific gesture before a general one (the marquee and the move before the click that
 * selects). Each batch adds its own lines here and nothing else is shared, so a merge is the union of the lists.
 */
export const gestures: readonly Gesture[] = [pan, create, selectClick];

/**
 * The double clicks of the viewport, in order: the first handler that returns `true` takes it (a path opens its point editor
 * before a text opens its editor). A double click is the browser's `dblclick`, which comes after the two presses the gestures
 * above already handled (the first press selected the node).
 */
export const doubleClicks: readonly DoubleClickHandler[] = [openEditor];
