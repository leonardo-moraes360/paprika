import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { PinBadge, PinBubble } from "@/components/ui/pin-bubble";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { relativeParts } from "@/lib/relative-time";
import { useNow } from "@/lib/use-now";
import { cn, focusRing } from "@/lib/utils";
import { targetLabel } from "./pin-target";
import { filterPins, pinCounts } from "./pins-model";
import type { PinEntry, PinFilter, PinsPanelProps } from "./types";

const filters: PinFilter[] = ["open", "resolved", "all"];

export function PinsPanel({ pins, now: nowProp, clock, filter, defaultFilter = "open", onFilterChange, selectedId = null, onSelectPin, onClose, shortcut, className }: PinsPanelProps) {
  const { t } = useTranslation();
  const now = useNow(nowProp, clock);
  const [inner, setInner] = useState<PinFilter>(defaultFilter);
  const current = filter ?? inner;
  const counts = pinCounts(pins);
  const list = filterPins(pins, current);
  const labels: Record<PinFilter, string> = {
    open: t("frontends.pins.filterOpen", { count: counts.open }),
    resolved: t("frontends.pins.filterResolved", { count: counts.resolved }),
    all: t("frontends.pins.filterAll"),
  };
  const change = (next: PinFilter) => {
    if (filter === undefined) setInner(next);
    onFilterChange?.(next);
  };
  const meta = (pin: PinEntry) => {
    const ago = relativeParts(pin.createdAt, now, 30);
    const parts = [pin.author.you ? t("frontends.pins.you") : pin.author.name, t(`frontends.pins.ago.${ago.unit}`, { count: ago.count }), targetLabel(t, pin.target)];
    if (pin.claimedBy) parts.push(pin.claimedBy.name);
    return parts.join(" · ");
  };

  return (
    <PinBubble role="region" aria-label={t("frontends.pins.title")} className={cn("gap-2.5 p-3", className)} data-testid="pins-panel">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-fg">{t("frontends.pins.title")}</h2>
        {shortcut ? (
          <Kbd>{shortcut.join(" ")}</Kbd>
        ) : null}
        <span className="flex-1" />
        {onClose ? (
          <IconButton size="xs" aria-label={t("frontends.pins.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <SegmentedControl stretch aria-label={t("frontends.pins.filter")} value={current} onValueChange={(value) => change(value as PinFilter)}>
        {filters.map((id) => (
          <SegmentedControlItem key={id} value={id}>
            {labels[id]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {list.length === 0 ? (
        <p className="m-0 text-sm text-muted">{t("frontends.pins.empty")}</p>
      ) : (
        <ScrollArea style={{ maxHeight: 360 }} viewportClassName="max-h-[inherit]">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {list.map((pin) => (
              <li key={pin.id}>
                <ButtonPrimitive
                  pendingAnnouncement=""
                  aria-current={pin.id === selectedId ? "true" : undefined}
                  onClick={() => onSelectPin(pin.id)}
                  className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-lg p-2.5 text-start transition-colors motion-reduce:transition-none hover:bg-surface aria-current:bg-surface", focusRing)}
                >
                  <PinBadge number={pin.number} status={pin.status} tone={pin.claimedBy?.tone} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm leading-[1.4] break-words text-fg">{pin.text}</span>
                    <span className="text-xs text-muted">{meta(pin)}</span>
                  </span>
                </ButtonPrimitive>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      <p className="m-0 text-xs leading-[1.4] text-muted">{t("frontends.pins.hint")}</p>
    </PinBubble>
  );
}
