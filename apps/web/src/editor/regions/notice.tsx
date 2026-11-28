import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { WorkspaceNotice } from "@/components/frontends/workspace-notice";
import { toNoticeEntry } from "@/adapters/notice";
import { useLive, useLiveActions, type LiveState } from "@/data/live";

/** Over the stage, above the zoom bar: it covers neither the zoom bar nor the right column. */
const placement = "end-84 bottom-18";

/** The notice itself; it is mounted only while there is something to show. */
function ActiveNotice({ notice }: { notice: NonNullable<LiveState["workspaceNotice"]> }) {
  const { dismissWorkspaceNotice } = useLiveActions();
  const navigate = useNavigate();
  // The tone is the stable pick from the agent's name, the same the overview gives: one agent, one color on both screens.
  const entry = useMemo(() => toNoticeEntry(notice), [notice]);
  const onViewWorkspaces = useCallback(() => {
    dismissWorkspaceNotice();
    void navigate({ to: "/" });
  }, [dismissWorkspaceNotice, navigate]);
  return <WorkspaceNotice notice={entry} onDismiss={dismissWorkspaceNotice} onViewWorkspaces={onViewWorkspaces} className={placement} />;
}

/**
 * A workspace operation an agent did while you are here (it opened, renamed or deleted one). "View workspaces" goes to
 * the overview. The tone is the one the overview shows for the same agent.
 */
export function Notice() {
  const notice = useLive((s) => s.workspaceNotice);
  const { dismissWorkspaceNotice } = useLiveActions();
  if (notice) return <ActiveNotice notice={notice} />;
  return <WorkspaceNotice notice={null} onDismiss={dismissWorkspaceNotice} onViewWorkspaces={noop} className={placement} />;
}

const noop = () => {};
