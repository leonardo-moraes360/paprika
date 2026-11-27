import { useEffect } from "react";
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
