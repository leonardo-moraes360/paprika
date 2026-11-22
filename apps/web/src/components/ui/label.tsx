/** Rótulo de campo. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "text-xs font-semibold text-ui-muted-foreground select-none peer-disabled:cursor-default peer-disabled:opacity-45",
        className,
      )}
      {...props}
    />
  );
}
