import { QueryClient } from "@tanstack/react-query";

/** One client per app (made by the router): queries retry once and are always stale, mutations never retry. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
