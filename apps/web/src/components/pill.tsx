import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-surface text-fg",
  select: "bg-select-pill text-on-select-pill",
  red: "bg-red-soft text-red-soft-ink",
  yellow: "bg-yellow-soft text-yellow-soft-ink",
  green: "bg-green-soft text-green-soft-ink",
  "agent-1": "bg-agent-1 text-agent-1-ink",
  "agent-2": "bg-agent-2 text-agent-2-ink",
  "agent-3": "bg-agent-3 text-agent-3-ink",
  "agent-4": "bg-agent-4 text-agent-4-ink",
};

export type PillProps = ComponentProps<"span"> & {
  tone?: keyof typeof tones;
  icon?: ReactNode;
};

export function Pill({ className, tone = "neutral", icon, children, ...props }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap forced-colors:border",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span aria-hidden="true" className="inline-flex shrink-0 items-center [&_svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  );
}

export function PillDot({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("size-2 rounded-full bg-current", className)} {...props} />;
}
