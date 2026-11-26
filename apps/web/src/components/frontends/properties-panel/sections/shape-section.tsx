import type { Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ChoiceField } from "../fields/choice-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type ShapeSectionProps = {
  node: Extract<Node, { type: "shape" }>;
  set: SetProps;
};

const SHAPES = ["rect", "ellipse", "diamond", "triangle", "cylinder", "parallelogram", "cloud", "note"] as const;

export function ShapeSection({ node, set }: ShapeSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection id="shape" title={t("frontends.propertiesPanel.shape.title")} defaultOpen>
      <ChoiceField
        label={t("frontends.propertiesPanel.shape.kind")}
        value={node.shape}
        options={SHAPES.map((shape) => ({ value: shape, label: t(`frontends.propertiesPanel.shape.kinds.${shape}`) }))}
        onValueChange={(shape) => set({ shape }, t("frontends.propertiesPanel.ops.shape"))}
      />
    </PanelSection>
  );
}
