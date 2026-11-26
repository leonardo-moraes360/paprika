import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SpinnerProps = Omit<ComponentProps<"span">, "children"> & {
  label?: string;
};

export function Spinner({ className, label, ...props }: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-select border-t-transparent motion-reduce:animate-none forced-colors:border-[Highlight] forced-colors:border-t-transparent", className)}
      {...props}
    />
  );
}
