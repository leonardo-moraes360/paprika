/** Botão ligado/desligado (ferramenta). Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Toggle as TogglePrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

export const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring disabled:cursor-default disabled:pointer-events-none disabled:opacity-45 data-[state=on]:bg-ui-accent data-[state=on]:text-ui-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground",
        outline: "border border-ui-input bg-transparent text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground",
      },
      size: {
        xs: "h-6 min-w-6 gap-1 rounded-sm px-1.5 text-2xs",
        sm: "h-7 min-w-7 px-2 text-xs",
        default: "h-8 min-w-8 px-2.5",
        lg: "h-9 min-w-9 px-3 text-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Toggle({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
  );
}
