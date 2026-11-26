import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type KbdProps = ComponentProps<"kbd">;

export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-field bg-bg px-1.5 font-sans shadow-[0_1px_0_var(--color-field)] text-xs leading-none font-semibold text-fg",
        className,
      )}
      {...props}
    />
  );
}
