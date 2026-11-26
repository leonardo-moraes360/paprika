import { useVirtualizer } from "@tanstack/react-virtual";
import { useHotkey } from "@tanstack/react-hotkeys";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Pill } from "@/components/ui/pill";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { buildHistoryRows, type HistoryStepData } from "@/lib/history-model";
import { copyText } from "@/lib/copy-text";
import { relativeParts } from "@/lib/relative-time";
import { errorText } from "@/lib/use-async-action";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { StepRow } from "./step-row";
import type { HistoryPanelProps } from "./types";

const HEADER_H = 36;
const STEP_H = 34;

export function HistoryPanel({
  steps,
  loading = false,
  now: nowProp,
  clock,
  mineOnly,
  defaultMineOnly = false,
  onMineOnlyChange,
  onUndoStep,
  onRedoStep,
  onSelectNodes,
  onClose,
  shortcut,
  className,
}: HistoryPanelProps) {
  const { t } = useTranslation();
  const now = useNow(nowProp, clock, 15_000);
  const [innerMine, setInnerMine] = useState(defaultMineOnly);
  const only = mineOnly ?? innerMine;
  const [confirming, setConfirming] = useState<HistoryStepData | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => buildHistoryRows(steps, only), [steps, only]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? HEADER_H : STEP_H),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 10,
    initialRect: { width: 360, height: 400 },
  });

  useEffect(() => {
    section.current?.focus();
  }, []);

  const returnTo = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (confirming) {
      returnTo.current = confirming.id;
      return;
    }
    const id = returnTo.current;
    if (id === null) return;
    returnTo.current = null;
    const row = Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-step-id]") ?? []).find((el) => el.dataset.stepId === id);
    (row?.querySelector<HTMLElement>("[aria-haspopup]") ?? section.current)?.focus();
  }, [confirming]);

  useHotkey("Escape", onClose, { target: section, ignoreInputs: false });

  const run = async (id: string, action: () => unknown) => {
    setError(null);
    setPendingId(id);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPendingId(null);
    }
  };

  const undo = (step: HistoryStepData) => {
    if (step.author.agent) {
      setConfirming(step);
      return undefined;
    }
    return run(step.id, () => onUndoStep(step.id));
  };
  const redo = (step: HistoryStepData) => run(step.id, () => onRedoStep(step.id));
  const select = (step: HistoryStepData) => {
    if (step.nodeIds.length > 0) onSelectNodes(step.nodeIds, step.id);
  };
  const long = (at: number) => {
    const ago = relativeParts(at, now);
    return ago.unit === "now" || ago.unit === "seconds" ? t("frontends.historyPanel.fewSeconds") : t(`frontends.historyPanel.long.${ago.unit}`, { count: ago.count });
  };

  return (
    <section
      ref={section}
      tabIndex={-1}
      role="region"
      aria-label={t("frontends.historyPanel.title")}
      className={cn("flex h-full max-h-full w-90 max-w-full flex-col gap-2 rounded-xl border border-line bg-popover p-3 text-fg shadow-popover outline-none", className)}
      data-testid="history-panel"
    >
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-fg">{t("frontends.historyPanel.title")}</h2>
        {shortcut ? (
          <span className="flex gap-1">
            {shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        ) : null}
        <span className="flex-1" />
        <IconButton size="xs" aria-label={t("frontends.historyPanel.close")} onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <SegmentedControl
        stretch
        aria-label={t("frontends.historyPanel.filter")}
        value={only ? "mine" : "all"}
        onValueChange={(value) => {
          if (!value) return;
          const next = value === "mine";
          if (mineOnly === undefined) setInnerMine(next);
          onMineOnlyChange?.(next);
        }}
      >
        <SegmentedControlItem value="all">{t("frontends.historyPanel.all")}</SegmentedControlItem>
        <SegmentedControlItem value="mine">{t("frontends.historyPanel.mine")}</SegmentedControlItem>
      </SegmentedControl>
      <div ref={scroller} role="group" aria-label={t("frontends.historyPanel.list")} aria-busy={loading || undefined} className="min-h-0 flex-1 overflow-auto rounded-sm">
        {rows.length === 0 ? (
          <p className="m-0 p-2 text-sm text-muted">{loading ? "" : only ? t("frontends.historyPanel.emptyMine") : t("frontends.historyPanel.empty")}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div key={item.key} data-index={item.index} className="absolute start-0 top-0 w-full" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                  {row.kind === "header" ? (
                    <h3 className="m-0 flex h-full items-center gap-2 px-2 pt-2 text-xs font-normal text-muted">
                      <Pill tone={row.group.author.agent ? (row.group.author.tone ?? "agent-1") : "select"}>{row.group.author.agent ? row.group.author.name : t("frontends.historyPanel.you")}</Pill>
                      <span>{t("frontends.historyPanel.groupSummary", { count: row.group.steps.length, when: t(`frontends.historyPanel.short.${relativeParts(row.group.newestAt, now).unit}`, { count: relativeParts(row.group.newestAt, now).count }) })}</span>
                    </h3>
                  ) : (
                    <StepRow
                      step={row.step}
                      now={now}
                      pending={pendingId === row.step.id}
                      onSelect={select}
                      onUndo={undo}
                      onRedo={redo}
                      onCopy={(step) => void copyText(step.label)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {error !== null ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-ink">
          {t("frontends.historyPanel.failed", { message: error })}
        </p>
      ) : null}
      <p className="m-0 text-xs leading-[1.4] text-muted">{t("frontends.historyPanel.footer")}</p>
      {confirming ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          pendingAnnouncement={t("common.working")}
          title={t("frontends.historyPanel.confirmTitle", { name: confirming.author.name })}
          description={t("frontends.historyPanel.confirmBody", { label: confirming.label, name: confirming.author.name, when: long(confirming.at) })}
          confirmLabel={t("frontends.historyPanel.confirmAction")}
          cancelLabel={t("frontends.historyPanel.cancel")}
          onConfirm={() => run(confirming.id, () => onUndoStep(confirming.id))}
        />
      ) : null}
    </section>
  );
}
