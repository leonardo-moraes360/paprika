import type { HistoryAuthor, HistoryStepData } from "@/lib/history-model";
import type { PanelStep } from "@/data/queries/history";
import type { StepResult } from "@/data/live/protocol";
import { agentLabel, toneFor, topOf, type AgentColor } from "./agents";

/** The server's actor for the person at the keyboard. */
export const HUMAN_ACTOR = "user";

export const isHumanActor = (actor: string) => actor === HUMAN_ACTOR;

/** The name of an actor in the panel: the one rule of `agentLabel`. */
export const actorName = agentLabel;

/** Author of a step: "user" is you; an agent keeps the tone the editor gave it (the roster's), or a stable pick from its name while it has none. */
export function historyAuthor(actor: string, tones: Readonly<Record<string, AgentColor>>): HistoryAuthor {
  if (isHumanActor(actor)) return { id: actor, name: actor, agent: false };
  return { id: actor, name: actorName(actor), agent: true, tone: toneFor(actor, tones) };
}

/** Server steps (numeric id, oldest first) to the panel's (string id). `tones` are the editor's. */
export function toHistorySteps(steps: readonly PanelStep[] | undefined, tones: Readonly<Record<string, AgentColor>>): HistoryStepData[] {
  if (!steps) return [];
  const authors = new Map<string, HistoryAuthor>();
  return steps.map((step) => {
    let author = authors.get(step.actor);
    if (!author) authors.set(step.actor, (author = historyAuthor(step.actor, tones)));
    return { id: String(step.id), author, label: step.label, at: step.at, undone: step.undone, nodeIds: step.nodeIds };
  });
}

/** The distinct agent actors of the steps (not you), in order of appearance: they get their tones from the editor. */
export const stepActors = (steps: readonly PanelStep[] | undefined): string[] => [...new Set((steps ?? []).map((step) => step.actor).filter((actor) => !isHumanActor(actor)))];

/** The server step id behind a panel id; `null` for an id that is not one. */
export function stepNumber(id: string): number | null {
  const value = Number(id);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export type StepOutcome =
  | { kind: "undone"; label: string; ord: number; newer: number; agent: string | null; own: boolean }
  | { kind: "redone"; label: string }
  | { kind: "nothing-mine"; agent: string }
  | { kind: "nothing" }
  | { kind: "nothing-redo" }
  | { kind: "conflict"; redo: boolean }
  | { kind: "missing" };

/**
 * What an undo/redo answer means for the person (the ack's `step`): the server says `undone`, `redone`, `conflict`
 * (newer steps touched the same nodes), `nothing` (nothing of yours; `actor` names who is on top) or `missing`.
 */
export function stepOutcome(result: StepResult, redo: boolean, own: boolean): StepOutcome {
  switch (result.result) {
    case "undone":
      return { kind: "undone", label: result.label, ord: result.ord, newer: result.newer, agent: isHumanActor(result.actor) ? null : actorName(result.actor), own };
    case "redone":
      return { kind: "redone", label: result.label };
    case "nothing":
      if (redo) return { kind: "nothing-redo" };
      return result.actor && !isHumanActor(result.actor) ? { kind: "nothing-mine", agent: actorName(result.actor) } : { kind: "nothing" };
    case "conflict":
      return { kind: "conflict", redo };
    default:
      return { kind: "missing" };
  }
}

type NodeMap = Record<string, { parentId?: string | null; type: string } | undefined>;

/** Of the nodes a step touched, the ones that still exist and sit on the same page as the first of them, and that page. */
export function pageOfNodes(nodes: NodeMap, ids: readonly string[]): { ids: string[]; pageId: string | null } {
  const present = ids.filter((id) => nodes[id] && nodes[id]?.type !== "page");
  const first = present[0];
  if (!first) return { ids: [], pageId: null };
  const top = topOf(nodes, first);
  return { ids: present.filter((id) => topOf(nodes, id) === top), pageId: nodes[top]?.type === "page" ? top : null };
}
