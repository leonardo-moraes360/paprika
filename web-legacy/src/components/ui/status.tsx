import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

export const statusDotVariants = cva("size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      ok: "bg-leaf",
      alert: "bg-accent",
      idle: "bg-ui-muted-foreground",
    },
  },
  defaultVariants: { tone: "ok" },
});

export function StatusLiveRegion({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status"
      data-tone={tone ?? "ok"}
      role="status"
      aria-live="polite"
      className={cn("sr-only", className)}
      {...props}
    />
  );
}
