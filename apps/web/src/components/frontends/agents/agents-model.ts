import type { AgentEntry } from "./types";

export function splitAgents(agents: readonly AgentEntry[], now: number, windowMs: number) {
  const rank = (agent: AgentEntry) => (agent.activity === "writing" ? 0 : 1);
  const order = (a: AgentEntry, b: AgentEntry) => rank(a) - rank(b) || b.lastActiveAt - a.lastActiveAt || a.name.localeCompare(b.name);
  const active = agents.filter((agent) => now - agent.lastActiveAt <= windowMs).sort(order);
  const idle = agents.filter((agent) => now - agent.lastActiveAt > windowMs).sort(order);
  return { active, idle };
}
