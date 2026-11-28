import { useSyncExternalStore } from "react";
import { useCanvasRuntime } from "./runtime";

/**
 * Values that only overlays read (the marquee box, the drop marker, the resize lock): one key each, one listener list each.
 * They are NOT in the canvas store because every node of the page listens to that one (for its own selection, hover and
 * preview), so each write there asks thousands of nodes "did your answer change". A write here wakes the overlay that reads the key.
 */
export type OverlayBus = {
  get: <T>(key: string) => T | undefined;
  set: (key: string, value: unknown) => void;
  subscribe: (key: string, listener: () => void) => () => void;
};

export function createOverlayBus(): OverlayBus {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: <T,>(key: string) => values.get(key) as T | undefined,
    set: (key, value) => {
      if (Object.is(values.get(key), value)) return;
      if (value === undefined || value === null) values.delete(key);
      else values.set(key, value);
      for (const listener of [...(listeners.get(key) ?? [])]) listener();
    },
    subscribe: (key, listener) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
}

/** The value of a key of the overlay bus (`null` when nothing is set). */
export function useOverlayValue<T>(key: string): T | null {
  const { overlay } = useCanvasRuntime();
  const subscribe = (listener: () => void) => overlay.subscribe(key, listener);
  const read = () => overlay.get<T>(key) ?? null;
  return useSyncExternalStore(subscribe, read, read);
}
