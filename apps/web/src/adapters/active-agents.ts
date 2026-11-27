import type { Document } from "@paprika/core";
import type { LayerAgent } from "@/components/frontends/layers-panel";

/** The part of a presence entry (`AgentPresence` of the live store) that this adapter reads. */
export type PresenceLike = { agent: string; actor: string; nodes: readonly string[]; at: number };

export type AgentTone = LayerAgent["tone"];

export const AGENT_IDLE_MS = 15_000;
export const AGENT_TONES: readonly AgentTone[] = ["agent-1", "agent-2", "agent-3", "agent-4"];

export type AgentIdentity = { name: string; tone: AgentTone };

export type ActiveAgents = {
  /** Agents that were active in the last `AGENT_IDLE_MS`. */
  count: number;
  /** Node id to the (first) active agent touching it. */
  nodes: ReadonlyMap<string, AgentIdentity>;
  /** Page id to how many active agents work on it. */
  pages: ReadonlyMap<string, number>;
};

export const noActiveAgents: ActiveAgents = { count: 0, nodes: new Map(), pages: new Map() };

const baseName = (actor: string) => actor.replace(/^agent:?/, "") || "agent";

/**
 * Name and tone of every agent, by order of arrival: the tone is the position in the roster (four tones, then they
 * repeat), the name is the actor's name, numbered when one actor runs several agents ("claude", "claude 2").
 */
export function agentIdentities(agents: readonly PresenceLike[]): Map<string, AgentIdentity> {
  const out = new Map<string, AgentIdentity>();
  const seen = new Map<string, number>();
  agents.forEach((agent, index) => {
    const before = seen.get(agent.actor) ?? 0;
    seen.set(agent.actor, before + 1);
    out.set(agent.agent, { name: before === 0 ? baseName(agent.actor) : `${baseName(agent.actor)} ${before + 1}`, tone: AGENT_TONES[index % AGENT_TONES.length] as AgentTone });
  });
  return out;
}

/** Tone of an author in the history: the position of the actor among the distinct actors, by order of arrival. */
export function actorTone(actor: string, actors: readonly string[]): AgentTone {
  const at = actors.indexOf(actor);
  if (at >= 0) return AGENT_TONES[at % AGENT_TONES.length] as AgentTone;
  let hash = 0;
  for (const ch of actor) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_TONES[hash % AGENT_TONES.length] as AgentTone;
}

export function pageOfNode(doc: Document, nodeId: string): string | null {
  let node = doc.nodes[nodeId];
  for (let guard = 0; node?.parentId && guard < 1000; guard += 1) node = doc.nodes[node.parentId];
  return node?.type === "page" ? node.id : null;
}

const sameIdentity = (a: AgentIdentity | undefined, b: AgentIdentity | undefined) => a === b || (a !== undefined && b !== undefined && a.name === b.name && a.tone === b.tone);

function sameMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>, same: (x: V, y: V) => boolean) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || !same(value, other)) return false;
  }
  return true;
}

/**
 * Who is working where. `previous` keeps the identity of every part that did not change, so a presence heartbeat
 * or a delta that touches nothing here returns the same object and nobody re-renders.
 */
export function deriveActiveAgents(agents: readonly PresenceLike[], doc: Document | null, now: number, previous: ActiveAgents = noActiveAgents): ActiveAgents {
  const active = agents.filter((agent) => now - agent.at <= AGENT_IDLE_MS);
  if (active.length === 0) return previous.count === 0 && previous.nodes.size === 0 ? previous : noActiveAgents;
  const identities = agentIdentities(agents);
  const nodes = new Map<string, AgentIdentity>();
  const pages = new Map<string, number>();
  for (const agent of active) {
    const identity = identities.get(agent.agent) as AgentIdentity;
    for (const id of agent.nodes) if (!nodes.has(id)) nodes.set(id, identity);
    let page: string | null = null;
    if (doc) for (const id of agent.nodes) if ((page = pageOfNode(doc, id)) !== null) break;
    if (page) pages.set(page, (pages.get(page) ?? 0) + 1);
  }
  const sameNodes = sameMap(previous.nodes, nodes, sameIdentity);
  const samePages = sameMap(previous.pages, pages, (a, b) => a === b);
  if (previous.count === active.length && sameNodes && samePages) return previous;
  return { count: active.length, nodes: sameNodes ? previous.nodes : nodes, pages: samePages ? previous.pages : pages };
}
