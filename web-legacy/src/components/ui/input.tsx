import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-7 w-full min-w-0 rounded-md border border-ui-input bg-ui-field px-2 text-sm text-ui-foreground transition-colors outline-none placeholder:text-ui-muted-foreground focus-visible:border-ui-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-ring disabled:cursor-default disabled:opacity-45 file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-ui-foreground",
        "aria-invalid:border-ui-destructive aria-invalid:outline-2 aria-invalid:outline-offset-1 aria-invalid:outline-ui-destructive-text",
        className,
      )}
      {...props}
    />
  );
}
