import type { Document } from "@paprika/core";
import type { LayerAgent } from "@/components/frontends/layers-panel";
import { toneFor, type AgentColor } from "./agents";

/** Tone of each agent client, given by the editor (`useAgentTones`); the same one the roster, the pins and the history show. */
export type AgentTones = Readonly<Record<string, AgentColor>>;

/** The part of a presence entry (`AgentPresence` of the live store) that this adapter reads. */
export type PresenceLike = { agent: string; actor: string; nodes: readonly string[]; at: number };

export type AgentTone = LayerAgent["tone"];

export const AGENT_IDLE_MS = 15_000;

export type AgentIdentity = { name: string; tone: AgentTone };

export type ActiveAgents = {
  /** Node id to the (first) active agent touching it. */
  nodes: ReadonlyMap<string, AgentIdentity>;
  /** Page id to how many active agents work on it. */
  pages: ReadonlyMap<string, number>;
};

export const noActiveAgents: ActiveAgents = { nodes: new Map(), pages: new Map() };

const baseName = (actor: string) => actor.replace(/^agent:?/, "") || "agent";

/**
 * Name and tone of every agent. The tone belongs to the actor (the client) and comes from `tones`; the name is the
 * actor's name, numbered when one actor runs several agents ("claude", "claude 2"), by order of arrival.
 */
export function agentIdentities(agents: readonly PresenceLike[], tones: AgentTones = {}): Map<string, AgentIdentity> {
  const out = new Map<string, AgentIdentity>();
  const seen = new Map<string, number>();
  for (const agent of agents) {
    const before = seen.get(agent.actor) ?? 0;
    seen.set(agent.actor, before + 1);
    out.set(agent.agent, { name: before === 0 ? baseName(agent.actor) : `${baseName(agent.actor)} ${before + 1}`, tone: toneFor(agent.actor, tones) });
  }
  return out;
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
export function deriveActiveAgents(agents: readonly PresenceLike[], doc: Document | null, now: number, previous: ActiveAgents = noActiveAgents, tones: AgentTones = {}): ActiveAgents {
  const active = agents.filter((agent) => now - agent.at <= AGENT_IDLE_MS);
  if (active.length === 0) return previous.nodes.size === 0 && previous.pages.size === 0 ? previous : noActiveAgents;
  const identities = agentIdentities(agents, tones);
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
  if (sameNodes && samePages) return previous;
  return { nodes: sameNodes ? previous.nodes : nodes, pages: samePages ? previous.pages : pages };
}
