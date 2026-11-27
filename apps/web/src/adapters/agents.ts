import type { Document } from "@paprika/core";
import type { AgentActivity, AgentEntry } from "@/components/frontends/agents";

/** What the roster needs of a presence (`AgentPresence` of `data/live` is one). */
export type AgentPresence = { agent: string; actor: string; tool: string; nodes: readonly string[]; at: number };

/** One of the four agent tones of the design. */
export type AgentColor = AgentEntry["tone"];

const tones: readonly AgentColor[] = ["agent-1", "agent-2", "agent-3", "agent-4"];

/** `agent:claude` to `claude`; a peer's agent keeps its `claude @ Marina` form. */
export const agentLabel = (actor: string | undefined) => (actor ?? "").replace(/^agent:/, "") || "agent";

/** Tone of an actor: the one the editor gave it, or a stable pick from its name while it has none. */
export function toneFor(actor: string, given: Readonly<Record<string, AgentColor>>): AgentColor {
  const known = given[actor];
  if (known) return known;
  let hash = 0;
  for (const char of actor) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

const readTools = new Set(["get_nodes", "find_nodes", "get_document_outline", "get_design_guide", "path_info", "render_screenshot", "lint_design", "export_code", "get_history", "list_workspaces", "get_selection", "export_image"]);

/** The tool says whether the agent is reading or writing (the same rule as the old app). */
export function toolActivity(tool: string): AgentActivity {
  return readTools.has(tool) || /^(get_|find_|list_|lint_|export_|render_)/.test(tool) ? "reading" : "writing";
}

export type AgentPage = { agent: string; pageId: string; pageName: string };

/** The page each agent works on, from the first node of its presence that is still in the document. */
export function agentPages(doc: Document | null, agents: readonly AgentPresence[]): AgentPage[] {
  if (!doc) return [];
  const out: AgentPage[] = [];
  for (const agent of agents) {
    for (const id of agent.nodes) {
      let node = doc.nodes[id];
      for (let guard = 0; node?.parentId && guard < 1000; guard += 1) node = doc.nodes[node.parentId];
      if (node?.type === "page") {
        out.push({ agent: agent.agent, pageId: node.id, pageName: node.name });
        break;
      }
    }
  }
  return out;
}

/**
 * Raw presence to roster entries. Several sessions of one client get a numbered name ("claude", "claude 2") in order of
 * arrival; the tone belongs to the client. `pages` comes from `agentPages`.
 */
export function toAgentEntries(agents: readonly AgentPresence[], given: Readonly<Record<string, AgentColor>>, pages: readonly AgentPage[] = []): AgentEntry[] {
  const seen = new Map<string, number>();
  const pageOf = new Map(pages.map((page) => [page.agent, page]));
  return agents.map((agent) => {
    const count = (seen.get(agent.actor) ?? 0) + 1;
    seen.set(agent.actor, count);
    const base = agentLabel(agent.actor);
    const page = pageOf.get(agent.agent);
    return {
      id: agent.agent,
      name: count > 1 ? `${base} ${count}` : base,
      tool: agent.tool,
      tone: toneFor(agent.actor, given),
      activity: toolActivity(agent.tool),
      lastActiveAt: agent.at,
      ...(page ? { pageId: page.pageId, pageName: page.pageName } : {}),
    };
  });
}

export const presenceActors = (agents: readonly AgentPresence[]): string[] => [...new Set(agents.map((agent) => agent.actor))];
