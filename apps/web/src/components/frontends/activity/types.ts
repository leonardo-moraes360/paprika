import type { AgentColor } from "@/components/ui/agent-tone";

export type ActivityActor = { name: string; you?: boolean; tone?: AgentColor };

export type ActivityEntry = {
  id: string;
  actor: ActivityActor;
  label: string;
  at: number;
  step?: boolean;
};

export type ActivityProps = {
  entries: readonly ActivityEntry[];
  now?: number;
  clock?: () => number;
  limit?: number;
  className?: string;
};
