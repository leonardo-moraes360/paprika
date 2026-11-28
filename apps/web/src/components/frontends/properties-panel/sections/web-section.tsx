import { isRootFrame, type Document, type FrameNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { CommitTextField } from "../fields/commit-text-field";
import { NumericField } from "../fields/numeric-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type WebSectionProps = {
  doc: Document;
  node: FrameNode;
  set: SetProps;
};

export function WebSection({ doc, node, set }: WebSectionProps) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.web");
  return (
    <PanelSection id="web" title={t("frontends.propertiesPanel.web.title")} defaultOpen={!!node.href || node.minWidth != null || node.maxWidth != null}>
      <CommitTextField
        label={t("frontends.propertiesPanel.typography.link")}
        placeholder={t("frontends.propertiesPanel.typography.linkHint")}
        value={node.href ?? ""}
        onCommit={(href) => set({ href: href.trim() || null }, t("frontends.propertiesPanel.ops.link"))}
      />
      {isRootFrame(doc, node) ? (
        <PropertyRow title={t("frontends.propertiesPanel.web.title")} hideTitle>
          <NumericField label={t("frontends.propertiesPanel.web.minWidth")} prefix="↤" unit="px" min={0} value={node.minWidth} onCommit={(minWidth) => set({ minWidth }, label)} onClear={() => set({ minWidth: null }, label)} />
          <NumericField label={t("frontends.propertiesPanel.web.maxWidth")} prefix="↦" unit="px" min={0} value={node.maxWidth} onCommit={(maxWidth) => set({ maxWidth }, label)} onClear={() => set({ maxWidth: null }, label)} />
        </PropertyRow>
      ) : null}
    </PanelSection>
  );
}
