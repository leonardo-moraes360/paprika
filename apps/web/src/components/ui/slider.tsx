/** Controle deslizante. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-ui-muted">
        <SliderPrimitive.Range className="absolute h-full bg-ui-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className="block h-3.5 w-3.5 cursor-pointer rounded-full border-2 border-ui-primary bg-ui-card transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring disabled:cursor-default disabled:pointer-events-none disabled:opacity-45"
      />
    </SliderPrimitive.Root>
  );
}
