import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("rounded-sm border border-ui-input bg-ui-field px-1 text-2xs font-semibold text-ui-foreground", className)}
      {...props}
    />
  );
}

export function KeyHint({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)} data-testid="key-hint">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}
