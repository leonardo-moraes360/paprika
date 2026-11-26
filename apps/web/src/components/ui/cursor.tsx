import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { toneFill, toneSurface, type AgentTone } from "./agent-tone";

export type CursorProps = Omit<ComponentProps<"div">, "children"> & {
  tone?: AgentTone;
  label?: string;
};

export function Cursor({ className, tone = "select", label, ...props }: CursorProps) {
  return (
    <div className={cn("pointer-events-none relative h-11 w-[18px]", className)} {...props}>
      <svg aria-hidden="true" viewBox="0 0 18 22" className="absolute top-0 left-0 h-[22px] w-[18px] overflow-visible">
        <path
          d="M1 1 L1 19 L6 14.5 L9.5 21 L12.5 19.5 L9 13 L16 13 Z"
          strokeWidth={1.5}
          className={cn("stroke-bg forced-colors:stroke-[CanvasText]", toneFill[tone])}
        />
      </svg>
      {label ? (
        <span
          className={cn(
            "absolute top-5 left-4 inline-flex h-6 items-center justify-center rounded-full px-2.5 text-sm leading-[1.4] font-semibold whitespace-nowrap forced-colors:border",
            toneSurface[tone],
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
