import { useTranslation } from "react-i18next";
import { HistoryStep } from "@/components/ui/history-step";
import { PanelSection } from "../panel-section";
import type { ActivityEntry } from "../types";

export type ActivitySectionProps = {
  activity: readonly ActivityEntry[];
  marker?: number;
};

export function ActivitySection({ activity, marker }: ActivitySectionProps) {
  const { t } = useTranslation();
  const rows: React.ReactNode[] = [];
  activity.forEach((entry, index) => {
    if (index === marker) rows.push(<Marker key="marker" label={t("frontends.propertiesPanel.activity.now")} />);
    rows.push(
      <li key={entry.id}>
        <HistoryStep
          label={entry.label}
          time={entry.time}
          author={entry.author}
          tone={entry.tone}
          undone={entry.undone}
          undoneLabel={entry.undone ? t("frontends.propertiesPanel.activity.undone") : undefined}
          className={entry.batch ? "outline-1 -outline-offset-1 outline-select" : undefined}
        />
      </li>,
    );
  });
  if (marker !== undefined && marker >= activity.length) rows.push(<Marker key="marker" label={t("frontends.propertiesPanel.activity.now")} />);
  return (
    <PanelSection id="activity" title={t("frontends.propertiesPanel.activity.title")} defaultOpen>
      {activity.length === 0 ? <p className="text-xs text-muted">{t("frontends.propertiesPanel.activity.empty")}</p> : <ul aria-label={t("frontends.propertiesPanel.activity.title")} className="flex flex-col gap-1">{rows}</ul>}
    </PanelSection>
  );
}

function Marker({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs font-bold text-select-ink" aria-label={label}>
      <span aria-hidden="true" className="h-px flex-1 bg-select" />
      <span>{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-select" />
    </li>
  );
}
