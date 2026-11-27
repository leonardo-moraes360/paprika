import type { CanvasRuntime, Gesture, GestureRun } from "../types";

/**
 * Hands a `pointerdown` to the first gesture that accepts it and follows the pointer on the window until it is released or
 * cancelled. Returns what is needed to stop it (the canvas going away in the middle of a gesture). Nothing here is React state.
 */
export function startGesture(rt: CanvasRuntime, list: readonly Gesture[], event: PointerEvent): (() => void) | null {
  const gesture = list.find((g) => g.accepts(rt, event));
  if (!gesture) return null;
  const run: GestureRun | undefined = gesture.start(rt, event);
  if (!run) return null;
  const { pointerId } = event;
  let over = false;
  const off = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId === pointerId) run.move?.(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || over) return;
    over = true;
    off();
    run.up?.(e);
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || over) return;
    over = true;
    off();
    run.cancel?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  return () => {
    if (over) return;
    over = true;
    off();
    run.cancel?.();
  };
}
