import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activityActors, toActivityEntries, toPanelActivity, type ActivitySource, type PanelActivity } from "@/adapters/activity";
import type { AgentColor as AgentTone } from "@/adapters/agents";
import type { ActivityEntry } from "@/components/frontends/properties-panel";
import { useLiveClient } from "@/data/live";
import { useAssignTones } from "../collab";
import { shallow, useEditor } from "../editor-store";
import { RelativeTime } from "../relative-time";

const NONE: ActivitySource[] = [];

const pickTones = (tones: Readonly<Record<string, AgentTone>>, actors: readonly string[]) => Object.fromEntries(actors.filter((actor) => actor in tones).map((actor) => [actor, tones[actor] as AgentTone]));

/**
 * The activity shows INSIDE the properties panel (the document panel, with nothing selected), so this region draws
 * nothing itself: `usePanelActivity` hands its entries to `Properties`. While something is selected the hook reads
 * nothing, so a burst of edits does not re-render the panel for a list it is not showing.
 */
export function Activity() {
  return null;
}

/** Shortest gap between two renders of the document panel caused by new activity entries (a burst of edits lists at most ten times a second). */
export const ACTIVITY_REFRESH_MS = 100;

/**
 * The activity list of the live store, or an empty one while `enabled` is false (nothing is read then). A change shows at
 * once when the list has been still for `refreshMs`, otherwise it waits for the rest of the interval and shows the latest list.
 */
export function useThrottledActivity(enabled: boolean, refreshMs = ACTIVITY_REFRESH_MS): readonly ActivitySource[] {
  const store = useLiveClient().store;
  const [list, setList] = useState<readonly ActivitySource[]>(() => (enabled ? store.state.activity : NONE));
  // What the effect compares with, so that mounting (or running again) with nothing new sets no state and renders nothing.
  const shownList = useRef(list);
  shownList.current = list;
  useEffect(() => {
    if (!enabled) {
      if (shownList.current !== NONE) setList(NONE);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shownAt = 0;
    let shown: readonly ActivitySource[] | undefined;
    const show = () => {
      timer = undefined;
      shown = store.state.activity;
      shownAt = Date.now();
      setList(shown);
    };
    const onChange = () => {
      if (store.state.activity === shown) return;
      const wait = shownAt + refreshMs - Date.now();
      if (wait <= 0) {
        clearTimeout(timer);
        show();
      } else if (timer === undefined) timer = setTimeout(show, wait);
    };
    shown = store.state.activity;
    if (shown !== shownList.current) setList(shown);
    const subscription = store.subscribe(onChange);
    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [store, enabled, refreshMs]);
  return enabled ? list : NONE;
}

export function usePanelActivity(enabled: boolean): { activity: readonly ActivityEntry[]; marker: number | undefined } {
  const { t } = useTranslation();
  const list = useThrottledActivity(enabled);
  const actors = useMemo(() => activityActors(list), [list]);
  useAssignTones(actors);
  // Only the tones of the agents in the list: a new client elsewhere (the roster) does not re-render the panel.
  const tones = useEditor((s) => pickTones(s.agentTones, actors), shallow);
  const you = t("app.properties.you");
  const fallback = t("app.properties.editFallback");
  const view = useMemo((): PanelActivity => toPanelActivity(toActivityEntries(list, tones), you, fallback), [list, tones, you, fallback]);
  return useMemo(
    () => ({
      activity: view.rows.map((row): ActivityEntry => ({
        id: row.id,
        author: row.author,
        tone: row.tone,
        label: row.label,
        time: <RelativeTime at={row.at} />,
        undone: row.undone,
        batch: row.batch,
      })),
      marker: view.rows.length > 0 ? view.marker : undefined,
    }),
    [view],
  );
}
