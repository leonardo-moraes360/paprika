import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps } from "react";
import { cn, focusRing, slot } from "@/lib/utils";

export type SegmentedControlProps = ComponentProps<typeof SegmentedControlPrimitive> & {
  stretch?: boolean;
  indicatorClassName?: string;
};

export function SegmentedControl({ className, children, stretch = false, indicatorClassName, ...props }: SegmentedControlProps) {
  return (
    <SegmentedControlPrimitive
      className={slot(
        cn(
          "group/seg relative isolate inline-flex h-7.5 items-center gap-0.5 rounded-md border border-field bg-bg px-0.5 data-disabled:border-line data-disabled:bg-surface",
          stretch && "flex w-full *:data-[slot=segmented-control-item]:flex-1",
        ),
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          <SegmentedControlIndicator
            className={cn(
              "invisible group-has-[input:checked]/seg:visible absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-sm border border-field bg-surface transition-[top,left,width,height] duration-200 motion-reduce:transition-none data-[activation-direction=none]:transition-none forced-colors:border-2 forced-colors:border-[Highlight]",
              indicatorClassName,
            )}
          />
          {typeof children === "function" ? children(state) : children}
        </>
      )}
    </SegmentedControlPrimitive>
  );
}

export type SegmentedControlItemProps = ComponentProps<typeof SegmentedControlItemPrimitive> & {
  iconOnly?: boolean;
};

export function SegmentedControlItem({ className, iconOnly = false, ...props }: SegmentedControlItemProps) {
  return (
    <SegmentedControlItemPrimitive
      className={slot(
        cn(
          "inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-transparent text-xs font-medium whitespace-nowrap text-muted transition-colors motion-reduce:transition-none hover:text-fg data-checked:font-semibold data-checked:text-fg data-disabled:cursor-not-allowed data-disabled:text-field data-disabled:hover:text-field [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          focusRing,
          iconOnly ? "w-7" : "px-3",
        ),
        className,
      )}
      {...props}
    />
  );
}
