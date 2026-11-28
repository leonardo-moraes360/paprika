import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, workspacePath } from "../api";
import { useLiveClient } from "../live/hooks";

/** `GET /api/workspaces/:id/history` (`HistoryPanelView` and `PanelStep` in `server/internal/server/store.go`). */
export type PanelStep = {
  id: number;
  actor: string;
  label: string;
  at: number;
  ops: number;
  undone: boolean;
  undoneBy?: string;
  nodeIds: string[];
};

export type PanelView = { version: number; steps: PanelStep[]; canUndo: boolean; canRedo: boolean };

/** The history refetches this long after the document version stopped changing (an agent writing is one fetch, not hundreds). */
export const HISTORY_SETTLE_MS = 300;

export const historyKey = (workspaceId: string) => ["history", workspaceId] as const;

export const historyQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: historyKey(workspaceId),
    queryFn: ({ signal }) => api<PanelView>(`${workspacePath(workspaceId)}/history`, { signal }),
  });

/**
 * Refetches the workspace's history once, `HISTORY_SETTLE_MS` after its document version stopped changing (an agent writing is one
 * fetch, not hundreds); the steps already shown stay until the answer comes. It subscribes to the live store itself and keeps no
 * state, so a stream of deltas renders nothing here.
 */
function useHistoryFollow(workspaceId: string) {
  const live = useLiveClient();
  const queries = useQueryClient();
  useEffect(() => {
    const versionOf = () => (live.store.state.doc?.id === workspaceId ? live.store.state.version : null);
    let seen = versionOf();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = live.store.subscribe(() => {
      const next = versionOf();
      if (next === seen) return;
      const first = seen === null;
      seen = next;
      // The first document of this workspace is what the query is about to fetch anyway.
      if (next === null || first) return;
      clearTimeout(timer);
      timer = setTimeout(() => void queries.invalidateQueries({ queryKey: historyKey(workspaceId) }), HISTORY_SETTLE_MS);
    });
    return () => {
      stop.unsubscribe();
      clearTimeout(timer);
    };
  }, [live, queries, workspaceId]);
}

/** The steps of a workspace, kept current while it is mounted. */
export function useHistory(workspaceId: string) {
  useHistoryFollow(workspaceId);
  return useQuery(historyQuery(workspaceId));
}
