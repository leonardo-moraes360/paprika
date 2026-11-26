import { useEffect, useRef, useState } from "react";

export function useNow(now?: number, clock: () => number = Date.now, intervalMs = 1000): number {
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [internal, setInternal] = useState(() => clock());
  const controlled = now !== undefined;
  useEffect(() => {
    if (controlled) return;
    setInternal(clockRef.current());
    const id = setInterval(() => setInternal(clockRef.current()), intervalMs);
    return () => clearInterval(id);
  }, [controlled, intervalMs]);
  return now ?? internal;
}
