import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface PreviewShape {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface WorkspaceFolder {
  id: string;
  name: string;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active: boolean;
  /** URL of the cover image, or null: the card shows a live thumbnail, or the first letter when the page has no shapes. */
  cover: string | null;
  /** Hidden from the default list until it is restored. */
  archived: boolean;
  /** Empty when the workspace sits at the root of the overview. */
  folderId: string;
  /** Shapes of the live thumbnail, in document coordinates. */
  preview: PreviewShape[];
}

interface OverviewList {
  workspaces: Workspace[];
  folders: WorkspaceFolder[];
}

export const workspacesKey = ["workspaces"] as const;

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const one = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;

/** Workspaces of this server, most recently updated first. `archived` lists only the hidden ones. */
export function useWorkspaces(archived = false) {
  return useQuery({
    queryKey: [...workspacesKey, archived ? "archived" : "active"],
    queryFn: async ({ signal }) => {
      const data = await api<{ workspaces: Workspace[]; folders?: WorkspaceFolder[] }>(
        archived ? "/api/workspaces?archived=1" : "/api/workspaces",
        { signal },
      );
      return { workspaces: data.workspaces, folders: data.folders ?? [] };
    },
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

/** Create, rename, cover, archive and delete; each one refreshes the list when it settles. */
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
      client.setQueriesData<OverviewList>({ queryKey: workspacesKey }, (data) =>
        data ? { ...data, workspaces: data.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) } : data,
      );
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

  const archive = useMutation({
    mutationFn: async (id: string) =>
      (await api<{ workspace: Workspace }>(`${one(id)}/archive`, { method: "POST" })).workspace,
    onSettled,
  });

  const unarchive = useMutation({
    mutationFn: async (id: string) =>
      (await api<{ workspace: Workspace }>(`${one(id)}/unarchive`, { method: "POST" })).workspace,
    onSettled,
  });

  const createFolder = useMutation({
    mutationFn: async (name: string) =>
      (await api<{ folder: WorkspaceFolder }>("/api/folders", json({ name }))).folder,
    onSettled,
  });

  const renameFolder = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api<{ folder: WorkspaceFolder }>(`/api/folders/${encodeURIComponent(id)}`, { ...json({ name }), method: "PATCH" })).folder,
    onSettled,
  });

  const move = useMutation({
    mutationFn: async ({ id, folderId }: { id: string; folderId: string }) =>
      (await api<{ workspace: Workspace }>(`${one(id)}/folder`, json({ folderId }))).workspace,
    onSettled,
  });

  return { create, rename, cover, remove, archive, unarchive, createFolder, renameFolder, move };
}

/** Makes a workspace the active one on the server. Only the overview's explicit open uses it: a URL load just views. */
export const openWorkspace = (id: string) => api<unknown>(`${one(id)}/open`, { method: "POST" });
