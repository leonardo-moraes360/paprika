import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneDot, type AgentColor } from "./agent-tone";

export type TeamRowProps = Omit<ComponentProps<"div">, "children"> & {
  tone: AgentColor;
  name: string;
  tool: string;
  page: string;
  idle?: boolean;
  idleLabel?: string;
};

export function TeamRow({ className, tone, name, tool, page, idle = false, idleLabel, ...props }: TeamRowProps) {
  return (
    <div
      data-idle={idle ? "" : undefined}
      className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 data-idle:opacity-60", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full border border-dot-ring forced-colors:border-[CanvasText]",
          toneDot[tone],
        )}
      />
      <span className="w-16 shrink-0 truncate text-sm font-semibold text-fg">{name}</span>
      <span className="w-27.5 shrink-0 truncate text-xs text-muted">{tool}</span>
      <span className="w-14 shrink-0 truncate text-xs text-muted">{page}</span>
      {idle && idleLabel ? <span className="sr-only">{idleLabel}</span> : null}
    </div>
  );
}
