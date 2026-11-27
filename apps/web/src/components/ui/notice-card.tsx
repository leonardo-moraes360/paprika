import { TriangleAlert, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { StatusIcon, type Status } from "./status-icon";

const bands = {
  warning: "border-yellow-ink bg-yellow-soft text-yellow-soft-ink",
  danger: "border-red-ink bg-red-soft text-red-soft-ink",
  success: "border-green-ink bg-green-soft text-green-soft-ink",
  info: "border-select bg-select-soft text-select-soft-ink",
  // The in-progress strip ("Opening workspace…"): no alarm colour, the page background inside a hairline.
  neutral: "border-line bg-bg text-fg",
};

const forcedColors = "forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]";

export type NoticeCardProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  variant?: "card" | "band";
  status?: Status | "neutral";
  leading?: ReactNode;
  closeLabel?: string;
  onClose?: () => void;
  actions?: ReactNode;
};

export function NoticeCard({ className, title, variant = "card", status = "info", leading, closeLabel, onClose, actions, children, ...props }: NoticeCardProps) {
  const band = variant === "band";
  // A band with no body is the one-line strip of the design (list or action failed): icon, message and the action on the same row.
  if (band && !children) {
    return (
      <div className={cn("flex w-full items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm font-semibold", bands[status], forcedColors, className)} {...props}>
        {leading ?? <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />}
        <div className="min-w-0 flex-1">{title}</div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        {onClose && closeLabel ? (
          <IconButton size="xs" aria-label={closeLabel} onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border p-3",
        band ? bands[status] : "border-line bg-popover text-fg shadow-popover",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        {leading ?? (band && status !== "neutral" ? <StatusIcon status={status} size="md" className="bg-transparent" /> : null)}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className={cn("text-sm", band ? "font-bold" : "font-normal text-fg")}>{title}</div>
          {children ? <div className={cn("text-sm leading-[1.45]", band ? "text-fg" : "text-muted")}>{children}</div> : null}
        </div>
        {onClose && closeLabel ? (
          <IconButton size="xs" aria-label={closeLabel} onClick={onClose} className="-me-1 -mt-0.5">
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
