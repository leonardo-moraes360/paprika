import { AGENT_COLORS } from "./agents";

export const HUMAN_ACTOR = "user";

export interface PanelStep {
  id: number;
  actor: string;
  label: string;
  at: number;
  ops: number;
  undone: boolean;
  undoneBy?: string;
  nodeIds: string[];
}

export interface PanelView {
  version: number;
  steps: PanelStep[];
  canUndo: boolean;
  canRedo: boolean;
}

export type StepKind = "undone" | "redone" | "nothing" | "conflict" | "missing";

export interface StepResult {
  result: StepKind;
  ord: number;
  label: string;
  actor: string;
  newer: number;
  withActor: string;
  withLabel: string;
}

export interface StepGroup {
  key: string;
  actor: string;
  newestAt: number;
  steps: PanelStep[];
}

export const isHuman = (actor: string): boolean => actor === HUMAN_ACTOR;

export function actorName(actor: string, you: string): string {
  if (isHuman(actor)) return you;
  const name = actor.replace(/^agent:?/, "");
  return name || (actor.startsWith("agent") ? "agent" : actor);
}

export function actorColor(actor: string, agents: { actor: string; color: string }[]): string | null {
  if (isHuman(actor)) return null;
  const present = agents.find((a) => a.actor === actor);
  if (present) return present.color;
  let hash = 0;
  for (const ch of actor) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_COLORS[hash % AGENT_COLORS.length]!;
}

export function filterSteps(steps: PanelStep[], mineOnly: boolean): PanelStep[] {
  return mineOnly ? steps.filter((s) => isHuman(s.actor)) : steps;
}

export function groupSteps(steps: PanelStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const last = groups[groups.length - 1];
    if (last && last.actor === step.actor) last.steps.push(step);
    else groups.push({ key: `${step.actor}:${step.id}`, actor: step.actor, newestAt: step.at, steps: [step] });
  }
  return groups;
}

export type HistoryRow = { kind: "header"; group: StepGroup } | { kind: "step"; step: PanelStep; group: StepGroup };

export function flattenGroups(groups: StepGroup[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "header", group });
    for (const step of group.steps) rows.push({ kind: "step", step, group });
  }
  return rows;
}

export function relativeTime(at: number, now: number, nowLabel: string): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return nowLabel;
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function steppedBy(steps: PanelStep[], id: number): PanelStep | undefined {
  return steps.find((s) => s.id === id);
}

export function isStepResult(v: unknown): v is StepResult {
  return typeof v === "object" && v !== null && typeof (v as StepResult).result === "string";
}

export interface ToastSpec {
  message: string;
  tone: "undo" | "info";
  action?: { label: string; run: () => void };
  hint?: string[];
}

export interface ToastText {
  you: string;
  refazer: string;
  viewHistory: string;
  undone(label: string): string;
  undoneOwn(label: string, newer: number): string;
  undoneAgent(label: string, agent: string): string;
  redone(label: string): string;
  nothingMine(agent: string): string;
  nothingAtAll: string;
  nothingToRedo: string;
  conflictUndo: string;
  conflictRedo: string;
  missing: string;
}

export interface ToastHandlers {
  redoStep(id: number): void;
  openHistory(): void;
}

export function toastForStep(res: StepResult, redo: boolean, text: ToastText, h: ToastHandlers, opts: { own: boolean }): ToastSpec {
  const ctrlY = ["Ctrl", "Y"];
  switch (res.result) {
    case "undone": {
      const message = !isHuman(res.actor)
        ? text.undoneAgent(res.label, actorName(res.actor, text.you))
        : opts.own && res.newer > 0
          ? text.undoneOwn(res.label, res.newer)
          : text.undone(res.label);
      return { message, tone: "undo", action: { label: text.refazer, run: () => h.redoStep(res.ord) }, hint: ctrlY };
    }
    case "redone":
      return { message: text.redone(res.label), tone: "undo" };
    case "nothing":
      if (redo) return { message: text.nothingToRedo, tone: "info" };
      return res.actor
        ? { message: text.nothingMine(actorName(res.actor, text.you)), tone: "info", action: { label: text.viewHistory, run: h.openHistory } }
        : { message: text.nothingAtAll, tone: "info" };
    case "conflict":
      return { message: redo ? text.conflictRedo : text.conflictUndo, tone: "info", action: { label: text.viewHistory, run: h.openHistory } };
    default:
      return { message: text.missing, tone: "info" };
  }
}

type NodeMap = Record<string, { parentId?: string | null; type: string } | undefined>;

function topOf(nodes: NodeMap, id: string): string {
  let cur = id;
  for (let guard = 0; guard < 1000; guard++) {
    const parent = nodes[cur]?.parentId;
    if (!parent || !nodes[parent]) break;
    cur = parent;
  }
  return cur;
}

export function pageOfNodes(nodes: NodeMap, ids: string[]): { ids: string[]; pageId: string | null } {
  const present = ids.filter((id) => nodes[id] && nodes[id]!.type !== "page");
  const first = present[0];
  if (!first) return { ids: [], pageId: null };
  const top = topOf(nodes, first);
  return { ids: present.filter((id) => topOf(nodes, id) === top), pageId: nodes[top]?.type === "page" ? top : null };
}
