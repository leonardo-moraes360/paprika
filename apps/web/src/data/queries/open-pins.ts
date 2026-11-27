import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** Open pins of a workspace, for the header counter only (the pins panel and its mutations are batch 4's `queries/pins`). Keyed by the `pins` revision the server announces, under `["pins", id]` so batch 4's invalidation reaches it too. */
export const openPinsQuery = (workspaceId: string, rev: number) =>
  queryOptions({
    queryKey: ["pins", workspaceId, "open-count", rev] as const,
    queryFn: async ({ signal }) => {
      const body = await api<{ pins?: unknown[] }>(`/api/pins?workspaceId=${encodeURIComponent(workspaceId)}&status=open`, { signal });
      return body.pins?.length ?? 0;
    },
    placeholderData: keepPreviousData,
  });

export const useOpenPins = (workspaceId: string, rev: number) => useQuery(openPinsQuery(workspaceId, rev));
