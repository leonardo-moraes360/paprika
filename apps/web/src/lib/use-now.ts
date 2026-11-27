import { useEffect, useRef, useState } from "react";

/** The clock is read once in the render (`useState`) and then on the interval: no read on mount, which would commit every consumer a second time. */
export function useNow(now?: number, clock: () => number = Date.now, intervalMs = 1000): number {
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [internal, setInternal] = useState(() => clock());
  const controlled = now !== undefined;
  useEffect(() => {
    if (controlled) return;
    const id = setInterval(() => setInternal(clockRef.current()), intervalMs);
    return () => clearInterval(id);
  }, [controlled, intervalMs]);
  return now ?? internal;
}
