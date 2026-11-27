import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function SelectionSize({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center justify-center rounded-full bg-select-brand px-2 text-xs leading-[1.4] font-semibold whitespace-nowrap text-on-select-brand forced-colors:border",
        className,
      )}
      {...props}
    />
  );
}
