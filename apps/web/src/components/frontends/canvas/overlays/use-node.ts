import type { Node } from "@paprika/core";
import { useCallback, useSyncExternalStore } from "react";
import { useCanvasRuntime } from "../runtime";

/** The node `id` as the canvas holds it now (`undefined` until the document has it); re-renders only when that node changes. */
export function useNode(id: string): Node | undefined {
  const { index } = useCanvasRuntime();
  const subscribe = useCallback((listener: () => void) => index.subscribe(id, listener), [index, id]);
  const read = useCallback(() => index.snapshot(id), [index, id]);
  return useSyncExternalStore(subscribe, read, read).node ?? undefined;
}
