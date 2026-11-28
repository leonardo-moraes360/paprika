import { Tooltip as TooltipPrimitive, TooltipArrow, TooltipContent, TooltipShortcut, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn, slot } from "@/lib/utils";

export type TooltipSide = "top" | "right" | "bottom" | "left";

const bodyClasses = "rounded-md bg-fg px-2.5 py-1.5 text-xs leading-[1.4] font-medium whitespace-nowrap text-bg forced-colors:border forced-colors:border-[CanvasText]";

const arrowShapes: Record<TooltipSide, string> = {
  right: "[clip-path:polygon(100%_0,0_50%,100%_100%)]",
  left: "[clip-path:polygon(0_0,100%_50%,0_100%)]",
  bottom: "[clip-path:polygon(0_100%,50%_0,100%_100%)]",
  top: "[clip-path:polygon(0_0,50%_100%,100%_0)]",
};

const arrowBoxes: Record<TooltipSide, string> = {
  right: "h-3 w-1.5",
  left: "h-3 w-1.5",
  bottom: "h-1.5 w-3",
  top: "h-1.5 w-3",
};

const liveArrowClasses =
  "absolute bg-fg forced-colors:bg-[CanvasText] data-[side=right]:h-3 data-[side=right]:w-1.5 data-[side=left]:h-3 data-[side=left]:w-1.5 data-[side=bottom]:h-1.5 data-[side=bottom]:w-3 data-[side=top]:h-1.5 data-[side=top]:w-3 data-[side=right]:[clip-path:polygon(100%_0,0_50%,100%_100%)] data-[side=left]:[clip-path:polygon(0_0,100%_50%,0_100%)] data-[side=bottom]:[clip-path:polygon(0_100%,50%_0,100%_100%)] data-[side=top]:[clip-path:polygon(0_0,50%_100%,100%_0)] data-[side=right]:right-full data-[side=right]:top-(--arrow-offset) data-[side=right]:-translate-y-1/2 data-[side=left]:left-full data-[side=left]:top-(--arrow-offset) data-[side=left]:-translate-y-1/2 data-[side=bottom]:bottom-full data-[side=bottom]:left-(--arrow-offset) data-[side=bottom]:-translate-x-1/2 data-[side=top]:top-full data-[side=top]:left-(--arrow-offset) data-[side=top]:-translate-x-1/2";

export type TooltipProps = Omit<ComponentProps<typeof TooltipPrimitive>, "children"> & {
  content: ReactNode;
  children: ReactElement;
  side?: TooltipSide;
  arrow?: boolean;
  shortcut?: string;
  contentProps?: Omit<ComponentProps<typeof TooltipContent>, "children" | "side">;
};

export function Tooltip({ content, children, side = "top", arrow = true, delay = 400, shortcut, contentProps, ...props }: TooltipProps) {
  const { className, ...rest } = contentProps ?? {};
  return (
    <TooltipPrimitive delay={delay} shortcut={shortcut} {...props}>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        sideOffset={arrow ? 10 : 4}
        className={slot(
          `${bodyClasses} transition-opacity duration-150 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:transition-none`,
          className,
        )}
        {...rest}
      >
        {arrow ? <TooltipArrow className={liveArrowClasses} /> : null}
        {content}
        {shortcut ? <TooltipShortcut className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-bg px-1.5 text-xs leading-none font-semibold text-fg" /> : null}
      </TooltipContent>
    </TooltipPrimitive>
  );
}

export type TooltipBubbleProps = Omit<ComponentProps<"div">, "children"> & {
  children: ReactNode;
  side?: TooltipSide;
  arrow?: boolean;
};

export function TooltipBubble({ children, side = "top", arrow = true, className, ...props }: TooltipBubbleProps) {
  const vertical = side === "top" || side === "bottom";
  const arrowNode = arrow ? <span aria-hidden="true" className={cn("shrink-0 bg-fg forced-colors:bg-[CanvasText]", arrowBoxes[side], arrowShapes[side])} /> : null;
  const before = side === "right" || side === "bottom";
  return (
    <div className={cn("inline-flex items-center", vertical ? "flex-col" : "flex-row", className)} {...props}>
      {before ? arrowNode : null}
      <div className={bodyClasses}>{children}</div>
      {before ? null : arrowNode}
    </div>
  );
}
