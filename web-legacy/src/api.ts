import { t } from "./i18n/store";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 0 },
    mutations: { retry: false },
  },
});

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new Error(t().invalidResponse(path));
  }
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? res.statusText);
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
