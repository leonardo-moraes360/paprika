import { Popover as PopoverPrimitive, PopoverClose, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { slot } from "@/lib/utils";

export const popoverSurfaceClasses =
  "w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-popover p-4 text-fg shadow-popover transition-[opacity,scale] duration-150 motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 forced-colors:border-2";

export type PopoverProps = Omit<ComponentProps<typeof PopoverPrimitive>, "children"> & {
  trigger: ReactElement;
  children?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  side?: ComponentProps<typeof PopoverContent>["side"];
  align?: ComponentProps<typeof PopoverContent>["align"];
  sideOffset?: number;
  contentProps?: Omit<ComponentProps<typeof PopoverContent>, "children" | "side" | "align" | "sideOffset">;
};

export function Popover({ trigger, title, description, children, side = "bottom", align = "start", sideOffset = 8, contentProps, ...props }: PopoverProps) {
  const { className, ...rest } = contentProps ?? {};
  return (
    <PopoverPrimitive {...props}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={slot(`${popoverSurfaceClasses} flex flex-col gap-3`, className)}
        {...rest}
      >
        {title || description ? (
          <div className="flex flex-col gap-1">
            {title ? <PopoverTitle className="text-base font-bold text-fg">{title}</PopoverTitle> : null}
            {description ? <PopoverDescription className="text-sm leading-normal text-muted">{description}</PopoverDescription> : null}
          </div>
        ) : null}
        {children}
      </PopoverContent>
    </PopoverPrimitive>
  );
}

export { PopoverClose };
