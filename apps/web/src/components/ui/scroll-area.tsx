import {
  ScrollArea as ScrollAreaPrimitive,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from "@ui-sdk/react/scroll-area";
import type { ComponentProps, Ref } from "react";
import { cn, focusRing } from "@/lib/utils";

export type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive> & {
  label?: string;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
};

export function ScrollArea({ className, viewportClassName, viewportRef, label, children, type = "auto", ...props }: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive type={type} className={cn("relative min-h-0 overflow-hidden", className)} {...props}>
      <ScrollAreaViewport ref={viewportRef} role={label ? "region" : undefined} aria-label={label} className={cn("size-full rounded-sm", focusRing, viewportClassName)}>
        <ScrollAreaContent>{children}</ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar
        orientation="vertical"
        className="absolute inset-y-0 right-0 w-1.5 rounded-[3px] bg-line transition-opacity motion-reduce:transition-none not-data-visible:opacity-0 forced-colors:border forced-colors:bg-[Canvas]"
      >
        <ScrollAreaThumb className="w-full rounded-[3px] bg-field forced-colors:bg-[CanvasText]" />
      </ScrollAreaScrollbar>
    </ScrollAreaPrimitive>
  );
}
