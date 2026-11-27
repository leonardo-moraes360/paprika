import { useState, useSyncExternalStore } from "react";
import { deriveActiveAgents, noActiveAgents, type ActiveAgents, type AgentTones } from "@/adapters/active-agents";
import { useLiveClient, type LiveState } from "@/data/live";
import { useEditorStore } from "./editor-store";

type EditorReadable = { state: { agentTones: AgentTones }; subscribe: (listener: () => void) => { unsubscribe: () => void } };

/** How often "who is active" is looked at again while someone is (an agent that went quiet drops out without any message). */
export const ACTIVE_AGENTS_TICK_MS = 2000;

type Source = { subscribe: (notify: () => void) => () => void; get: () => ActiveAgents };

type Readable = { state: LiveState; subscribe: (listener: () => void) => { unsubscribe: () => void } };

function createSource(store: Readable, editor: EditorReadable, now: () => number): Source {
  let snapshot = noActiveAgents;
  let agents: LiveState["agents"] | null = null;
  let doc: LiveState["doc"] | undefined;
  let tones: AgentTones | null = null;
  const refresh = (force: boolean) => {
    const { state } = store;
    const given = editor.state.agentTones;
    if (!force && state.agents === agents && given === tones && (state.agents.length === 0 || state.doc === doc)) return false;
    agents = state.agents;
    doc = state.doc;
    tones = given;
    const next = deriveActiveAgents(state.agents, state.doc, now(), snapshot, given);
    const changed = next !== snapshot;
    snapshot = next;
    return changed;
  };
  return {
    get: () => {
      refresh(false);
      return snapshot;
    },
    subscribe: (notify) => {
      const onChange = () => {
        if (refresh(false)) notify();
      };
      const subscription = store.subscribe(onChange);
      const toneSubscription = editor.subscribe(onChange);
      const timer = setInterval(() => {
        if (store.state.agents.length === 0 && snapshot === noActiveAgents) return;
        if (refresh(true)) notify();
      }, ACTIVE_AGENTS_TICK_MS);
      return () => {
        subscription.unsubscribe();
        toneSubscription.unsubscribe();
        clearInterval(timer);
      };
    },
  };
}

/**
 * A slice of who is working where (`ActiveAgents`: which layers and which pages). Each caller keeps its
 * own small source: it re-reads on a presence message or a delta (and every 2 s while someone is active, for the
 * idle timeout) and re-renders only when the slice it picked is a different value, so the pages and the
 * layers do not re-render for a heartbeat that changes nothing for them. `select` must return a stable value.
 */
export function useActiveAgents<T>(select: (agents: ActiveAgents) => T): T {
  const client = useLiveClient();
  const editor = useEditorStore();
  const [source] = useState(() => createSource(client.store, editor, Date.now));
  return useSyncExternalStore(
    source.subscribe,
    () => select(source.get()),
    () => select(noActiveAgents),
  );
}
