import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  green: "bg-green-soft text-green-soft-ink",
  yellow: "bg-yellow-soft text-yellow-soft-ink",
  red: "bg-red-soft text-red-soft-ink",
  select: "bg-select-soft text-select-soft-ink",
  neutral: "bg-surface text-muted",
};

export type TagProps = ComponentProps<"span"> & {
  tone?: keyof typeof tones;
};

export function Tag({ className, tone = "neutral", ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap forced-colors:border",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
