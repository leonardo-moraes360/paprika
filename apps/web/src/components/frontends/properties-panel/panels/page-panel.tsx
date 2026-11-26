import type { PageNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ColorValueField } from "../fields/color-value-field";
import { ModeField } from "../fields/mode-field";
import { IdentityHeader } from "../identity-header";
import { PanelSection } from "../panel-section";
import { NotesSection } from "../sections/notes-section";
import type { NodePanelBase } from "./shared";

export function PagePanel({ doc, node, set }: NodePanelBase<PageNode>) {
  const { t } = useTranslation();
  return (
    <div key={node.id} data-testid="page-panel">
      <IdentityHeader kind="page" id={node.id} name={node.name} onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.renamePage"))} />
      <PanelSection id="page-theme" title={t("frontends.propertiesPanel.page.theme")} defaultOpen>
        <ColorValueField doc={doc} mode={node.mode} label={t("frontends.propertiesPanel.page.background")} value={node.fill} onCommit={(fill) => set({ fill }, t("frontends.propertiesPanel.ops.pageBackground"))} />
        <ModeField doc={doc} value={node.mode} onCommit={(mode) => set({ mode }, t("frontends.propertiesPanel.ops.themeMode"))} />
      </PanelSection>
      <NotesSection notes={node.notes} set={set} forPage />
    </div>
  );
}
