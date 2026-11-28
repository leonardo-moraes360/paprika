import { useTranslation } from "react-i18next";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type NotesSectionProps = {
  notes: string | undefined;
  set: SetProps;
  forPage?: boolean;
};

export function NotesSection({ notes, set, forPage = false }: NotesSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection id="notes" title={forPage ? t("frontends.propertiesPanel.notes.page") : t("frontends.propertiesPanel.notes.title")}>
      <CommitTextField
        multiline
        label={t("frontends.propertiesPanel.notes.label")}
        placeholder={t("frontends.propertiesPanel.notes.placeholder")}
        value={notes}
        onCommit={(value) => set({ notes: value || null }, t("frontends.propertiesPanel.ops.notes"))}
      />
    </PanelSection>
  );
}
