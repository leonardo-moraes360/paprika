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
  /** Offers "View workspaces"; left out where the person is already looking at them (the overview). */
  onViewWorkspaces?: () => void;
  className?: string;
};
