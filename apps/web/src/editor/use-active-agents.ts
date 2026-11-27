import { useState, useSyncExternalStore } from "react";
import { deriveActiveAgents, noActiveAgents, type ActiveAgents } from "@/adapters/active-agents";
import { useLiveClient, type LiveState } from "@/data/live";

/** How often "who is active" is looked at again while someone is (an agent that went quiet drops out without any message). */
export const ACTIVE_AGENTS_TICK_MS = 2000;

type Source = { subscribe: (notify: () => void) => () => void; get: () => ActiveAgents };

type Readable = { state: LiveState; subscribe: (listener: () => void) => { unsubscribe: () => void } };

function createSource(store: Readable, now: () => number): Source {
  let snapshot = noActiveAgents;
  let agents: LiveState["agents"] | null = null;
  let doc: LiveState["doc"] | undefined;
  const refresh = (force: boolean) => {
    const { state } = store;
    if (!force && state.agents === agents && (state.agents.length === 0 || state.doc === doc)) return false;
    agents = state.agents;
    doc = state.doc;
    const next = deriveActiveAgents(state.agents, state.doc, now(), snapshot);
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
      const subscription = store.subscribe(() => {
        if (refresh(false)) notify();
      });
      const timer = setInterval(() => {
        if (store.state.agents.length === 0 && snapshot.count === 0) return;
        if (refresh(true)) notify();
      }, ACTIVE_AGENTS_TICK_MS);
      return () => {
        subscription.unsubscribe();
        clearInterval(timer);
      };
    },
  };
}

/**
 * A slice of who is working where (`ActiveAgents`: how many agents, which layers, which pages). Each caller keeps its
 * own small source: it re-reads on a presence message or a delta (and every 2 s while someone is active, for the
 * idle timeout) and re-renders only when the slice it picked is a different value, so the header, the pages and the
 * layers do not re-render for a heartbeat that changes nothing for them. `select` must return a stable value.
 */
export function useActiveAgents<T>(select: (agents: ActiveAgents) => T): T {
  const client = useLiveClient();
  const [source] = useState(() => createSource(client.store, Date.now));
  return useSyncExternalStore(
    source.subscribe,
    () => select(source.get()),
    () => select(noActiveAgents),
  );
}
