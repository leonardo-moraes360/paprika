/** Seção recolhível. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

/** Abre/fecha com a animação de altura do tw-animate-css (respeita prefers-reduced-motion em styles.css). */
export function CollapsibleContent({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=closed]:animate-out data-[state=closed]:collapsible-up data-[state=open]:animate-in data-[state=open]:collapsible-down",
        className,
      )}
      {...props}
    />
  );
}
