import type { WorkspaceNoticeCounts, WorkspaceNoticeEntry, WorkspaceNoticeOp } from "@/components/frontends/workspace-notice";

/** Structurally the live store's `WorkspaceNotice` (adapters may only import types from `data/live/protocol`). */
export type LiveNotice = { id: number; actor: string; op: string; workspaceName: string; detail: Record<string, unknown> };

const tones = ["agent-1", "agent-2", "agent-3", "agent-4"] as const;
const ops: readonly string[] = ["delete", "open", "rename"];
const countKeys = ["nodes", "pages", "frames", "images", "connectors", "historyEntries"] as const;

/** The name an agent goes by: the server's actor without the `agent:` prefix. */
export const actorName = (actor: string) => actor.replace(/^agent:/, "");

/** Same actor, same tone (a hash of the name: the notice has no roster of its own). */
export function actorTone(actor: string): (typeof tones)[number] {
  let hash = 0;
  for (const char of actor) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tones[hash % tones.length] ?? "agent-1";
}

function toCounts(detail: Record<string, unknown>): WorkspaceNoticeCounts | undefined {
  const counts: WorkspaceNoticeCounts = {};
  for (const key of countKeys) {
    const value = Number(detail[key]);
    if (Number.isFinite(value) && value > 0) counts[key] = value;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

const entries = new WeakMap<LiveNotice, WorkspaceNoticeEntry | null>();

/** Live notice to the frontend's entry; an operation the frontend has no sentence for (`archive`…) gives `null`. Same notice, same entry. */
export function toNoticeEntry(notice: LiveNotice | null): WorkspaceNoticeEntry | null {
  if (!notice) return null;
  const known = entries.get(notice);
  if (known !== undefined) return known;
  const entry = ops.includes(notice.op)
    ? { id: String(notice.id), actor: { name: actorName(notice.actor), tone: actorTone(notice.actor) }, op: notice.op as WorkspaceNoticeOp, workspaceName: notice.workspaceName, counts: toCounts(notice.detail) }
    : null;
  entries.set(notice, entry);
  return entry;
}
