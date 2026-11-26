import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Toggle } from "@ui-sdk/react/toggle";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

const forcedReveal = "[[data-gallery]_.group\\/layer[data-force-hover]_&]:flex";

const toggleBase = `group/toggle hidden size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-muted group-focus-within/layer:flex group-hover/layer:flex data-pressed:flex data-disabled:cursor-not-allowed [&_svg]:size-3.5 [&_svg]:stroke-[1.75] ${focusRing} ${forcedReveal}`;

export type LayerRowProps = Omit<ComponentProps<"div">, "children" | "onSelect"> & {
  name: string;
  icon: ReactNode;
  depth?: number;
  expanded?: boolean;
  selected?: boolean;
  hidden?: boolean;
  locked?: boolean;
  expandLabel: string;
  hideLabel: string;
  lockLabel: string;
  onSelect?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onHiddenChange?: (hidden: boolean) => void;
  onLockedChange?: (locked: boolean) => void;
};

export function LayerRow({
  className,
  name,
  icon,
  depth = 0,
  expanded,
  selected = false,
  hidden = false,
  locked = false,
  expandLabel,
  hideLabel,
  lockLabel,
  onSelect,
  onExpandedChange,
  onHiddenChange,
  onLockedChange,
  ...props
}: LayerRowProps) {
  return (
    <div
      data-selected={selected ? "" : undefined}
      data-hidden={hidden ? "" : undefined}
      data-locked={locked ? "" : undefined}
      className={cn(
        "group/layer flex h-7 items-center gap-1.5 rounded-md pr-2.5 pl-2 transition-colors motion-reduce:transition-none hover:bg-surface data-selected:bg-select-soft forced-colors:data-selected:border-2 forced-colors:data-selected:border-[Highlight]",
        className,
      )}
      {...props}
    >
      {depth > 0 ? <span aria-hidden="true" className="h-px shrink-0" style={{ width: depth * 14 }} /> : null}
      {expanded === undefined ? (
        <span aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <ButtonPrimitive
          aria-label={expandLabel}
          aria-expanded={expanded}
          onClick={() => onExpandedChange?.(!expanded)}
          className={`inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.75] ${focusRing}`}
        >
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </ButtonPrimitive>
      )}
      <ButtonPrimitive
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left text-sm ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-3.5 shrink-0 items-center justify-center text-muted group-data-selected/layer:text-select-soft-ink [&_svg]:size-3.5 [&_svg]:stroke-2"
        >
          {icon}
        </span>
        <span
          className={cn(
            "truncate text-fg group-data-hidden/layer:text-muted group-data-selected/layer:font-semibold group-data-selected/layer:text-select-soft-ink",
          )}
        >
          {name}
        </span>
      </ButtonPrimitive>
      <Toggle aria-label={hideLabel} pressed={hidden} onPressedChange={(next) => onHiddenChange?.(next)} className={toggleBase}>
        <Eye aria-hidden="true" className="group-data-pressed/toggle:hidden" />
        <EyeOff aria-hidden="true" className="hidden group-data-pressed/toggle:block" />
      </Toggle>
      <Toggle
        aria-label={lockLabel}
        pressed={locked}
        onPressedChange={(next) => onLockedChange?.(next)}
        className={cn(toggleBase, "data-pressed:text-red-ink")}
      >
        <LockOpen aria-hidden="true" className="group-data-pressed/toggle:hidden" />
        <Lock aria-hidden="true" className="hidden group-data-pressed/toggle:block" />
      </Toggle>
    </div>
  );
}
