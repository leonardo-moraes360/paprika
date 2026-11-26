import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MemberRowProps = Omit<ComponentProps<"div">, "children"> & {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

export function MemberRow({ className, avatar, name, subtitle, status, actions, children, ...props }: MemberRowProps) {
  return (
    <div className={cn("flex w-full flex-col gap-1.5 py-2.5", className)} {...props}>
      <div className="flex items-center gap-2.5">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
          {subtitle ? <span className="text-xs leading-[1.4] text-muted">{subtitle}</span> : null}
        </div>
        {status}
      </div>
      {children ? <div className="flex flex-col gap-1.5 ps-9.5">{children}</div> : null}
      {actions ? <div className="flex ps-9.5">{actions}</div> : null}
    </div>
  );
}
