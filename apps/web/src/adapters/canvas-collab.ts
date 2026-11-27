import type { Document } from "@paprika/core";
import type { CanvasAgent, CanvasBuildStep, CanvasPin } from "@/components/frontends/canvas";
import type { ServerPin } from "@/data/queries/pins";
import { agentIdentities, AGENT_IDLE_MS, type PresenceLike } from "./active-agents";
import { toneFor, toolActivity, type AgentTones } from "./agents";

/** How long an agent that has gone quiet is still drawn on the canvas (the old canvas' `AGENT_TTL_MS`, as the live store's). */
export const AGENT_SHOW_MS = 120_000;

export { AGENT_IDLE_MS };

const sameStrings = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

const sameAgent = (a: CanvasAgent, b: CanvasAgent) =>
  a.id === b.id && a.name === b.name && a.tone === b.tone && a.tool === b.tool && a.verb === b.verb && a.activity === b.activity && a.idle === b.idle && sameStrings(a.nodes, b.nodes);

/**
 * The agents the canvas draws: the ones heard from in the last two minutes, in order of arrival, with the name and tone the
 * roster gives them, what they are doing in words (`verbOf`) and whether they have gone idle (15 s). An agent whose drawing did not
 * change keeps its object, so a heartbeat (only `at` moves) changes nothing the canvas sees.
 */
export function toCanvasAgents(
  agents: readonly (PresenceLike & { tool: string })[],
  tones: AgentTones,
  now: number,
  verbOf: (tool: string) => string,
  previous: readonly CanvasAgent[] = [],
): readonly CanvasAgent[] {
  const names = agentIdentities(agents, tones);
  const before = new Map(previous.map((agent) => [agent.id, agent]));
  const out: CanvasAgent[] = [];
  for (const presence of agents) {
    if (now - presence.at >= AGENT_SHOW_MS) continue;
    const identity = names.get(presence.agent);
    if (!identity) continue;
    const next: CanvasAgent = {
      id: presence.agent,
      name: identity.name,
      tone: identity.tone,
      tool: presence.tool,
      verb: verbOf(presence.tool),
      activity: toolActivity(presence.tool),
      nodes: presence.nodes,
      idle: now - presence.at > AGENT_IDLE_MS,
    };
    const had = before.get(next.id);
    out.push(had && sameAgent(had, next) ? had : next);
  }
  return out.length === previous.length && out.every((agent, i) => agent === previous[i]) ? previous : out;
}

const samePin = (a: CanvasPin, b: CanvasPin) =>
  a.id === b.id && a.number === b.number && a.status === b.status && a.tone === b.tone && a.nodeId === b.nodeId && a.pageId === b.pageId && a.label === b.label && a.region.x === b.region.x && a.region.y === b.region.y && a.region.width === b.region.width && a.region.height === b.region.height;

/** The pins the canvas draws: the ones not resolved (a resolved pin leaves the canvas), with the tone of the agent that claimed it. */
export function toCanvasPins(pins: readonly ServerPin[], tones: AgentTones, label: (number: number) => string, previous: readonly CanvasPin[] = []): readonly CanvasPin[] {
  const before = new Map(previous.map((pin) => [pin.id, pin]));
  const out: CanvasPin[] = [];
  for (const pin of pins) {
    if (pin.status === "resolved") continue;
    const next: CanvasPin = {
      id: pin.id,
      number: pin.n,
      status: pin.status,
      ...(pin.status === "claimed" && pin.claimedBy ? { tone: toneFor(pin.claimedBy, tones) } : {}),
      nodeId: pin.nodeId && !pin.nodeMissing ? pin.nodeId : null,
      pageId: pin.pageId ?? null,
      region: pin.region,
      label: label(pin.n),
    };
    const had = before.get(next.id);
    out.push(had && samePin(had, next) ? had : next);
  }
  return out.length === previous.length && out.every((pin, i) => pin === previous[i]) ? previous : out;
}

/** The number the next pin will have. */
export const nextPinNumber = (pins: readonly ServerPin[]) => pins.reduce((max, pin) => Math.max(max, pin.n), 0) + 1;

// The build replay (the old canvas' `agents.ts`): what an agent just created is walked one node at a time, so the person sees it being drawn.

export const BUILD_STEP_MS = 120;
export const BUILD_TICK_MS = 40;
export const BUILD_WALK_CAP_MS = 2000;

export type BuildWalk = { actor: string; ids: string[]; index: number; stepMs: number; stride: number; nextAt: number };

/** A walk of at most two seconds: 120 ms a node, or a stride over the nodes every 40 ms when there are too many for that. */
export function buildPace(remaining: number): { stepMs: number; stride: number } {
  if (remaining * BUILD_STEP_MS <= BUILD_WALK_CAP_MS) return { stepMs: BUILD_STEP_MS, stride: 1 };
  const slots = Math.floor(BUILD_WALK_CAP_MS / BUILD_TICK_MS);
  return { stepMs: BUILD_TICK_MS, stride: Math.ceil(remaining / slots) };
}

/** Nodes of `next` that `prev` did not have, in the order of the document (a page is not one). Another document: none. */
export function createdInOrder(prev: Document | null, next: Document): string[] {
  if (!prev || prev.id !== next.id) return [];
  const out: string[] = [];
  const stack: string[] = [...next.rootIds].reverse();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const node = next.nodes[id];
    if (!node) continue;
    if (!prev.nodes[id] && node.type !== "page") out.push(id);
    if ("children" in node) for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i] as string);
  }
  return out;
}

export function appendBuild(list: readonly BuildWalk[], actor: string, created: readonly string[], now: number): BuildWalk[] {
  if (created.length === 0) return [...list];
  const prev = list.find((walk) => walk.actor === actor);
  const have = new Set(prev?.ids);
  const fresh = created.filter((id) => !have.has(id));
  if (fresh.length === 0) return [...list];
  const ids = prev ? [...prev.ids, ...fresh] : fresh;
  const index = prev ? prev.index : 0;
  const walk: BuildWalk = { actor, ids, index, ...buildPace(ids.length - index), nextAt: prev ? prev.nextAt : now + buildPace(ids.length - index).stepMs };
  return prev ? list.map((w) => (w === prev ? walk : w)) : [...list, walk];
}

/** Moves every walk to where `now` puts it; a walk that has gone past its last node ends. */
export function stepBuild(list: readonly BuildWalk[], now: number): BuildWalk[] {
  const out: BuildWalk[] = [];
  for (const walk of list) {
    if (now < walk.nextAt) {
      out.push(walk);
      continue;
    }
    const steps = Math.floor((now - walk.nextAt) / walk.stepMs) + 1;
    const index = walk.index + steps * walk.stride;
    if (index >= walk.ids.length) continue;
    out.push({ ...walk, index, nextAt: walk.nextAt + steps * walk.stepMs });
  }
  return out;
}

/** The node each walk is on now, with the tone of the agent that builds it; the same array while nothing moved. */
export function buildSteps(walks: readonly BuildWalk[], tones: AgentTones, previous: readonly CanvasBuildStep[] = []): readonly CanvasBuildStep[] {
  const next: CanvasBuildStep[] = [];
  for (const walk of walks) {
    const id = walk.ids[walk.index];
    if (id) next.push({ id, tone: toneFor(walk.actor, tones) });
  }
  return next.length === previous.length && next.every((step, i) => step.id === previous[i]?.id && step.tone === previous[i]?.tone) ? previous : next;
}
