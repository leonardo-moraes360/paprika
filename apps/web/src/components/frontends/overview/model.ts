import type { OverviewView, WorkspaceEntry } from "./types";

export const workspacesView: OverviewView = { kind: "workspaces" };

export function sameView(a: OverviewView, b: OverviewView): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "project" && b.kind === "project" ? a.id === b.id : true;
}

export function filterWorkspaces(workspaces: readonly WorkspaceEntry[], view: OverviewView, query: string): WorkspaceEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return workspaces.filter((workspace) => {
    const archived = workspace.archived === true;
    if (view.kind === "archived" ? !archived : archived) return false;
    if (view.kind === "project" && workspace.projectId !== view.id) return false;
    return needle === "" || workspace.name.toLocaleLowerCase().includes(needle);
  });
}

export function relativeTime(at: number, locale: string, nowLabel: string, now: number): string {
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 45) return nowLabel;
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : String(error);
}
