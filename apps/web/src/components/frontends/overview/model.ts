import { relativeParts } from "@/lib/relative-time";
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

const units = { seconds: "second", minutes: "minute", hours: "hour", days: "day" } as const;

export function relativeTime(at: number, locale: string, nowLabel: string, now: number): string {
  const { unit, count } = relativeParts(at, now, 45);
  if (unit === "now") return nowLabel;
  if (unit === "days" && count >= 30) return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-count, units[unit]);
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : String(error);
}
