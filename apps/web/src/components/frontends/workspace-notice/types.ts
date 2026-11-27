import type { AgentColor } from "@/components/ui/agent-tone";

export type WorkspaceNoticeOp = "delete" | "open" | "rename";

export type WorkspaceNoticeCounts = {
  nodes?: number;
  pages?: number;
  frames?: number;
  images?: number;
  connectors?: number;
  historyEntries?: number;
};

export type WorkspaceNoticeEntry = {
  id: string;
  actor: { name: string; tone?: AgentColor };
  op: WorkspaceNoticeOp;
  workspaceName: string;
  counts?: WorkspaceNoticeCounts;
};

export type WorkspaceNoticeProps = {
  notice: WorkspaceNoticeEntry | null;
  onDismiss: () => void;
  /** Leave for the workspace list. Left out where the list is already on screen (the overview), the notice then has no button. */
  onViewWorkspaces?: () => void;
  className?: string;
};
