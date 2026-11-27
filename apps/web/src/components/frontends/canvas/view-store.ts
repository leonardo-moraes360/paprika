import { clampZoom, sameView, viewTransform } from "./geometry";
import type { View } from "./types";

/** How long the camera must stay still to count as at rest (the owner's zoom is updated then, not before). */
export const SETTLE_MS = 140;

export type ViewTargets = {
  /** The element that holds the nodes: it gets `transform` straight from the store. */
  world: HTMLElement | null;
  /** The layer of overlays: it gets `--view-x`, `--view-y`, `--view-zoom` (custom properties) so a marker can stay the same size on screen with plain CSS. */
  overlay?: HTMLElement | null;
};

export type ViewStore = {
  /** The camera as it is on screen now. */
  get: () => View;
  /** Where the camera is going (what the next frame will show). Compute the next step from this one. */
  getTarget: () => View;
  /** Asks for a camera; it is applied in the next animation frame (or now with `immediate`). Zoom is clamped. */
  set: (next: View | ((current: View) => View), immediate?: boolean) => void;
  /** Applies the pending camera now. */
  flush: () => void;
  attach: (targets: ViewTargets | null) => void;
  /** Called with the camera after every frame that moved it. */
  onFrame: (listener: (view: View) => void) => () => void;
  /** Called when the camera has not moved for `SETTLE_MS`. */
  onSettled: (listener: (view: View) => void) => () => void;
  dispose: () => void;
};

/**
 * The camera of ONE canvas, outside React: pan and zoom write `transform` on the world element and never set state, so
 * not one node renders. `set` coalesces into one write per animation frame.
 */
export function createViewStore(initial: View = { x: 0, y: 0, zoom: 1 }): ViewStore {
  let applied = initial;
  let target = initial;
  let targets: ViewTargets | null = null;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frames = new Set<(view: View) => void>();
  const settles = new Set<(view: View) => void>();

  const paint = (v: View) => {
    if (!targets) return;
    if (targets.world) targets.world.style.transform = viewTransform(v);
    const overlay = targets.overlay;
    if (overlay) {
      overlay.style.setProperty("--view-x", `${v.x}px`);
      overlay.style.setProperty("--view-y", `${v.y}px`);
      overlay.style.setProperty("--view-zoom", String(v.zoom));
    }
  };

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (sameView(target, applied)) return;
    applied = target;
    paint(applied);
    for (const listener of [...frames]) listener(applied);
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      for (const listener of [...settles]) listener(applied);
    }, SETTLE_MS);
  };

  return {
    get: () => applied,
    getTarget: () => target,
    set: (next, immediate = false) => {
      const raw = typeof next === "function" ? next(target) : next;
      const v = raw.zoom === clampZoom(raw.zoom) ? raw : { ...raw, zoom: clampZoom(raw.zoom) };
      if (sameView(v, target)) return;
      target = v;
      if (immediate) flush();
      else if (!frame) frame = requestAnimationFrame(flush);
    },
    flush,
    attach: (next) => {
      targets = next;
      paint(applied);
    },
    onFrame: (listener) => {
      frames.add(listener);
      return () => void frames.delete(listener);
    },
    onSettled: (listener) => {
      settles.add(listener);
      return () => void settles.delete(listener);
    },
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(timer);
      timer = undefined;
      frames.clear();
      settles.clear();
      targets = null;
    },
  };
}
