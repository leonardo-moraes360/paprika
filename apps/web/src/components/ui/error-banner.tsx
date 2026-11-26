import { TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ErrorBannerProps = Omit<ComponentProps<"div">, "children"> & {
  children: ReactNode;
  action?: ReactNode;
};

export function ErrorBanner({ className, children, action, ...props }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn("flex items-center gap-2.5 rounded-lg border border-red-ink bg-red-soft px-3.5 py-3 text-sm font-semibold text-red-soft-ink forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]", className)}
      {...props}
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
