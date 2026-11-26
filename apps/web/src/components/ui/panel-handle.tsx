import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type PanelHandleSide = "start" | "end";

const shapes: Record<PanelHandleSide, string> = {
  start: "rounded-s-none rounded-e-[28px]",
  end: "rounded-s-[28px] rounded-e-none",
};

export type PanelHandleProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children" | "aria-label" | "aria-expanded" | "aria-controls"> & {
  side: PanelHandleSide;
  "aria-label": string;
  expanded: boolean;
  controls: string;
  icon: ReactNode;
};

export function PanelHandle({ side, expanded, controls, icon, className, pendingAnnouncement = "", ...props }: PanelHandleProps) {
  return (
    <ButtonPrimitive
      pendingAnnouncement={pendingAnnouncement}
      aria-expanded={expanded}
      aria-controls={controls}
      data-side={side}
      className={slot(
        `inline-flex h-14 w-7 shrink-0 cursor-pointer items-center justify-center border border-line bg-panel text-muted shadow-handle transition-colors motion-reduce:transition-none not-data-disabled:hover:border-field not-data-disabled:hover:bg-surface not-data-disabled:hover:text-fg data-disabled:cursor-not-allowed data-disabled:text-field forced-colors:border-2 forced-colors:data-disabled:text-[GrayText] ${focusRing} [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-2 ${shapes[side]}`,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex">{icon}</span>
    </ButtonPrimitive>
  );
}
