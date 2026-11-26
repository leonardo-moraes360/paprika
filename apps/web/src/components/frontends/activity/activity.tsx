import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ActivityItem, ActivityMarker } from "@/components/ui/activity-item";
import { relativeParts } from "@/lib/relative-time";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { batchFlags, markerIndex } from "./activity-model";
import type { ActivityProps } from "./types";

export function Activity({ entries, now: nowProp, clock, limit = 15, className }: ActivityProps) {
  const { t } = useTranslation();
  const now = useNow(nowProp, clock);
  const shown = entries.slice(0, limit);

  if (shown.length === 0) return <p className={cn("m-0 text-sm text-muted", className)}>{t("frontends.activity.empty")}</p>;

  const mark = markerIndex(shown);
  const batched = batchFlags(shown);
  const marker = <ActivityMarker key="marker" label={t("frontends.activity.now")} aria-label={t("frontends.activity.position")} data-testid="activity-marker" />;

  return (
    <ul className={cn("m-0 flex list-none flex-col gap-1 p-0", className)} aria-label={t("frontends.activity.title")} data-testid="activity-list">
      {shown.map((entry, index) => {
        const ago = relativeParts(entry.at, now);
        return (
          <Fragment key={entry.id}>
            {index === mark ? marker : null}
            <ActivityItem
              data-testid="activity-row"
              tone={entry.actor.you ? "select-pill" : (entry.actor.tone ?? "agent-1")}
              actor={entry.actor.you ? t("frontends.activity.you") : entry.actor.name}
              label={entry.label}
              time={t(`frontends.activity.ago.${ago.unit}`, { count: ago.count })}
              dateTime={new Date(entry.at).toISOString()}
              undone={entry.step}
              batch={batched[index]}
            />
          </Fragment>
        );
      })}
      {mark >= shown.length ? marker : null}
    </ul>
  );
}
