import type { ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { PropertiesPanelRegion } from "./store";

/** The body slides open and shut over the measured height (`--collapsible-panel-height`: auto once open), and just appears under reduced motion. */
const panelClassName =
  "flex h-(--collapsible-panel-height) flex-col gap-2 overflow-hidden ps-3.5 pe-5 pb-3.5 transition-[height] duration-200 ease-out motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0";

export type PanelSectionProps = {
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

export function PanelSection({ id, title, defaultOpen = false, actions, children }: PanelSectionProps) {
  const open = PropertiesPanelRegion.useRegion((s) => s.open[id] ?? defaultOpen);
  const actionsApi = PropertiesPanelRegion.useRegionActions();
  return (
    <SectionHeader
      variant="inspector"
      headingLevel={3}
      title={title}
      actions={actions}
      open={open}
      onOpenChange={(next) => actionsApi.setSectionOpen(id, next)}
      className="border-t border-line"
      panelClassName={panelClassName}
    >
      {children}
    </SectionHeader>
  );
}
