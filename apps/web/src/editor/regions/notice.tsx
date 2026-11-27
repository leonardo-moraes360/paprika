import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { WorkspaceNotice } from "@/components/frontends/workspace-notice";
import { toNoticeEntry } from "@/adapters/notice";
import { useLive, useLiveActions, type LiveState } from "@/data/live";
import { useAgentTones, useAssignTones } from "../collab";

/** Over the stage, above the zoom bar: it covers neither the zoom bar nor the right column. */
const placement = "end-84 bottom-18";

/** The notice itself; reads the tones, so it is mounted only while there is something to show. */
function ActiveNotice({ notice }: { notice: NonNullable<LiveState["workspaceNotice"]> }) {
  const { dismissWorkspaceNotice } = useLiveActions();
  const navigate = useNavigate();
  const tones = useAgentTones();
  useAssignTones(useMemo(() => [notice.actor], [notice.actor]));
  const entry = useMemo(() => toNoticeEntry(notice, tones), [notice, tones]);
  const onViewWorkspaces = useCallback(() => {
    dismissWorkspaceNotice();
    void navigate({ to: "/" });
  }, [dismissWorkspaceNotice, navigate]);
  return <WorkspaceNotice notice={entry} onDismiss={dismissWorkspaceNotice} onViewWorkspaces={onViewWorkspaces} className={placement} />;
}

/**
 * A workspace operation an agent did while you are here (it opened, renamed or deleted one). "View workspaces" goes to
 * the overview. The tone of the agent is the one the roster gives it.
 */
export function Notice() {
  const notice = useLive((s) => s.workspaceNotice);
  const { dismissWorkspaceNotice } = useLiveActions();
  if (notice) return <ActiveNotice notice={notice} />;
  return <WorkspaceNotice notice={null} onDismiss={dismissWorkspaceNotice} onViewWorkspaces={noop} className={placement} />;
}

const noop = () => {};
