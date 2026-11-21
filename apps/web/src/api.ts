import { QueryClient } from "@tanstack/react-query";

/**
 * HTTP data of the server (workspace list and its mutations) goes through TanStack Query. The open
 * document does not: it is pushed over the WebSocket (`useDocument.ts`), which only tells the
 * queries when they are stale.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    // The server is local: a failure is real (bad id, server down), retrying hides it for seconds.
    // staleTime 0: coming back to a screen shows the cached data and revalidates it (agents write
    // while nobody is looking, and the WebSocket only reaches mounted screens).
    queries: { retry: 1, staleTime: 0 },
    mutations: { retry: false },
  },
});

/** Calls the JSON API; a non-2xx answer throws its `error` field (or the status text). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new Error(`resposta inválida de ${path}`);
  }
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? res.statusText);
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
