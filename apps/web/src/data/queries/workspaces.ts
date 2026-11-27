import { queryOptions, useQuery } from "@tanstack/react-query";
import { api, jsonRequest, workspacePath } from "../api";

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

export const workspacesQuery = (archived = false) =>
  queryOptions({
    queryKey: [...workspacesKey, archived ? "archived" : "active"] as const,
    queryFn: async ({ signal }): Promise<WorkspaceList> => {
      const data = await api<Partial<WorkspaceList>>(archived ? "/api/workspaces?archived=1" : "/api/workspaces", { signal });
      return { active: data.active ?? "", workspaces: data.workspaces ?? [], folders: data.folders ?? [] };
    },
  });

export const useWorkspaces = (archived = false) => useQuery(workspacesQuery(archived));

/** `POST /api/workspaces/:id/open`: makes it the active workspace of the server (the editor navigates first, then calls this). */
export const openWorkspace = (id: string) => api<{ workspace: ServerWorkspace; version: number }>(`${workspacePath(id)}/open`, jsonRequest("POST"));
