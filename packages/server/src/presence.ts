import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Document } from "@paprika/core";

/**
 * Agent presence: what each agent is doing right now (last tool and the nodes it touched), so the
 * canvas can draw the agent's own cursor and selection. Presence is ephemeral: it lives only in
 * memory, is never persisted and never enters the history. The Go server mirrors this file
 * (server-go/internal/server/presence.go).
 */
export interface Presence {
  /** Stable key of the agent: hash of the MCP session id over HTTP, or the actor (stdio). */
  agent: string;
  /** History actor ("agent:<clientInfo.name>"). */
  actor: string;
  /** Last MCP tool the agent called. */
  tool: string;
  /** Nodes the tool acted on (created ones first), that still exist. Empty: the cursor stays where it was. */
  nodes: string[];
  /** Milliseconds since that tool call (0 when it is broadcast live). */
  idle: number;
}

/** How long a presence is replayed to a canvas that connects later. */
export const PRESENCE_TTL_MS = 120_000;
const MAX_AGENTS = 64;
const MAX_NODES = 20;

/** Presence key for an HTTP session id (hashed: the id never leaves the MCP endpoint as is). */
export function presenceKey(sessionId: string | undefined, actor: string): string {
  return sessionId ? `s:${createHash("sha256").update(sessionId).digest("hex").slice(0, 12)}` : actor;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const ID_FIELDS = ["ids", "id", "rootId", "componentId", "within", "parentId"] as const;

/**
 * Nodes a tool call acted on: the ids it created (structuredContent.created) or, when it created
 * nothing, the ids named in its arguments (top-level id fields, then updates/moves/ops entries).
 * Only ids that exist in `doc` are kept, in order, without duplicates.
 */
export function presenceTargets(args: unknown, structured: unknown, doc: Document): string[] {
  const out: string[] = [];
  const add = (ids: string[]) => {
    for (const id of ids) if (out.length < MAX_NODES && doc.nodes[id] && !out.includes(id)) out.push(id);
  };
  const created = strings((structured as { created?: unknown } | undefined)?.created);
  add(created);
  if (out.length || !args || typeof args !== "object") return out;
  const a = args as Record<string, unknown>;
  for (const k of ID_FIELDS) add(strings(a[k]));
  for (const list of ["updates", "moves", "ops"]) {
    const entries = a[list];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) if (e && typeof e === "object") for (const k of ["id", "ids", "parentId"]) add(strings((e as Record<string, unknown>)[k]));
  }
  return out;
}

interface Entry {
  agent: string;
  actor: string;
  tool: string;
  nodes: string[];
  at: number;
}

/** Last presence of each agent, broadcast as `presence` events. */
export class PresenceHub extends EventEmitter<{ presence: [Presence] }> {
  private readonly last = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  report(agent: string, actor: string, tool: string, nodes: string[]): void {
    const e: Entry = { agent, actor, tool, nodes, at: this.now() };
    this.last.delete(agent);
    this.last.set(agent, e);
    if (this.last.size > MAX_AGENTS) this.last.delete(this.last.keys().next().value as string);
    this.emit("presence", { agent, actor, tool, nodes, idle: 0 });
  }

  /** Presences younger than the TTL, oldest first (for a canvas that just connected). */
  recent(): Presence[] {
    const now = this.now();
    return [...this.last.values()]
      .filter((e) => now - e.at < PRESENCE_TTL_MS)
      .map((e) => ({ agent: e.agent, actor: e.actor, tool: e.tool, nodes: e.nodes, idle: now - e.at }));
  }
}
