import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { activityActors, toActivityEntries, toPanelActivity, type ActivitySource, type PanelActivity } from "@/adapters/activity";
import type { AgentColor as AgentTone } from "@/adapters/agents";
import type { ActivityEntry } from "@/components/frontends/properties-panel";
import { useLive } from "@/data/live";
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

export function usePanelActivity(enabled: boolean): { activity: readonly ActivityEntry[]; marker: number | undefined } {
  const { t } = useTranslation();
  const list = useLive((state) => (enabled ? state.activity : NONE));
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
