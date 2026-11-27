import { memo, useCallback, useMemo } from "react";
import { Agents as AgentsFrontend } from "@/components/frontends/agents";
import { agentPages, presenceActors, toAgentEntries } from "@/adapters/agents";
import { useLive, useLiveClient, type AgentPresence, type LiveState } from "@/data/live";
import { RegionProfiler } from "@/perf";
import { useAgentTones, useAssignTones } from "../collab";
import { useEditor, useEditorActions } from "../editor-store";

/** The page of each agent as a flat list of strings, so a presence update that moves no agent does not re-render. */
const pagesKey = (s: LiveState) => agentPages(s.doc, s.agents).flatMap((page) => [page.agent, page.pageId, page.pageName]);
const sameStrings = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The roster shows how long ago each agent was active in whole seconds (its own clock ticks every second), so a report that only
 * moves `at` forward by less than that changes nothing it shows: an agent that keeps reading nodes does not re-render it. Compared
 * with the value the roster last rendered, so the difference never adds up to a visible one.
 */
const AT_PRECISION_MS = 1000;
export function sameRoster(a: readonly AgentPresence[], b: readonly AgentPresence[]): boolean {
  if (a === b) return true;
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i] as AgentPresence;
      return x.agent === y.agent && x.actor === y.actor && x.tool === y.tool && Math.abs(x.at - y.at) < AT_PRECISION_MS && sameStrings(x.nodes, y.nodes);
    })
  );
}

/**
 * The roster: the frontend with its own trigger (active count on a clock of its own, so a tick re-renders only this
 * component). `onFocusAgent` goes to the agent's page, selects the nodes it touches and flies the canvas camera to them.
 */
export const AgentsRoster = memo(function AgentsRoster() {
  const agents = useLive((s) => s.agents, sameRoster);
  const pages = useLive(pagesKey, sameStrings);
  const tones = useAgentTones();
  const open = useEditor((s) => s.dialogs.agents);
  const client = useLiveClient();
  const { openDialog, closeDialog, select, setPage, focus } = useEditorActions();
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
      if (nodes.length > 0) {
        select(nodes);
        focus({ nodes });
      }
    },
    [client, focus, select, setPage],
  );
  const onOpenPage = useCallback((pageId: string) => setPage(pageId), [setPage]);
  return <AgentsFrontend agents={entries} open={open} onOpenChange={onOpenChange} onFocusAgent={onFocusAgent} onOpenPage={onOpenPage} />;
});

/**
 * For `header.tsx` (`<EditorHeader agents={agents} renderAgents={renderAgents} />`), where the roster lives as in the design. `agents` is the number of agents the
 * server has reported (it only decides whether the header makes room for them); `renderAgents` ignores the header's own
 * trigger and renders the roster, whose label counts the ones active now.
 */
export function useAgentsHeader() {
  const agents = useLive((s) => s.agents.length);
  // One element per editor: a header that re-renders (the name changed) hands React the same element and the roster is not visited.
  const renderAgents = useMemo(() => {
    const roster = (
      <RegionProfiler id="agents">
        <AgentsRoster />
      </RegionProfiler>
    );
    return () => roster;
  }, []);
  return { agents, renderAgents };
}
