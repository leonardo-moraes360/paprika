import { startTransition, useEffect, useState } from "react";

/**
 * `false` for the first commit of the caller, `true` after it. The switch is a transition, so a region that renders its
 * heavy body only when this is `true` lets the rest of the editor paint first, and then mounts in slices React can
 * interrupt (instead of one long task at the opening).
 */
export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTransition(() => setReady(true));
  }, []);
  return ready;
}
