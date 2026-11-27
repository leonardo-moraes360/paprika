import { Undo2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneSurface, type AgentTone } from "./agent-tone";

export type HistoryStepProps = Omit<ComponentProps<"div">, "children"> & {
  label: string;
  time: ReactNode;
  author?: string;
  tone?: AgentTone;
  undone?: boolean;
  undoneLabel?: string;
  active?: boolean;
  actions?: ReactNode;
};

export function HistoryStep({
  className,
  label,
  time,
  author,
  tone = "select-pill",
  undone = false,
  undoneLabel,
  active = false,
  actions,
  ...props
}: HistoryStepProps) {
  return (
    <div
      data-active={active ? "" : undefined}
      data-undone={undone ? "" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md pr-1 pl-2 transition-colors motion-reduce:transition-none hover:bg-surface data-active:bg-surface forced-colors:data-active:border-2 forced-colors:data-active:border-[Highlight]",
        className,
      )}
      {...props}
    >
      {author ? (
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-bold forced-colors:border",
            toneSurface[tone],
          )}
        >
          {author}
        </span>
      ) : null}
      {undone ? <Undo2 aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted" /> : null}
      <span className={cn("min-w-0 flex-1 truncate text-sm", undone ? "text-muted" : "text-fg")}>{label}</span>
      {undone && undoneLabel ? <span className="shrink-0 text-xs font-semibold text-muted">{undoneLabel}</span> : null}
      <span className="shrink-0 text-xs text-muted">{time}</span>
      {actions}
    </div>
  );
}
