import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn, focusRing } from "@/lib/utils";
import type { SidePanelSide } from "./types";

const COLLAPSE_SLACK = 32;

export type ResizeSeparatorProps = {
  side: SidePanelSide;
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  initial: number;
  step: number;
  dragging: boolean;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  onDragChange: (dragging: boolean) => void;
  onCollapse: (width: number) => void;
};

type Drag = { startX: number; startWidth: number; raw: number };

export function ResizeSeparator({
  side,
  label,
  controls,
  value,
  min,
  max,
  initial,
  step,
  dragging,
  onResize,
  onCommit,
  onDragChange,
  onCollapse,
}: ResizeSeparatorProps) {
  const drag = useRef<Drag | null>(null);
  const direction = side === "left" ? 1 : -1;

  useEffect(
    () => () => {
      drag.current = null;
    },
    [],
  );

  const clamp = (width: number) => Math.round(Math.min(max, Math.max(min, width)));

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      return;
    }
    drag.current = { startX: event.clientX, startWidth: value, raw: value };
    onDragChange(true);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.raw = current.startWidth + (event.clientX - current.startX) * direction;
    onResize(clamp(current.raw));
  };

  const end = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    onDragChange(false);
    if (current.raw < min - COLLAPSE_SLACK) onCollapse(current.startWidth);
    else onCommit(clamp(current.raw));
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = (event.shiftKey ? step * 4 : step) * direction;
    const next: Record<string, number> = {
      ArrowRight: value + delta,
      ArrowLeft: value - delta,
      Home: min,
      End: max,
    };
    if (event.key === "Enter") {
      event.preventDefault();
      onCollapse(value);
      return;
    }
    const target = next[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const width = clamp(target);
    if (width === value) return;
    onResize(width);
    onCommit(width);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-dragging={dragging ? "" : undefined}
      data-side={side}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => {
        onResize(initial);
        onCommit(initial);
      }}
      onKeyDown={keys}
      className={cn(
        "group/separator absolute inset-y-0 z-5 flex w-2 cursor-col-resize touch-none justify-center outline-none",
        side === "left" ? "-right-1" : "-left-1",
        `${focusRing} focus-visible:outline-offset-0`,
      )}
    >
      <span
        aria-hidden="true"
        className="h-full w-px bg-line transition-[width,background-color] motion-reduce:transition-none group-hover/separator:w-0.5 group-hover/separator:bg-field group-focus-visible/separator:w-0.5 group-focus-visible/separator:bg-select group-data-dragging/separator:w-0.5 group-data-dragging/separator:bg-select forced-colors:bg-[CanvasText]"
      />
    </div>
  );
}
