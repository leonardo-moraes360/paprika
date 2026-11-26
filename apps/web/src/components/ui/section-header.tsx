import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

const titles = {
  panel: "text-xs font-bold tracking-[0.8px] text-muted uppercase",
  inspector: "text-sm font-semibold text-fg group-data-closed/section:text-muted",
};

export type SectionHeaderProps = Omit<ComponentProps<typeof Collapsible>, "children" | "title" | "className"> & {
  className?: string;
  title: ReactNode;
  variant?: keyof typeof titles;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  actions?: ReactNode;
  children?: ReactNode;
  panelClassName?: string;
};

export function SectionHeader({ className, title, variant = "panel", headingLevel, actions, children, panelClassName, ...props }: SectionHeaderProps) {
  const Heading: ElementType = headingLevel ? `h${headingLevel}` : "div";
  if (!children) {
    return (
      <div className={className}>
        <div className="flex h-9 items-center gap-1.5 pr-2 pl-2.5">
          <Heading className={cn("min-w-0 flex-1 truncate", titles[variant])}>{title}</Heading>
          {actions ? <div className="flex h-6 shrink-0 items-center gap-0.5">{actions}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <Collapsible className={className} {...props}>
      <div className="flex h-9 items-center gap-1.5 pr-2 pl-2.5">
        <Heading className="flex h-full min-w-0 flex-1">
          <CollapsibleTrigger
            className={cn(
              "group/section flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md",
              focusRing,
            )}
          >
            <ChevronDown aria-hidden="true" className="hidden size-3.5 shrink-0 stroke-[1.75] text-muted group-data-open/section:block" />
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted group-data-open/section:hidden" />
            <span className={cn("truncate text-left", titles[variant])}>{title}</span>
          </CollapsibleTrigger>
        </Heading>
        {actions ? <div className="flex h-6 shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      <CollapsiblePanel className={panelClassName}>{children}</CollapsiblePanel>
    </Collapsible>
  );
}
