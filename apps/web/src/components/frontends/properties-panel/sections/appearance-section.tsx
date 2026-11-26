import { modeOf, nodeGradient, type Document, type Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ColorValueField } from "../fields/color-value-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";
import { BorderFields } from "./border-fields";
import { GradientEditor, GradientKindControl } from "./gradient-fields";
import { hasCornerRadius, hasPlainRadius, RadiusFields } from "./radius-fields";

export type AppearanceSectionProps = {
  doc: Document;
  node: Exclude<Node, { type: "group" | "connector" | "page" }>;
  set: SetProps;
};

export function AppearanceSection({ doc, node, set }: AppearanceSectionProps) {
  const { t } = useTranslation();
  const mode = modeOf(doc, node);
  const fill = "fill" in node ? (node.fill as string | undefined) : undefined;
  const gradient = nodeGradient(node);
  return (
    <PanelSection id="appearance" title={t("frontends.propertiesPanel.fill.title")} defaultOpen>
      <GradientKindControl node={node} fill={fill} set={set} />
      {gradient ? (
        <GradientEditor doc={doc} node={node} mode={mode} set={set} />
      ) : (
        <ColorValueField doc={doc} mode={mode} label={t("frontends.propertiesPanel.fill.color")} value={fill} onCommit={(value) => set({ fill: value }, t("frontends.propertiesPanel.ops.fill"))} />
      )}
      {hasCornerRadius(node) || hasPlainRadius(node) ? <RadiusFields node={node} set={set} /> : null}
      <BorderFields doc={doc} node={node} mode={mode} set={set} />
    </PanelSection>
  );
}
