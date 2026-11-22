import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { cn } from "../lib/cn";
import { sectionOpen, setSectionOpen } from "./sectionState";

interface Props {
  id: string;
  title: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function InspectorSection({ id, title, defaultOpen = false, badge, children }: Props) {
  const [open, setOpen] = useState(() => sectionOpen(id, defaultOpen));
  const bodyId = `inspector-section-${id}`;
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSectionOpen(id, next);
      }}
      className="min-w-0 border-t border-ui-border pt-1 first:border-t-0 first:pt-0"
      data-testid={`inspector-section-${id}`}
    >
      <CollapsibleTrigger
        type="button"
        className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-0.5 text-xs font-semibold text-ui-muted-foreground outline-none hover:text-ui-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
        aria-controls={bodyId}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-ui-muted-foreground transition-transform", open && "rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {badge}
      </CollapsibleTrigger>
      <CollapsibleContent id={bodyId} className="grid gap-1 pb-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
