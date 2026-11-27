import type { Gesture } from "../types";
import { create } from "./create";
import { marquee } from "./marquee";
import { move } from "./move";
import { pan } from "./pan";
import { resize } from "./resize";
import { rotate } from "./rotate";
import { selectClick } from "./select-click";
/**
 * Every gesture of the canvas, in the order they are asked on a `pointerdown`: the first whose `accepts` is true starts and
 * the rest never see that press. The order is the precedence (`run.test.ts` has a case for each step):
 * pan; the handles and the edits already in progress; resize and rotate; create; move and reparent; marquee; the click.
 */
export const gestures: readonly Gesture[] = [pan, resize, rotate, create, move, marquee, selectClick];
