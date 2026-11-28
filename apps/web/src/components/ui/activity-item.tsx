import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneDot, type AgentTone } from "./agent-tone";

export type ActivityItemProps = Omit<ComponentProps<"li">, "children"> & {
  tone?: AgentTone | "neutral";
  actor: string;
  label: string;
  time: string;
  dateTime?: string;
  undone?: boolean;
  batch?: boolean;
};

export function ActivityItem({ className, tone = "neutral", actor, label, time, dateTime, undone = false, batch = false, ...props }: ActivityItemProps) {
  return (
    <li
      data-batch={batch ? "" : undefined}
      data-undone={undone ? "" : undefined}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md bg-surface px-2 text-xs data-batch:border data-batch:border-select data-undone:opacity-70",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full forced-colors:border forced-colors:border-[CanvasText]", tone === "neutral" ? "bg-muted" : toneDot[tone])} />
      <span className="shrink-0 font-bold text-fg">{actor}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <time dateTime={dateTime} className="shrink-0 text-muted">
        {time}
      </time>
    </li>
  );
}

export type ActivityMarkerProps = Omit<ComponentProps<"li">, "children"> & { label: string };

export function ActivityMarker({ className, label, ...props }: ActivityMarkerProps) {
  return (
    <li className={cn("flex w-full items-center gap-1.5 text-xs font-bold text-select-soft-ink", className)} {...props}>
      <span aria-hidden="true" className="h-px flex-1 bg-select" />
      <span>{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-select" />
    </li>
  );
}
