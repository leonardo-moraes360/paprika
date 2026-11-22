/**
 * Dica de ferramenta. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005: no upstream o
 * balão é preenchido com `primary`; no Paprika ele é uma superfície `ui-popover` com borda, como no board.
 * O Radix abre no hover e também no foco do gatilho (WCAG 1.4.13); Esc fecha.
 */
import type { ComponentProps, ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-max max-w-[240px] rounded-sm border border-ui-border bg-ui-popover px-2 py-1 text-xs text-ui-popover-foreground shadow-float",
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 origin-(--radix-tooltip-content-transform-origin)",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Substitui o atributo HTML `title`: hover e foco abrem o balão; Esc fecha. Sem `label`, devolve o filho. */
export function Hint({
  label,
  children,
  side = "top",
}: {
  label: string | undefined | null;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipContent>["side"];
}) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
