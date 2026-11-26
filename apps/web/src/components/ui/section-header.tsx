import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

const titles = {
  panel: "text-xs font-bold tracking-[0.8px] text-muted uppercase",
  inspector: "text-sm font-semibold text-fg group-data-closed/section:text-muted",
};

export type SectionHeaderProps = Omit<ComponentProps<typeof Collapsible>, "children" | "title"> & {
  title: ReactNode;
  variant?: keyof typeof titles;
  actions?: ReactNode;
  children?: ReactNode;
  panelClassName?: string;
};

export function SectionHeader({ className, title, variant = "panel", actions, children, panelClassName, ...props }: SectionHeaderProps) {
  return (
    <Collapsible className={className} {...props}>
      <div className="flex h-9 items-center gap-1.5 pr-2 pl-2.5">
        <CollapsibleTrigger
          className={cn(
            "group/section flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md",
            focusRing,
          )}
        >
          <ChevronDown aria-hidden="true" className="hidden size-3.5 shrink-0 stroke-[1.75] text-muted group-data-open/section:block" />
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted group-data-open/section:hidden" />
          <span className={cn("truncate text-left", titles[variant])}>
            {title}
          </span>
        </CollapsibleTrigger>
        {actions ? <div className="flex h-6 shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      {children ? <CollapsiblePanel className={panelClassName}>{children}</CollapsiblePanel> : null}
    </Collapsible>
  );
}
