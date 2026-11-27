import type { ReactNode } from "react";

/** Wraps the whole editor (owner: batch 4, which puts `CanvasError` here). Skeleton: renders its children. */
export function EditorBoundary({ children }: { children: ReactNode }) {
  return children;
}
