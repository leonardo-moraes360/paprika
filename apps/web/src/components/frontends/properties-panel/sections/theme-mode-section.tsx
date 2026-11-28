import { modeOf, type Document, type FrameNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ModeField } from "../fields/mode-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type ThemeModeSectionProps = {
  doc: Document;
  node: FrameNode;
  set: SetProps;
};

export function ThemeModeSection({ doc, node, set }: ThemeModeSectionProps) {
  const { t } = useTranslation();
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  return (
    <PanelSection id="theme-mode" title={t("frontends.propertiesPanel.mode.title")} defaultOpen={!!node.mode}>
      <ModeField doc={doc} value={node.mode} inherited={modeOf(doc, parent)} onCommit={(mode) => set({ mode }, t("frontends.propertiesPanel.ops.themeMode"))} />
    </PanelSection>
  );
}
