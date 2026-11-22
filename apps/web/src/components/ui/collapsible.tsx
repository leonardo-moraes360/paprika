/** Seção recolhível. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

/**
 * Abre e fecha com a animação de altura do tw-animate-css (`animate-collapsible-down`/`-up`: as chaves
 * do tema geram o utilitário com o prefixo `animate-`, e ela é a animação inteira, então não se soma
 * `animate-in` a ela). A proteção de movimento reduzido está em styles.css.
 */
export function CollapsibleContent({ className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className,
      )}
      {...props}
    />
  );
}
