import type { AgentColor } from "@/components/ui/agent-tone";

export type AgentActivity = "writing" | "reading";

export type AgentEntry = {
  id: string;
  name: string;
  tool: string;
  tone: AgentColor;
  activity: AgentActivity;
  lastActiveAt: number;
  pageId?: string;
  pageName?: string;
};

export const agentActiveWindowMs = 15_000;

export type AgentsProps = {
  agents: readonly AgentEntry[];
  now?: number;
  clock?: () => number;
  activeWindowMs?: number;
  onFocusAgent: (id: string) => void;
  onOpenPage?: (pageId: string, agentId: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};
