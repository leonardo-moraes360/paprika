import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface Workspace {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active: boolean;
  /** URL of the cover image, or null: the card shows the first letter of the name. */
  cover: string | null;
}

export const workspacesKey = ["workspaces"] as const;

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const one = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

/** Workspaces of this server, most recently updated first. */
export function useWorkspaces() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: async ({ signal }) => (await api<{ workspaces: Workspace[] }>("/api/workspaces", { signal })).workspaces,
  });
}

/** At most one refetch per this interval while the active workspace keeps changing (an agent drawing). */
export const REFRESH_MS = 500;

/**
 * The WebSocket says when the list is stale: another workspace became active (refetch now), or the
 * active one changed (node count and "updated" time; throttled, the last change always lands).
 */
export function useWorkspacesFollow(activeId: string | null, version: number) {
  const client = useQueryClient();
  const seen = useRef({ activeId, version });
  const lastRun = useRef(0);
  useEffect(() => {
    const prev = seen.current;
    if (prev.activeId === activeId && prev.version === version) return; // mount: the query fetches by itself
    seen.current = { activeId, version };
    const run = () => {
      lastRun.current = Date.now();
      void client.invalidateQueries({ queryKey: workspacesKey });
    };
    const wait = prev.activeId !== activeId ? 0 : REFRESH_MS - (Date.now() - lastRun.current);
    if (wait <= 0) return run();
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [client, activeId, version]);
}

/** Create, rename, cover and delete; each one refreshes the list when it settles. */
export function useWorkspaceMutations() {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: workspacesKey });

  const create = useMutation({
    mutationFn: async (name: string) => (await api<{ workspace: Workspace }>("/api/workspaces", json({ name }))).workspace,
    onSettled,
  });

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api<{ workspace: Workspace }>(one(id), { ...json({ name }), method: "PATCH" })).workspace,
    // The card shows the new name right away; a refused rename comes back with the refetch.
    onMutate: async ({ id, name }) => {
      await client.cancelQueries({ queryKey: workspacesKey });
      client.setQueryData<Workspace[]>(workspacesKey, (list) => list?.map((w) => (w.id === id ? { ...w, name } : w)));
    },
    onSettled,
  });

  const cover = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Blob | null }) =>
      (await api<{ workspace: Workspace }>(`${one(id)}/cover`, body ? { method: "PUT", body } : { method: "DELETE" })).workspace,
    onSettled,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api<{ deleted: string }>(one(id), { method: "DELETE" })).deleted,
    onSettled,
  });

  return { create, rename, cover, remove };
}

/** Makes a workspace the active one on the server (the canvas follows through the WebSocket). */
export const openWorkspace = (id: string) => api<unknown>(`${one(id)}/open`, { method: "POST" });
