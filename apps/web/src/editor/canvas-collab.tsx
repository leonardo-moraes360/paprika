import type { Store } from "@tanstack/react-store";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createCollabStore, type CanvasCollabFeed } from "@/components/frontends/canvas";
import { appendBuild, buildSteps, BUILD_TICK_MS, createdInOrder, nextPinNumber, stepBuild, toCanvasAgents, toCanvasPins, type BuildWalk } from "@/adapters/canvas-collab";
import { useLive, useLiveClient, type LiveState } from "@/data/live";
import { usePins, type ServerPin } from "@/data/queries/pins";
import type { AppT } from "@/i18n/resources";
import { useEditor, useEditorStore, type EditorActions, type EditorState } from "./editor-store";

type EditorStore = Store<EditorState, EditorActions>;
type CollabStore = ReturnType<typeof createCollabStore>;

/** How often "who is idle" is looked at again while any agent is shown (nobody sends a message when an agent goes quiet). */
export const COLLAB_TICK_MS = 2000;

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The sentence of what a tool does ("editing"); a tool the app has no sentence for is shown as the server names it. */
export const verbOf = (t: AppT) => (tool: string) => (t as (key: string, options: object) => string)(`app.canvas.collab.verbs.${tool}`, { defaultValue: tool });

/**
 * The presence half of the canvas' collab feed, kept outside React: it reads the live store and the editor store and writes the
 * agents, the build replay and the pin shown as selected into `collab`, each only when it is a different value. A presence
 * heartbeat that changes nothing the canvas draws writes nothing, and nothing here renders a component or commits a node.
 */
export function startCollab(collab: CollabStore, live: Store<LiveState>, editor: EditorStore, t: AppT, now: () => number = () => Date.now()): () => void {
  const verb = verbOf(t);
  let walks: BuildWalk[] = [];
  let doc = live.state.doc;
  let seen = live.state.version;
  let agentsSeen: LiveState["agents"] | null = null;
  let tonesSeen: EditorState["agentTones"] | null = null;
  let buildTimer: ReturnType<typeof setInterval> | undefined;

  const showBuild = () => collab.set({ build: buildSteps(walks, editor.state.agentTones, collab.get().build) });
  const kickBuild = () => {
    if (buildTimer || walks.length === 0) return;
    buildTimer = setInterval(() => {
      walks = stepBuild(walks, now());
      if (walks.length === 0) {
        clearInterval(buildTimer);
        buildTimer = undefined;
      }
      showBuild();
    }, BUILD_TICK_MS);
  };

  const refreshAgents = (force: boolean) => {
    const { agents } = live.state;
    const tones = editor.state.agentTones;
    if (!force && agents === agentsSeen && tones === tonesSeen) return;
    agentsSeen = agents;
    tonesSeen = tones;
    collab.set({ agents: toCanvasAgents(agents, tones, now(), verb, collab.get().agents) });
  };

  const onLive = () => {
    const state = live.state;
    if (state.doc !== doc) {
      const before = doc;
      doc = state.doc;
      const since = seen;
      seen = state.version;
      if (state.doc && before && state.doc.id === before.id) {
        const agentSteps = state.activity.filter((entry) => entry.id > since && entry.actor.startsWith("agent") && entry.kind !== "reload").reverse();
        if (agentSteps.length > 0 && !reducedMotion()) {
          const created = createdInOrder(before, state.doc);
          if (created.length > 0) {
            // One frame may carry the steps of several agents: each one walks what its own step created.
            if (agentSteps.every((entry) => entry.created)) {
              for (const entry of agentSteps) {
                const own = new Set(entry.created);
                walks = appendBuild(walks, entry.actor, created.filter((id) => own.has(id)), now());
              }
            } else {
              const newest = state.activity.find((entry) => entry.id === state.version) ?? state.activity[0];
              if (newest && newest.actor.startsWith("agent") && newest.kind !== "reload") walks = appendBuild(walks, newest.actor, created, now());
            }
            showBuild();
            kickBuild();
          }
        }
      } else if (walks.length > 0) {
        walks = [];
        showBuild();
      }
    }
    refreshAgents(false);
  };
  const onEditor = () => {
    refreshAgents(false);
    collab.set({ pinId: editor.state.pinId });
  };

  onLive();
  onEditor();
  const a = live.subscribe(onLive);
  const b = editor.subscribe(onEditor);
  const tick = setInterval(() => {
    if (live.state.agents.length === 0 && collab.get().agents.length === 0) return;
    refreshAgents(true);
  }, COLLAB_TICK_MS);
  return () => {
    a.unsubscribe();
    b.unsubscribe();
    clearInterval(tick);
    if (buildTimer) clearInterval(buildTimer);
  };
}

const NO_PINS: readonly ServerPin[] = [];

/**
 * The pin half: the pins of the workspace (the query the pins panel reads, so one list), what the person has just pointed at, and
 * the pin selected in the list. It renders nothing, only when a pin or the tones change; the canvas draws them.
 */
function PinsSource({ collab }: { collab: CollabStore }) {
  const { t } = useTranslation();
  const docId = useLive((s) => s.doc?.id ?? "");
  const pins = usePins(docId).data ?? NO_PINS;
  const tones = useEditor((s) => s.agentTones);
  const point = useEditor((s) => s.pinPoint);
  const tool = useEditor((s) => s.tool);
  useEffect(() => {
    const label = (number: number) => t("app.canvas.collab.pinBadge", { number });
    collab.set({ pins: toCanvasPins(pins, tones, label, collab.get().pins) });
  }, [collab, pins, tones, t]);
  useEffect(() => {
    collab.set({ pinDraft: tool === "pin" && point ? { nodeId: point.nodeId, region: point.region, number: nextPinNumber(pins) } : null });
  }, [collab, point, tool, pins]);
  return null;
}

/** Everything the canvas shows about other people and agents: its feed, and the component that keeps the pins in it. */
export function useCanvasCollab(): { collab: CanvasCollabFeed; source: React.ReactNode } {
  const { t } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const store = useMemo(() => createCollabStore(), []);
  useEffect(() => {
    store.set({ working: t("app.canvas.collab.working") });
    return startCollab(store, client.store, editor, t);
  }, [store, client, editor, t]);
  const source = useMemo(() => <PinsSource collab={store} />, [store]);
  return { collab: store, source };
}
