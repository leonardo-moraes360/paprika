import { Eye } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneSurface, type AgentTone } from "./agent-tone";

export type AgentLabelProps = Omit<ComponentProps<"span">, "children"> & {
  tone: Exclude<AgentTone, "select">;
  status: "writing" | "reading";
  name: string;
  tool: string;
  statusLabel?: string;
};

export function AgentLabel({ className, tone, status, name, tool, statusLabel, ...props }: AgentLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full pr-2.5 pl-2 whitespace-nowrap forced-colors:border",
        toneSurface[tone],
        className,
      )}
      {...props}
    >
      {status === "reading" ? (
        <Eye aria-hidden="true" className="size-3.5 shrink-0 stroke-2" />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5 shrink-0"
        >
          <path d="M12 20h9" />
          <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
        </svg>
      )}
      {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
      <span className="text-xs font-bold">{name}</span>
      <span className="text-xs font-medium">{tool}</span>
    </span>
  );
}
