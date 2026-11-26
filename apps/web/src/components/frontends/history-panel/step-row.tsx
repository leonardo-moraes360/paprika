import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Ellipsis } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HistoryStep } from "@/components/ui/history-step";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import type { HistoryStepData } from "@/lib/history-model";
import { relativeParts } from "@/lib/relative-time";
import { cn, focusRing } from "@/lib/utils";

type StepRowProps = {
  step: HistoryStepData;
  now: number;
  pending: boolean;
  onSelect: (step: HistoryStepData) => void;
  onUndo: (step: HistoryStepData) => unknown;
  onRedo: (step: HistoryStepData) => unknown;
  onCopy: (step: HistoryStepData) => void;
};

export function StepRow({ step, now, pending, onSelect, onUndo, onRedo, onCopy }: StepRowProps) {
  const { t } = useTranslation();
  const ago = relativeParts(step.at, now);
  const when = t(`frontends.historyPanel.short.${ago.unit}`, { count: ago.count });
  const who = step.author.name;
  const name = step.label || who;
  return (
    <div
      data-step-id={step.id}
      data-undone={step.undone ? "true" : "false"}
      data-author={step.author.agent ? "agent" : "human"}
      className="group/step flex h-full items-center rounded-md transition-colors motion-reduce:transition-none focus-within:bg-surface hover:bg-surface"
    >
      <ButtonPrimitive
        pendingAnnouncement=""
        aria-label={t("frontends.historyPanel.selectStep", { label: name, who, when, undone: step.undone ? t("frontends.historyPanel.undoneSuffix") : "" })}
        aria-busy={pending ? true : undefined}
        onClick={() => onSelect(step)}
        className={cn("min-w-0 flex-1 cursor-pointer rounded-md text-start", focusRing, "focus-visible:-outline-offset-2")}
      >
        <HistoryStep className="hover:bg-transparent" label={name} time={when} undone={step.undone} undoneLabel={t("frontends.historyPanel.undone")} />
      </ButtonPrimitive>
      <Menu pendingAnnouncement={t("common.working")}>
        <MenuTrigger
          render={
            <IconButton
              size="xs"
              aria-label={t("frontends.historyPanel.stepActions", { label: name })}
              className="me-1 opacity-0 group-focus-within/step:opacity-100 group-hover/step:opacity-100 data-open:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuContent align="end" side="bottom">
          {step.undone ? (
            <MenuItem value="redo" onSelect={() => onRedo(step)}>
              {t("frontends.historyPanel.redo")}
            </MenuItem>
          ) : (
            <MenuItem value="undo" onSelect={() => onUndo(step)}>
              {t("frontends.historyPanel.undo")}
            </MenuItem>
          )}
          <MenuItem value="select" disabled={step.nodeIds.length === 0} onSelect={() => onSelect(step)}>
            {t("frontends.historyPanel.selectNodes")}
          </MenuItem>
          <MenuItem value="copy" onSelect={() => onCopy(step)}>
            {t("frontends.historyPanel.copyLabel")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
