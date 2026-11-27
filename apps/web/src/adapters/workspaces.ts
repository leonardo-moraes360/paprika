import type { ProjectEntry, WorkspaceEntry } from "@/components/frontends/overview";
import type { ServerFolder, ServerWorkspace } from "@/data/queries/workspaces";

const entries = new WeakMap<ServerWorkspace, Map<string, WorkspaceEntry>>();

/**
 * Server row to overview entry. The same server object and the same `canChange` give the same entry object, so a
 * list refetch that returns unchanged rows (structural sharing) does not re-render their cards.
 * `canChange`: the server refuses to archive or delete the last workspace that is not archived.
 */
export function toWorkspaceEntry(workspace: ServerWorkspace, canChange: boolean): WorkspaceEntry {
  const key = String(canChange);
  let byFlag = entries.get(workspace);
  if (!byFlag) {
    byFlag = new Map();
    entries.set(workspace, byFlag);
  }
  let entry = byFlag.get(key);
  if (!entry) {
    entry = {
      id: workspace.id,
      name: workspace.name,
      nodes: workspace.nodes,
      updatedAt: workspace.updatedAt,
      active: workspace.active,
      archived: workspace.archived,
      projectId: workspace.folderId || null,
      cover: workspace.cover,
      canArchive: workspace.archived ? true : canChange,
      canDelete: canChange,
    };
    byFlag.set(key, entry);
  }
  return entry;
}

export function toWorkspaceEntries(workspaces: readonly ServerWorkspace[]): WorkspaceEntry[] {
  const open = workspaces.filter((w) => !w.archived).length;
  return workspaces.map((workspace) => toWorkspaceEntry(workspace, workspace.archived ? open >= 1 : open > 1));
}

export function toProjectEntries(folders: readonly ServerFolder[]): ProjectEntry[] {
  return folders.map((folder) => ({ id: folder.id, name: folder.name }));
}

export type OpenFailure = "invalid" | "notFound";

/**
 * Why a workspace could not be opened, from the answer of `POST /open` (status 404 / 422) or the refusal of the socket's `view`
 * (only a message: "does not exist", "is invalid in the database"). `null` for any other failure. Those server texts are written
 * for agents (they list every workspace id, or dump the validator's JSON), so the app shows its own sentence for the kind.
 */
export function openFailureOf(error: unknown): OpenFailure | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 404) return "notFound";
  if (status === 422) return "invalid";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("is invalid in the database")) return "invalid";
  if (/does not exist/.test(message)) return "notFound";
  return null;
}
