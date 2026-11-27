import { useMemo } from "react";
import { WorkspaceNotice } from "@/components/frontends/workspace-notice";
import { toNoticeEntry } from "@/adapters/notice";
import { useLive, useLiveActions } from "@/data/live";

/** What an agent did to a workspace (rename, open, delete): the live store keeps the last one until it is dismissed. */
export function OverviewNotice() {
  const notice = useLive((s) => s.workspaceNotice);
  const { dismissWorkspaceNotice } = useLiveActions();
  const entry = useMemo(() => toNoticeEntry(notice), [notice]);
  // On the overview "view workspaces" means: you are already here.
  return <WorkspaceNotice notice={entry} onDismiss={dismissWorkspaceNotice} onViewWorkspaces={dismissWorkspaceNotice} />;
}
