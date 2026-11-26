import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode } from "react";
import { slot } from "@/lib/utils";

export type PanelHandleSide = "left" | "right";

const shapes: Record<PanelHandleSide, string> = {
  left: "rounded-l-none rounded-r-[28px]",
  right: "rounded-l-[28px] rounded-r-none",
};

export type PanelHandleProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children" | "aria-label" | "aria-expanded" | "aria-controls"> & {
  side: PanelHandleSide;
  "aria-label": string;
  expanded: boolean;
  controls: string;
  icon: ReactNode;
};

export function PanelHandle({ side, expanded, controls, icon, className, ...props }: PanelHandleProps) {
  return (
    <ButtonPrimitive
      aria-expanded={expanded}
      aria-controls={controls}
      data-side={side}
      className={slot(
        `inline-flex h-14 w-7 shrink-0 cursor-pointer items-center justify-center border border-line bg-panel text-muted shadow-[0_4px_12px_var(--color-shadow)] transition-colors motion-reduce:transition-none not-data-disabled:hover:border-field not-data-disabled:hover:bg-surface not-data-disabled:hover:text-fg data-disabled:cursor-not-allowed data-disabled:text-field forced-colors:border-2 forced-colors:data-disabled:text-[GrayText] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-2 ${shapes[side]}`,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex">{icon}</span>
    </ButtonPrimitive>
  );
}
