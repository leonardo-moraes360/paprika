import { useEffect } from "react";
import { presenceActors } from "@/adapters/agents";
import { useLiveClient } from "@/data/live";
import { useEditor, useEditorActions } from "./editor-store";

/** Tones of the agent clients, kept by the editor (see `assignAgentTones`). Changes only when a new client shows up. */
export const useAgentTones = () => useEditor((s) => s.agentTones);

/** Makes sure each actor has a tone. The list may be a new array on every render: only its content matters. */
export function useAssignTones(actors: readonly string[]) {
  const { assignAgentTones } = useEditorActions();
  const key = actors.join("\u0000");
  useEffect(() => {
    if (key) assignAgentTones(key.split("\u0000"));
  }, [assignAgentTones, key]);
}

/**
 * Gives a tone to every client that reports presence (the roster, the layers and the pages all read the same tones).
 * It listens to the live store itself instead of rendering, so the tone lands in the same React batch as the presence
 * that brought the client: one commit, not one for the arrival and one for the tone.
 */
export function useAssignPresenceTones() {
  const client = useLiveClient();
  const { assignAgentTones } = useEditorActions();
  useEffect(() => {
    let last: unknown = null;
    const check = () => {
      const { agents } = client.store.state;
      if (agents === last) return;
      last = agents;
      if (agents.length > 0) assignAgentTones(presenceActors(agents));
    };
    check();
    return client.store.subscribe(check).unsubscribe;
  }, [client, assignAgentTones]);
}
