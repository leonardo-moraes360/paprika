import type { ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { PropertiesPanelRegion } from "./store";

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
      panelClassName="flex flex-col gap-2 px-3.5 pb-3.5"
    >
      {children}
    </SectionHeader>
  );
}
