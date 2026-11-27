import type { Gesture } from "../types";
import { connectorCreate } from "./connector-create";
import { connectorEdit } from "./connector-edit";
import { gradientHandle } from "./gradient-handle";
import { pan } from "./pan";
import { pathEditDrag, pathEditHold } from "./path-edit";
import { pen } from "./pen";
import { selectClick } from "./select-click";
import { spacingHandle } from "./spacing-handle";

/**
 * Every gesture of the canvas, in the order they are asked on a `pointerdown`: the first whose `accepts` is true starts and
 * the rest never see that press. Put a specific gesture before a general one (the marquee and the move before the click that
 * selects). Each batch adds its own lines here and nothing else is shared, so a merge is the union of the lists.
 */
export const gestures: readonly Gesture[] = [pan, connectorEdit, gradientHandle, spacingHandle, pen, pathEditDrag, pathEditHold, connectorCreate, selectClick];
