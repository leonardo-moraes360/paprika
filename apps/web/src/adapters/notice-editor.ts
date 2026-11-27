import type { WorkspaceNoticeCounts, WorkspaceNoticeEntry, WorkspaceNoticeOp } from "@/components/frontends/workspace-notice";
import { agentLabel, toneFor, type AgentColor } from "./agents";

/** What the editor notice needs of a live `WorkspaceNotice`. */
export type NoticeInput = { id: number; actor: string; op: string; workspaceName: string; detail: Record<string, unknown> };

const ops = new Set<WorkspaceNoticeOp>(["delete", "open", "rename"]);
const countKeys = ["nodes", "pages", "frames", "images", "connectors", "historyEntries"] as const;

/** Counts a deleted workspace reports (`detail` of the `workspaceOp`); only positive whole numbers count. */
export function noticeCounts(detail: Record<string, unknown>): WorkspaceNoticeCounts | undefined {
  const counts: WorkspaceNoticeCounts = {};
  for (const key of countKeys) {
    const value = Number(detail[key]);
    if (Number.isFinite(value) && value > 0) counts[key] = Math.floor(value);
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/** Live notice to the entry the frontend shows; `null` for an operation it has no wording for. */
export function toNoticeEntry(notice: NoticeInput | null, tones: Readonly<Record<string, AgentColor>>): WorkspaceNoticeEntry | null {
  if (!notice || !ops.has(notice.op as WorkspaceNoticeOp)) return null;
  const counts = notice.op === "delete" ? noticeCounts(notice.detail) : undefined;
  return {
    id: String(notice.id),
    actor: { name: agentLabel(notice.actor), tone: toneFor(notice.actor, tones) },
    op: notice.op as WorkspaceNoticeOp,
    workspaceName: notice.workspaceName,
    ...(counts ? { counts } : {}),
  };
}
