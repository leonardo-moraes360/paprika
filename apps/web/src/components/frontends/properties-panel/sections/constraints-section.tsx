import type { Document, Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { constraintsOf, showsConstraints } from "../node-helpers";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type ConstraintsSectionProps = {
  doc: Document;
  node: Node;
  set: SetProps;
};

export function ConstraintsSection({ doc, node, set }: ConstraintsSectionProps) {
  const { t } = useTranslation();
  if (!showsConstraints(doc, node)) return null;
  const current = constraintsOf(node);
  const axes = [
    { key: "horizontal" as const, label: t("frontends.propertiesPanel.constraints.horizontal"), values: ["left", "center", "right", "scale"] },
    { key: "vertical" as const, label: t("frontends.propertiesPanel.constraints.vertical"), values: ["top", "center", "bottom", "scale"] },
  ];
  return (
    <PanelSection id="constraints" title={t("frontends.propertiesPanel.constraints.title")}>
      {axes.map((axis) => (
        <div key={axis.key} className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-label">{axis.label}</span>
          <SegmentedControl
            aria-label={axis.label}
            stretch
            value={current[axis.key]}
            onValueChange={(value) => {
              if (value === null || value === current[axis.key]) return;
              const next = { ...current, [axis.key]: value };
              set({ constraints: next.horizontal === "left" && next.vertical === "top" ? null : next }, t("frontends.propertiesPanel.ops.constraints"));
            }}
          >
            {axis.values.map((value) => (
              <SegmentedControlItem key={value} value={value}>
                {t(`frontends.propertiesPanel.constraints.values.${value}` as never)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      ))}
      <p className="text-xs text-muted">{t("frontends.propertiesPanel.constraints.hint")}</p>
    </PanelSection>
  );
}
