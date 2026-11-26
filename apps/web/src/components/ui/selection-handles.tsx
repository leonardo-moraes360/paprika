import type { ComponentProps, PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SelectionSize } from "./selection-size";

export type SelectionCorner = "nw" | "ne" | "sw" | "se";

const corners: Record<SelectionCorner, string> = {
  nw: "-top-[4.75px] -left-[4.75px] cursor-nwse-resize",
  ne: "-top-[4.75px] -right-[4.75px] cursor-nesw-resize",
  sw: "-bottom-[4.75px] -left-[4.75px] cursor-nesw-resize",
  se: "-right-[4.75px] -bottom-[4.75px] cursor-nwse-resize",
};

export type SelectionHandlesProps = Omit<ComponentProps<"div">, "children"> & {
  size?: ReactNode;
  onHandlePointerDown?: (corner: SelectionCorner, event: PointerEvent<HTMLSpanElement>) => void;
};

export function SelectionHandles({ className, size, onHandlePointerDown, ...props }: SelectionHandlesProps) {
  return (
    <div className={cn("pointer-events-none absolute", className)} {...props}>
      <span aria-hidden="true" className="absolute -inset-[0.75px] border-[1.5px] border-select forced-colors:border-[Highlight]" />
      {(Object.keys(corners) as SelectionCorner[]).map((corner) => (
        <span
          key={corner}
          data-handle={corner}
          aria-hidden="true"
          onPointerDown={onHandlePointerDown ? (event) => onHandlePointerDown(corner, event) : undefined}
          className={cn(
            "pointer-events-auto absolute size-[9.5px] rounded-xs border-[1.5px] border-select bg-panel forced-colors:border-[Highlight] forced-colors:bg-[Canvas]",
            corners[corner],
          )}
        />
      ))}
      {size ? <SelectionSize className="absolute top-full left-1/2 mt-2.5 -translate-x-1/2">{size}</SelectionSize> : null}
    </div>
  );
}
