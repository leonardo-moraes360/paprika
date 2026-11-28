import type { WorkspaceNoticeCounts, WorkspaceNoticeEntry, WorkspaceNoticeOp } from "@/components/frontends/workspace-notice";
import type { WorkspaceNotice } from "@/data/live/protocol";
import { agentLabel, toneFor, type AgentColor } from "./agents";

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

const hashed = new WeakMap<WorkspaceNotice, WorkspaceNoticeEntry | null>();

function build(notice: WorkspaceNotice, tones: Readonly<Record<string, AgentColor>>): WorkspaceNoticeEntry | null {
  if (!ops.has(notice.op as WorkspaceNoticeOp)) return null;
  const counts = notice.op === "delete" ? noticeCounts(notice.detail) : undefined;
  return {
    id: String(notice.id),
    actor: { name: agentLabel(notice.actor), tone: toneFor(notice.actor, tones) },
    op: notice.op as WorkspaceNoticeOp,
    workspaceName: notice.workspaceName,
    ...(counts ? { counts } : {}),
  };
}

/**
 * Live notice to the frontend's entry; `null` for no notice or an operation the frontend has no sentence for (`archive`...).
 * `tones` are the editor's (the roster gives each agent client its tone). The overview has no editor state and passes none:
 * the tone then is the stable pick from the agent's name (`toneFor`), and the same notice gives the same entry.
 */
export function toNoticeEntry(notice: WorkspaceNotice | null, tones?: Readonly<Record<string, AgentColor>>): WorkspaceNoticeEntry | null {
  if (!notice) return null;
  if (tones) return build(notice, tones);
  const known = hashed.get(notice);
  if (known !== undefined) return known;
  const entry = build(notice, {});
  hashed.set(notice, entry);
  return entry;
}
