import { X } from "lucide-react";
import { AGENT_COLORS } from "./agents";
import { Button } from "./components/ui/button";
import { useT, type Messages } from "./i18n";
import { navigate } from "./route";
import { useLive, useLiveActions, type WorkspaceNotice as Notice } from "./useDocument";

/** Agent color: the one in the presence list when the agent is there, else a stable pick from the same palette. */
function actorColor(actor: string, agents: { actor: string; color: string }[]): string {
  const present = agents.find((a) => a.actor === actor);
  if (present) return present.color;
  let hash = 0;
  for (const ch of actor) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[hash % AGENT_COLORS.length]!;
}

type CountKey = "nodes" | "pages" | "frames" | "images" | "connectors";

function deletedSummary(detail: Notice["detail"], m: Messages): string {
  const counts: [CountKey, string, string][] = [
    ["nodes", m.nodeSingular, m.nodePlural],
    ["pages", m.pageSingular, m.pagePlural],
    ["frames", m.frameSingular, m.framePlural],
    ["images", m.imageSingular, m.imagePlural],
    ["connectors", m.connectorSingular, m.connectorPlural],
  ];
  const parts = counts.flatMap(([key, one, many]) => {
    const n = Number(detail[key]);
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
  });
  const edits = Number(detail.historyEntries);
  if (edits > 0) parts.push(m.noticeEdits(edits));
  return m.noticeSummary(parts);
}

/**
 * Tells the human that an agent deleted, opened or renamed a workspace (the server's operations log, over the
 * WebSocket). The region is always mounted so screen readers announce what appears in it; the card never takes
 * focus, and stays until it is dismissed or replaced by the next one.
 */
export function WorkspaceNotice() {
  const m = useT();
  const notice = useLive((s) => s.workspaceNotice);
  const agents = useLive((s) => s.agents);
  const { dismissWorkspaceNotice } = useLiveActions();
  const summary = notice?.op === "delete" ? deletedSummary(notice.detail, m) : "";
  const what =
    notice &&
    (notice.op === "delete" ? m.noticeDeleted : notice.op === "open" ? m.noticeOpened : m.noticeRenamed)(notice.workspaceName);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 w-80 max-w-[calc(100%-2rem)]" aria-live="polite">
      {notice && (
        <div key={notice.id} role="status" className="workspace-notice pointer-events-auto grid gap-2 rounded-lg border border-ui-border bg-ui-popover p-3 text-ui-popover-foreground shadow-float">
          <div className="flex items-start gap-2">
            <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: actorColor(notice.actor, agents) }} aria-hidden />
            <p className="m-0 min-w-0 flex-1 text-md font-bold">
              <span className="workspace-notice-actor">{notice.actor.replace(/^agent:/, "")}</span> {what}
            </p>
            <Button className="-mt-0.5 -mr-1 size-6 shrink-0" variant="ghost" size="icon" aria-label={m.dismissNotice} onClick={dismissWorkspaceNotice}>
              <X aria-hidden />
            </Button>
          </div>
          {summary && <p className="workspace-notice-summary m-0 text-xs text-ui-muted-foreground">{summary}</p>}
          <div>
            <Button
              className="workspace-notice-overview"
              variant="secondary"
              size="sm"
              onClick={() => {
                dismissWorkspaceNotice();
                navigate("/");
              }}
            >
              {m.viewWorkspaces}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
