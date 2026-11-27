import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, workspacePath } from "../api";

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

export const historyQuery = (workspaceId: string, settled: number) =>
  queryOptions({
    queryKey: ["history", workspaceId, settled] as const,
    queryFn: ({ signal }) => api<PanelView>(`${workspacePath(workspaceId)}/history`, { signal }),
    placeholderData: keepPreviousData,
  });

/** `value` as it was `ms` after it last changed. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The steps of a workspace; while `version` keeps changing the last data stays on screen and one refetch follows the last change. */
export function useHistory(workspaceId: string, version: number) {
  const settled = useSettled(version, HISTORY_SETTLE_MS);
  return useQuery(historyQuery(workspaceId, settled));
}
