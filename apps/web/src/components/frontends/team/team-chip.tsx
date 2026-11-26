import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, focusRing } from "@/lib/utils";
import { summarizeTeam, type SummaryTone } from "./team-model";
import type { TeamChipProps } from "./types";

const dots: Record<SummaryTone, string> = { ok: "bg-green-ink", warn: "bg-yellow-ink", off: "bg-muted", bad: "bg-red-ink" };

export function TeamChip({ status, onClick, className }: TeamChipProps) {
  const { t } = useTranslation();
  const summary = summarizeTeam(status);
  const label =
    summary.key === "local"
      ? t("frontends.team.chipLocal")
      : summary.key === "relay" || summary.key === "synced"
        ? t(`frontends.team.chip.${summary.key}`, { name: summary.name, count: summary.online })
        : t(`frontends.team.chip.${summary.key}`, { name: summary.name });
  return (
    <Tooltip content={t("frontends.team.chipHint")} side="bottom">
      <ButtonPrimitive
        pendingAnnouncement=""
        onClick={onClick}
        data-tone={summary.tone}
        className={cn(
          "inline-flex h-7 max-w-80 cursor-pointer items-center gap-2 rounded-full border border-field bg-surface px-2.5 text-xs font-semibold text-fg transition-colors motion-reduce:transition-none hover:border-select forced-colors:border-[ButtonBorder]",
          focusRing,
          className,
        )}
      >
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dots[summary.tone])} />
        <span className="truncate">{label}</span>
      </ButtonPrimitive>
    </Tooltip>
  );
}
