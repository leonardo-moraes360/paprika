import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneDot, toneSurface, type AgentColor } from "./agent-tone";

export type PinBubbleProps = ComponentProps<"div">;

export function PinBubble({ className, ...props }: PinBubbleProps) {
  return <div className={cn("flex w-80 max-w-full flex-col gap-3 rounded-xl border border-line bg-popover p-4 text-fg shadow-popover", className)} {...props} />;
}

export type PinReplyProps = Omit<ComponentProps<"div">, "children"> & {
  tone: AgentColor | "you";
  author: string;
  time: string;
  children: ReactNode;
};

export function PinReply({ className, tone, author, time, children, ...props }: PinReplyProps) {
  return (
    <div className={cn("flex w-full flex-col gap-1 ps-2.5", className)} {...props}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full forced-colors:border forced-colors:border-[CanvasText]", tone === "you" ? "bg-select-brand" : toneDot[tone])} />
        <span className="truncate text-sm font-semibold text-fg">{author}</span>
        <span className="shrink-0 text-sm text-muted">{time}</span>
      </div>
      <p className="m-0 text-sm leading-[1.45] break-words whitespace-pre-wrap text-fg">{children}</p>
    </div>
  );
}

const badgeStatuses = {
  open: "bg-action text-on-action",
  resolved: "bg-green-ink text-on-green",
};

export type PinBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  number: number | string;
  status?: "open" | "claimed" | "resolved";
  tone?: AgentColor;
};

export function PinBadge({ className, number, status = "open", tone = "agent-1", ...props }: PinBadgeProps) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border-2 border-pin-ring text-xs font-bold forced-colors:border-[CanvasText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]",
        status === "claimed" ? toneSurface[tone] : badgeStatuses[status],
        className,
      )}
      {...props}
    >
      {number}
    </span>
  );
}
