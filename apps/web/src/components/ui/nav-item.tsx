import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing, slot } from "@/lib/utils";

export type NavItemProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  level?: 0 | 1;
  expanded?: boolean;
  trailing?: ReactNode;
};

export function NavItem({ className, label, icon, active = false, level = 0, expanded, trailing, pendingAnnouncement = "", ...props }: NavItemProps) {
  return (
    <ButtonPrimitive
      pendingAnnouncement={pendingAnnouncement}
      aria-current={active ? "page" : undefined}
      aria-expanded={expanded}
      data-active={active ? "" : undefined}
      className={slot(
        cn(
          "relative flex h-8 w-full cursor-pointer items-center gap-2 rounded-md pr-2 pl-2.5 text-left text-sm text-fg transition-colors motion-reduce:transition-none not-data-disabled:hover:bg-surface data-active:bg-surface data-disabled:cursor-not-allowed data-disabled:text-muted forced-colors:data-active:border-2 forced-colors:data-active:border-[Highlight]",
          focusRing,
        ),
        className,
      )}
      {...props}
    >
      {active ? <span aria-hidden="true" className="absolute top-2 left-0 h-4 w-[3px] rounded-xs bg-red" /> : null}
      {level === 1 ? <span aria-hidden="true" className="h-px w-5.5 shrink-0" /> : null}
      {expanded === undefined ? null : expanded ? (
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted" />
      ) : (
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted" />
      )}
      {icon ? (
        <span aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center text-muted [&_svg]:size-4 [&_svg]:stroke-[1.75]", active && "text-fg")}>
          {icon}
        </span>
      ) : null}
      <span className={cn("min-w-0 flex-1 truncate", active && "font-semibold")}>{label}</span>
      {trailing ? <span className="shrink-0 text-xs font-semibold text-muted">{trailing}</span> : null}
    </ButtonPrimitive>
  );
}
