import type { ActivityEntry } from "@/components/frontends/activity";

/** One entry of the live `activity` (see `LiveState`); `kind` is the server's step kind (`undo`, `redo`, `ops`, ...) when the store keeps it. */
export type ActivitySource = { id: number; actor: string; label: string; at: number; kind?: string };

export const ACTIVITY_LIMIT = 15;

const STEP_LABEL = /^(desfazer|refazer|undo|redo):/i;

/** An undo or redo step. The server says so in `kind`; an entry without one falls back to the label prefix the server writes. */
export function isStep(entry: Pick<ActivitySource, "kind" | "label">): boolean {
  if (entry.kind !== undefined) return entry.kind === "undo" || entry.kind === "redo";
  return STEP_LABEL.test(entry.label);
}

/** `user` is you; `agent:claude` is `claude`; anything else (an import, the server) keeps its own name. */
export function actorName(actor: string): string {
  if (actor.startsWith("agent")) return actor.replace(/^agent:?/, "") || "agent";
  return actor;
}

const isAgent = (actor: string) => actor.startsWith("agent");

type AgentColor = "agent-1" | "agent-2" | "agent-3" | "agent-4";
const colors: readonly AgentColor[] = ["agent-1", "agent-2", "agent-3", "agent-4"];

/** The same agent always gets the same of the four tones (a hash of its actor), whatever else is in the list. */
export function agentTone(actor: string): AgentColor {
  let hash = 0;
  for (let i = 0; i < actor.length; i++) hash = (hash * 31 + actor.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length] as AgentColor;
}

const cache = new WeakMap<readonly ActivitySource[], readonly ActivityEntry[]>();

/** Live activity (newest first) to the entries of the `activity` frontend. Memoized by list identity. */
export function toActivityEntries(list: readonly ActivitySource[]): readonly ActivityEntry[] {
  const known = cache.get(list);
  if (known) return known;
  const entries = list.slice(0, ACTIVITY_LIMIT).map((item): ActivityEntry => {
    const you = item.actor === "user";
    return {
      id: String(item.id),
      actor: you ? { name: "", you: true } : { name: actorName(item.actor), tone: isAgent(item.actor) ? agentTone(item.actor) : undefined },
      label: item.label,
      at: item.at,
      step: isStep(item),
    };
  });
  cache.set(list, entries);
  return entries;
}

/** A row of the properties panel's activity section, before its time is drawn (the time is a live clock, so it is not text here). */
export type PanelActivityRow = {
  id: string;
  author: string;
  tone: "select-pill" | "select" | AgentColor;
  label: string;
  at: number;
  undone: boolean;
  batch: boolean;
};

export type PanelActivity = { rows: readonly PanelActivityRow[]; marker: number };

const empty: PanelActivity = { rows: [], marker: 0 };

/**
 * Rows for the panel: you read as `you`, agents carry a tone, undo/redo steps are `undone`, runs of two or more
 * edits by the same author are `batch`, and `marker` is the index of the first real edit (where "now" is drawn).
 */
export function toPanelActivity(entries: readonly ActivityEntry[], youLabel: string, emptyLabel: string): PanelActivity {
  if (entries.length === 0) return empty;
  const flags = entries.map(() => false);
  let i = 0;
  while (i < entries.length) {
    if ((entries[i] as ActivityEntry).step) {
      i++;
      continue;
    }
    const first = (entries[i] as ActivityEntry).actor;
    let j = i + 1;
    while (j < entries.length && !(entries[j] as ActivityEntry).step && (entries[j] as ActivityEntry).actor.name === first.name && (entries[j] as ActivityEntry).actor.you === first.you) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) flags[k] = true;
    i = Math.max(j, i + 1);
  }
  let marker = 0;
  while (marker < entries.length && (entries[marker] as ActivityEntry).step) marker++;
  const rows = entries.map((entry, index): PanelActivityRow => ({
    id: entry.id,
    author: entry.actor.you ? youLabel : entry.actor.name,
    tone: entry.actor.you ? "select-pill" : (entry.actor.tone ?? "select"),
    label: entry.label || emptyLabel,
    at: entry.at,
    undone: entry.step === true,
    batch: flags[index] === true,
  }));
  return { rows, marker };
}
