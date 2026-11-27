import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { api, jsonRequest, workspacePath } from "../api";
import { useLiveClient } from "../live/hooks";

export type PreviewShape = { x: number; y: number; w: number; h: number; fill: string };

/** `GET /api/workspaces` rows (`WorkspaceInfo` in `server/internal/server/store.go`). */
export type ServerWorkspace = {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active: boolean;
  cover: string | null;
  archived: boolean;
  folderId: string;
  preview: PreviewShape[];
  error?: string;
};

export type ServerFolder = { id: string; name: string; updatedAt: number };

export type WorkspaceList = { active: string; workspaces: ServerWorkspace[]; folders: ServerFolder[] };

export const workspacesKey = ["workspaces"] as const;

/** Both the active and the archived workspaces in one list: the overview filters by view locally (`includeArchived=1`). */
export const workspacesQuery = () =>
  queryOptions({
    queryKey: [...workspacesKey, "all"] as const,
    queryFn: async ({ signal }): Promise<WorkspaceList> => {
      const data = await api<Partial<WorkspaceList>>("/api/workspaces?includeArchived=1", { signal });
      return { active: data.active ?? "", workspaces: data.workspaces ?? [], folders: data.folders ?? [] };
    },
  });

export const useWorkspaces = () => useQuery(workspacesQuery());

/** `POST /api/workspaces/:id/open`: makes it the active workspace of the server (the editor navigates first, then calls this). */
export const openWorkspace = (id: string) => api<{ workspace: ServerWorkspace; version: number }>(`${workspacePath(id)}/open`, jsonRequest("POST"));

export const refreshWorkspaces = (client: QueryClient) => client.invalidateQueries({ queryKey: workspacesKey });

/**
 * Mutations of the overview. Every one invalidates the list when it settles (success or not, so the list is the
 * server's truth); renaming also edits the name in the cached list at once, as the old app did.
 */
export function createWorkspaceActions(client: QueryClient) {
  const settled = () => refreshWorkspaces(client);
  const run = async <T>(request: () => Promise<T>): Promise<T> => {
    try {
      return await request();
    } finally {
      void settled();
    }
  };
  const one = (id: string) => workspacePath(id);
  return {
    create: (name: string) => run(async () => (await api<{ workspace: ServerWorkspace }>("/api/workspaces", jsonRequest("POST", { name }))).workspace),
    rename: async (id: string, name: string) => {
      await client.cancelQueries({ queryKey: workspacesKey });
      client.setQueriesData<WorkspaceList>({ queryKey: workspacesKey }, (data) =>
        data ? { ...data, workspaces: data.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) } : data,
      );
      return run(async () => (await api<{ workspace: ServerWorkspace }>(one(id), jsonRequest("PATCH", { name }))).workspace);
    },
    remove: (id: string) => run(() => api<{ deleted: string; active: string }>(one(id), jsonRequest("DELETE"))),
    archive: (id: string) => run(() => api<{ workspace: ServerWorkspace }>(`${one(id)}/archive`, jsonRequest("POST"))),
    unarchive: (id: string) => run(() => api<{ workspace: ServerWorkspace }>(`${one(id)}/unarchive`, jsonRequest("POST"))),
    setCover: (id: string, body: Blob) => run(() => api<{ workspace: ServerWorkspace }>(`${one(id)}/cover`, { method: "PUT", body })),
    clearCover: (id: string) => run(() => api<{ workspace: ServerWorkspace }>(`${one(id)}/cover`, jsonRequest("DELETE"))),
    move: (id: string, folderId: string | null) => run(() => api<{ workspace: ServerWorkspace }>(`${one(id)}/folder`, jsonRequest("POST", { folderId }))),
    createFolder: (name: string) => run(async () => (await api<{ folder: ServerFolder }>("/api/folders", jsonRequest("POST", { name }))).folder),
  };
}

export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;

/** Stable for the life of the query client. */
export function useWorkspaceActions(): WorkspaceActions {
  const client = useQueryClient();
  return useMemo(() => createWorkspaceActions(client), [client]);
}

export const refreshIntervalMs = 500;

export type RefreshThrottle = { request: () => void; now: () => void; cancel: () => void };

/**
 * `now()` runs `run` at once; `request()` runs it at once when `ms` have passed since the last run, else once at the
 * end of the interval (a burst of requests is one run per interval, the last one never lost).
 */
export function createRefreshThrottle(run: () => void, ms: number, clock: () => number = Date.now): RefreshThrottle {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = undefined;
    last = clock();
    run();
  };
  return {
    now: fire,
    request: () => {
      if (timer !== undefined) return;
      const wait = ms - (clock() - last);
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Keeps the list current without rendering anything: refetches when the active workspace changes, when a
 * workspace is created, renamed or deleted by anyone (`workspaceOp`), after a reconnection, and, at most every
 * 500 ms, while the active document's version moves (node count and preview change). Subscribes to the store
 * itself, so a stream of deltas re-renders nothing.
 */
export function useWorkspacesFollow() {
  const live = useLiveClient();
  const queries = useQueryClient();
  useEffect(() => {
    const throttle = createRefreshThrottle(() => void refreshWorkspaces(queries), refreshIntervalMs);
    const read = () => {
      const { doc, version, connected } = live.store.state;
      return { id: doc?.id ?? null, version, connected };
    };
    let seen = read();
    const stopStore = live.store.subscribe(() => {
      const next = read();
      const before = seen;
      seen = next;
      if (next.connected && !before.connected) throttle.now();
      else if (before.id !== null && next.id !== before.id) throttle.now();
      else if (next.id !== null && next.id === before.id && next.version !== before.version) throttle.request();
    });
    const stopEvents = live.subscribe((event) => {
      if (event.type === "workspaceOp") throttle.now();
    });
    return () => {
      stopStore.unsubscribe();
      stopEvents();
      throttle.cancel();
    };
  }, [live, queries]);
}
