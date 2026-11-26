import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneSurface } from "./agent-tone";

const tones = {
  neutral: "bg-surface text-fg",
  select: toneSurface["select-pill"],
  red: "bg-red-soft text-red-soft-ink",
  yellow: "bg-yellow-soft text-yellow-soft-ink",
  green: "bg-green-soft text-green-soft-ink",
  "agent-1": toneSurface["agent-1"],
  "agent-2": toneSurface["agent-2"],
  "agent-3": toneSurface["agent-3"],
  "agent-4": toneSurface["agent-4"],
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
  return <span aria-hidden="true" className={cn("size-2 rounded-full bg-current", className)} {...props} />;
}
