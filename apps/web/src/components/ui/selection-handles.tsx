import type { ComponentProps, PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SelectionSize } from "./selection-size";

export type SelectionCorner = "nw" | "ne" | "sw" | "se";

const corners: Record<SelectionCorner, string> = {
  nw: "-top-[4px] -left-[4px] cursor-nwse-resize",
  ne: "-top-[4px] -right-[4px] cursor-nesw-resize",
  sw: "-bottom-[4px] -left-[4px] cursor-nesw-resize",
  se: "-right-[4px] -bottom-[4px] cursor-nwse-resize",
};

export type SelectionHandlesProps = Omit<ComponentProps<"div">, "children"> & {
  size?: ReactNode;
  onHandlePointerDown?: (corner: SelectionCorner, event: PointerEvent<HTMLSpanElement>) => void;
  /** A rotation knob above the top edge (`data-rotate-handle`); `label` is its tooltip. */
  rotate?: { label: string; onPointerDown?: (event: PointerEvent<HTMLSpanElement>) => void };
};

export function SelectionHandles({ className, size, onHandlePointerDown, rotate, ...props }: SelectionHandlesProps) {
  return (
    <div className={cn("pointer-events-none absolute", className)} {...props}>
      <span aria-hidden="true" className="absolute -inset-[0.75px] border-[1.5px] border-select-brand forced-colors:border-[Highlight]" />
      {(Object.keys(corners) as SelectionCorner[]).map((corner) => (
        <span
          key={corner}
          data-handle={corner}
          aria-hidden="true"
          onPointerDown={onHandlePointerDown ? (event) => onHandlePointerDown(corner, event) : undefined}
          className={cn(
            "pointer-events-auto absolute size-2 rounded-xs border-[1.5px] border-select-brand bg-panel forced-colors:border-[Highlight] forced-colors:bg-[Canvas]",
            corners[corner],
          )}
        />
      ))}
      {rotate ? (
        <>
          <span aria-hidden="true" className="absolute -top-[22px] left-1/2 h-[22px] w-[1.5px] -translate-x-1/2 bg-select-brand forced-colors:bg-[Highlight]" />
          <span
            data-rotate-handle=""
            aria-hidden="true"
            title={rotate.label}
            onPointerDown={rotate.onPointerDown}
            className="pointer-events-auto absolute -top-[28px] left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border-[1.5px] border-select-brand bg-panel active:cursor-grabbing forced-colors:border-[Highlight] forced-colors:bg-[Canvas]"
          />
        </>
      ) : null}
      {size ? <SelectionSize className="absolute top-full left-1/2 mt-2.5 -translate-x-1/2">{size}</SelectionSize> : null}
    </div>
  );
}
