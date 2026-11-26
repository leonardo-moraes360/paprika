import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneDot, type AgentTone } from "./agent-tone";

export type TeamRowProps = Omit<ComponentProps<"div">, "children"> & {
  tone: Exclude<AgentTone, "select">;
  name: string;
  tool: string;
  page: string;
  idle?: boolean;
};

export function TeamRow({ className, tone, name, tool, page, idle = false, ...props }: TeamRowProps) {
  return (
    <div
      data-idle={idle ? "" : undefined}
      className={cn("flex h-9 w-full items-center gap-2 rounded-md px-2 data-idle:opacity-60", className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full border border-[light-dark(var(--color-field),var(--color-line))] forced-colors:border-[CanvasText]",
          toneDot[tone],
        )}
      />
      <span className="w-16 shrink-0 truncate text-sm font-semibold text-fg">{name}</span>
      <span className="w-27.5 shrink-0 truncate text-xs text-muted">{tool}</span>
      <span className="w-14 shrink-0 truncate text-xs text-muted">{page}</span>
    </div>
  );
}
