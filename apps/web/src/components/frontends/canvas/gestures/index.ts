import type { Gesture } from "../types";
import { connectorCreate } from "./connector-create";
import { connectorEdit } from "./connector-edit";
import { create } from "./create";
import { gradientHandle } from "./gradient-handle";
import { marquee } from "./marquee";
import { move } from "./move";
import { pan } from "./pan";
import { pathEditDrag, pathEditHold } from "./path-edit";
import { pen } from "./pen";
import { resize } from "./resize";
import { rotate } from "./rotate";
import { selectClick } from "./select-click";
import { spacingHandle } from "./spacing-handle";

/**
 * Every gesture of the canvas, in the order they are asked on a `pointerdown`: the first whose `accepts` is true starts and
 * the rest never see that press. The order is the precedence (`run.test.ts` has a case for each step):
 * pan; the handles and the edits in progress (an arrow's ends, a gradient, a gap or padding, the pen, the points of a path);
 * resize and rotate; create; a new arrow; move and reparent; marquee; the click that selects.
 */
export const gestures: readonly Gesture[] = [pan, connectorEdit, gradientHandle, spacingHandle, pen, pathEditDrag, pathEditHold, resize, rotate, create, connectorCreate, move, marquee, selectClick];
