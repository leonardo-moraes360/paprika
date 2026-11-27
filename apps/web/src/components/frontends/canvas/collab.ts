import { useSyncExternalStore } from "react";
import type { AgentColor } from "@/components/ui/agent-tone";
import type { Box } from "./types";

/** One agent as the canvas draws it. The owner gives the words (name, verb) already in the person's language. */
export type CanvasAgent = {
  id: string;
  name: string;
  tone: AgentColor;
  /** The tool it called (as the server names it) and what that means, as a short phrase ("editing"). */
  tool: string;
  verb: string;
  activity: "writing" | "reading";
  /** The nodes it touches; the ones that are not on the page in view draw nothing. */
  nodes: readonly string[];
  /** No sign of life for a while: drawn faded and without its tag. */
  idle: boolean;
};

/** A pin that is not resolved. Its box follows the node while the node is on the page; `region` is where it was made. */
export type CanvasPin = {
  id: string;
  number: number;
  status: "open" | "claimed" | "resolved";
  tone?: AgentColor;
  nodeId: string | null;
  pageId: string | null;
  region: Box;
  /** The accessible name of the badge. */
  label: string;
};

/** A node an agent is building right now (the replay of what it created, one node at a time). */
export type CanvasBuildStep = { id: string; tone: AgentColor };

export type CanvasCollab = {
  agents: readonly CanvasAgent[];
  pins: readonly CanvasPin[];
  /** The pin selected in the list. */
  pinId: string | null;
  /** What the person pointed at and is writing a pin for (the node, or an area), with the number the pin will have. */
  pinDraft: { nodeId: string | null; region: Box; number: number } | null;
  build: readonly CanvasBuildStep[];
  /** The tag of a frame an agent is writing in ("working"). */
  working: string;
};

export type CanvasCollabFeed = {
  get: () => CanvasCollab;
  subscribe: (listener: () => void) => () => void;
};

export const emptyCollab = (): CanvasCollab => ({ agents: [], pins: [], pinId: null, pinDraft: null, build: [], working: "" });

/** A collab feed that holds its own state: `set` merges a patch and tells the canvas (keep the identity of a part that did not change). */
export function createCollabStore(initial: Partial<CanvasCollab> = {}): CanvasCollabFeed & { set: (patch: Partial<CanvasCollab>) => void } {
  let current: CanvasCollab = { ...emptyCollab(), ...initial };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (patch) => {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof CanvasCollab)[]) if (!Object.is(current[key], patch[key])) changed = true;
      if (!changed) return;
      current = { ...current, ...patch };
      for (const listener of [...listeners]) listener();
    },
  };
}

const frozen = emptyCollab();
const absent: CanvasCollabFeed = { get: () => frozen, subscribe: () => () => undefined };

/** Reads one slice of the collab state; `select` must return a value that is the same object while nothing in it changed. */
export function useCollab<T>(feed: CanvasCollabFeed | undefined, select: (collab: CanvasCollab) => T): T {
  const source = feed ?? absent;
  return useSyncExternalStore(source.subscribe, () => select(source.get()), () => select(frozen));
}
