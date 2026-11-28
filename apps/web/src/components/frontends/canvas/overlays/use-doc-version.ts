import { useSyncExternalStore } from "react";
import { useCanvasRuntime } from "../runtime";

/**
 * Re-renders the caller after the nodes did, in the same commit, whenever the document changed what is painted. A
 * `useLayoutEffect` that follows runs with the DOM already updated: that is where an overlay measures.
 */
export function useDocVersion(): number {
  const { index } = useCanvasRuntime();
  return useSyncExternalStore(index.subscribeDoc, index.docVersion, index.docVersion);
}
