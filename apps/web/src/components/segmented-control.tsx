import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type SegmentedControlProps = ComponentProps<typeof SegmentedControlPrimitive>;

export function SegmentedControl({ className, children, ...props }: SegmentedControlProps) {
  return (
    <SegmentedControlPrimitive
      className={(state) =>
        cn(
          "relative isolate inline-flex gap-1 rounded-md border border-border bg-muted p-1",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    >
      {(state) => (
        <>
          <SegmentedControlIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-sm border border-border-strong bg-background transition-[top,left,width,height] duration-200 motion-reduce:transition-none data-[activation-direction=none]:transition-none forced-colors:border-2 forced-colors:border-[Highlight]" />
          {typeof children === "function" ? children(state) : children}
        </>
      )}
    </SegmentedControlPrimitive>
  );
}

export function SegmentedControlItem({ className, ...props }: ComponentProps<typeof SegmentedControlItemPrimitive>) {
  return (
    <SegmentedControlItemPrimitive
      className={(state) =>
        cn(
          "inline-flex h-8 cursor-pointer items-center rounded-sm px-3 text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:font-semibold data-checked:text-foreground",
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}
