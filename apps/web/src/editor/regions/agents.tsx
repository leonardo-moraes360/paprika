import { useCallback, useMemo } from "react";
import { Agents as AgentsFrontend } from "@/components/frontends/agents";
import { agentPages, presenceActors, toAgentEntries } from "@/adapters/agents";
import { useLive, useLiveClient, type LiveState } from "@/data/live";
import { useAgentTones, useAssignTones } from "../collab";
import { useEditor, useEditorActions } from "../editor-store";

/**
 * Set to `true` when `header.tsx` mounts the roster through `useAgentsHeader` (see below): this region then renders
 * nothing. Until then the roster sits in a floating slot under the header, so the agents are reachable.
 */
export const agentsInHeader = false;

/** The page of each agent as a flat list of strings, so a presence update that moves no agent does not re-render. */
const pagesKey = (s: LiveState) => agentPages(s.doc, s.agents).flatMap((page) => [page.agent, page.pageId, page.pageName]);
const sameStrings = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The roster: the frontend with its own trigger (active count on a clock of its own, so a tick re-renders only this
 * component). `onFocusAgent` has no canvas to fly to: it goes to the agent's page and selects the nodes it touches.
 */
export function AgentsRoster() {
  const agents = useLive((s) => s.agents);
  const pages = useLive(pagesKey, sameStrings);
  const tones = useAgentTones();
  const open = useEditor((s) => s.dialogs.agents);
  const client = useLiveClient();
  const { openDialog, closeDialog, select, setPage } = useEditorActions();
  useAssignTones(useMemo(() => presenceActors(agents), [agents]));
  const entries = useMemo(
    () =>
      toAgentEntries(
        agents,
        tones,
        Array.from({ length: pages.length / 3 }, (_, i) => ({ agent: pages[i * 3]!, pageId: pages[i * 3 + 1]!, pageName: pages[i * 3 + 2]! })),
      ),
    [agents, tones, pages],
  );
  const onOpenChange = useCallback((next: boolean) => (next ? openDialog("agents") : closeDialog("agents")), [openDialog, closeDialog]);
  const onFocusAgent = useCallback(
    (id: string) => {
      const state = client.store.state;
      const presence = state.agents.find((agent) => agent.agent === id);
      const doc = state.doc;
      if (!presence || !doc) return;
      const [page] = agentPages(doc, [presence]);
      if (page) setPage(page.pageId);
      const nodes = presence.nodes.filter((node) => doc.nodes[node]);
      if (nodes.length > 0) select(nodes);
    },
    [client, select, setPage],
  );
  const onOpenPage = useCallback((pageId: string) => setPage(pageId), [setPage]);
  return <AgentsFrontend agents={entries} open={open} onOpenChange={onOpenChange} onFocusAgent={onFocusAgent} onOpenPage={onOpenPage} />;
}

/**
 * For `header.tsx`: `<EditorHeader agents={agents} renderAgents={renderAgents} />`. `agents` is the number of agents the
 * server has reported (it only decides whether the header makes room for them); `renderAgents` ignores the header's own
 * trigger and renders the roster, whose label counts the ones active now.
 */
const renderAgents = () => <AgentsRoster />;
export function useAgentsHeader() {
  const agents = useLive((s) => s.agents.length);
  return { agents, renderAgents };
}

/** Region slot (`editor.tsx`): the roster floats under the header until the header hosts it (`agentsInHeader`). */
export function Agents() {
  const any = useLive((s) => s.agents.length > 0);
  if (agentsInHeader || !any) return null;
  return (
    <div className="fixed end-3 top-14 z-30" data-testid="agents-slot">
      <AgentsRoster />
    </div>
  );
}
