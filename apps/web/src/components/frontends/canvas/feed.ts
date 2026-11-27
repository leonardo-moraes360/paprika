import type { CanvasFeed, CanvasInput } from "./types";

export const emptyCanvasInput = (): CanvasInput => ({ doc: null, pageId: null, selection: [], hoveredId: null, tool: "select", zoom: 1, fitRequest: 0, renderer: "dom" });

/**
 * A feed that holds its own input: `update` merges a patch and tells the canvas. For tests and for an owner that has no
 * store of its own; an owner with stores builds its feed from them (see `editor/regions/canvas.tsx`).
 */
export function createCanvasFeed(initial: Partial<CanvasInput> = {}): CanvasFeed & { update: (patch: Partial<CanvasInput>) => void } {
  let current: CanvasInput = { ...emptyCanvasInput(), ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update: (patch) => {
      current = { ...current, ...patch };
      for (const listener of [...listeners]) listener();
    },
  };
}
