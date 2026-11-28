import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  illustration?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ className, illustration, title, description, action, ...props }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3.5 rounded-xl border border-line bg-bg px-6 py-8 text-center", className)} {...props}>
      {illustration}
      <p className="text-base font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
