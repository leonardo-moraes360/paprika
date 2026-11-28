import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type DragOverlayMode = "none" | "line" | "ring";

export type DragOverlayProps = Omit<ComponentProps<"div">, "children"> & {
  mode?: DragOverlayMode;
};

export function DragOverlay({ className, mode = "none", ...props }: DragOverlayProps) {
  return (
    <div
      aria-hidden="true"
      data-mode={mode}
      className={cn(
        "pointer-events-none absolute end-1 start-(--drop-start,0.25rem) top-(--drop-top,0) hidden data-[mode=line]:block data-[mode=line]:h-0.5 data-[mode=line]:-translate-y-px data-[mode=line]:rounded-xs data-[mode=line]:bg-select data-[mode=ring]:block data-[mode=ring]:h-(--drop-height,1.75rem) data-[mode=ring]:rounded-md data-[mode=ring]:border-[1.5px] data-[mode=ring]:border-select forced-colors:data-[mode=line]:bg-[Highlight] forced-colors:data-[mode=ring]:border-[Highlight]",
        className,
      )}
      {...props}
    />
  );
}
