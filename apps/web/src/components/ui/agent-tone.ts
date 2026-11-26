export type AgentColor = "agent-1" | "agent-2" | "agent-3" | "agent-4";

export type AgentTone = "select" | "select-pill" | AgentColor;

export const toneSurface: Record<AgentTone, string> = {
  select: "bg-select-brand text-on-select-brand",
  "select-pill": "bg-select-pill text-on-select-pill",
  "agent-1": "bg-agent-1 text-agent-1-ink",
  "agent-2": "bg-agent-2 text-agent-2-ink",
  "agent-3": "bg-agent-3 text-agent-3-ink",
  "agent-4": "bg-agent-4 text-agent-4-ink",
};

export const toneFill: Record<AgentTone, string> = {
  select: "fill-select-brand",
  "select-pill": "fill-select-pill",
  "agent-1": "fill-agent-1",
  "agent-2": "fill-agent-2",
  "agent-3": "fill-agent-3",
  "agent-4": "fill-agent-4",
};

export const toneDot: Record<AgentTone, string> = {
  select: "bg-select-brand",
  "select-pill": "bg-select-pill",
  "agent-1": "bg-agent-1",
  "agent-2": "bg-agent-2",
  "agent-3": "bg-agent-3",
  "agent-4": "bg-agent-4",
};
