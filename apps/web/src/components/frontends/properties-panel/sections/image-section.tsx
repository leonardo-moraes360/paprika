import type { Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type ImageSectionProps = {
  node: Extract<Node, { type: "image" }>;
  set: SetProps;
};

export function ImageSection({ node, set }: ImageSectionProps) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.image");
  const inline = node.src.startsWith("data:");
  return (
    <PanelSection id="image" title={t("frontends.propertiesPanel.image.title")} defaultOpen>
      <CommitTextField
        label={t("frontends.propertiesPanel.image.source")}
        placeholder={t("frontends.propertiesPanel.image.sourceHint")}
        value={inline ? t("frontends.propertiesPanel.image.inline") : node.src}
        disabled={inline}
        onCommit={(src) => set({ src }, label)}
      />
      <CommitTextField label={t("frontends.propertiesPanel.image.alt")} value={node.alt} onCommit={(alt) => set({ alt }, label)} />
      <ChoiceField
        label={t("frontends.propertiesPanel.image.decorative")}
        value={String(!!node.decorative)}
        options={[
          { value: "true", label: t("frontends.propertiesPanel.layout.values.true") },
          { value: "false", label: t("frontends.propertiesPanel.layout.values.false") },
        ]}
        onValueChange={(value) => set({ decorative: value === "true" ? true : null }, label)}
      />
    </PanelSection>
  );
}
