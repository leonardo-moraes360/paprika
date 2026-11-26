import { Bot } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneDot, type AgentTone } from "./agent-tone";

const dots: AgentTone[] = ["agent-1", "agent-2", "agent-3", "agent-4"];

const MAX = 5;

export type AgentStackProps = Omit<ComponentProps<"span">, "children"> & {
  count: number;
  label: string;
};

export function AgentStack({ className, count, label, ...props }: AgentStackProps) {
  const many = count > MAX;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-block h-4 w-12.5 shrink-0", className)} {...props}>
      {many ? (
        <span className="absolute inset-0 inline-flex items-center justify-center gap-1 rounded-lg border border-field bg-surface text-xs leading-[1.1] font-bold text-fg">
          <Bot aria-hidden="true" className="size-3 stroke-[1.75]" />
          {count}
        </span>
      ) : (
        Array.from({ length: Math.max(0, count) }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn("absolute top-[0.25px] size-[15.5px] rounded-full border-[1.5px] border-panel forced-colors:border-[Canvas]", toneDot[dots[i % 4] ?? "agent-1"])}
            style={{ left: i * 9 - 0.75, zIndex: MAX - i }}
          />
        ))
      )}
    </span>
  );
}
