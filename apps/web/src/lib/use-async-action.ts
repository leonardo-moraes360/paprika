import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncActionState = { pending: boolean; error: string | null };

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "";
}

/** The message to show for a failed action: `error` when it has text, otherwise the caller's generic `fallback`. Never empty (given a non-empty fallback); `null` when there is no error. */
export function errorOrFallback(error: string | null, fallback: string): string | null {
  if (error === null) return null;
  return error.trim() ? error : fallback;
}

export function useAsyncAction() {
  const [state, setState] = useState<AsyncActionState>({ pending: false, error: null });
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (action: () => unknown): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setState({ pending: true, error: null });
    try {
      await action();
      if (alive.current) setState({ pending: false, error: null });
      return true;
    } catch (error) {
      if (alive.current) setState({ pending: false, error: errorText(error) });
      return false;
    } finally {
      busy.current = false;
    }
  }, []);
  const clearError = useCallback(() => setState((s) => (s.error === null ? s : { ...s, error: null })), []);
  const errorTextOr = useCallback((fallback: string) => errorOrFallback(state.error, fallback), [state.error]);
  return { ...state, run, clearError, errorText: errorTextOr };
}
