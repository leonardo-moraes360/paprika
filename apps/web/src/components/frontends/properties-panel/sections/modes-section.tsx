import type { Document, Op } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { TokenChip } from "@/components/ui/token-chip";
import { parseModeTokenAssignment, tokenValue } from "@/lib/token-parsing";
import { CommitTextField } from "../fields/commit-text-field";
import { NewEntryField } from "../fields/new-entry-field";
import { PanelSection } from "../panel-section";
import { isColorToken } from "./tokens-section";

export type ModesSectionProps = {
  doc: Document;
  onApply: (ops: Op[], label: string) => void;
};

export function ModesSection({ doc, onApply }: ModesSectionProps) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.modeToken");
  const modes = Object.entries(doc.modes ?? {});
  return (
    <PanelSection id="modes" title={t("frontends.propertiesPanel.modes.title")} defaultOpen={modes.length > 0}>
      {modes.length === 0 ? <p className="text-xs text-muted">{t("frontends.propertiesPanel.modes.empty")}</p> : null}
      {modes.flatMap(([mode, tokens]) =>
        Object.entries(tokens).map(([name, value]) => (
          <div key={`${mode}/${name}`} className="flex flex-col gap-1">
            <TokenChip label={`${mode} · $${name}`} swatch={isColorToken(value) ? value : null} className="self-start" />
            <CommitTextField
              hideLabel
              label={`${mode} · $${name}`}
              value={String(value)}
              onCommit={(next) => onApply([{ op: "set_tokens", mode, tokens: { [name]: next === "" ? null : tokenValue(next) } }], label)}
            />
          </div>
        )),
      )}
      <NewEntryField
        label={t("frontends.propertiesPanel.modes.new")}
        placeholder={t("frontends.propertiesPanel.modes.newPlaceholder")}
        hint={t("frontends.propertiesPanel.modes.newHint")}
        invalidMessage={t("frontends.propertiesPanel.modes.newInvalid")}
        onSubmit={(raw) => {
          const token = parseModeTokenAssignment(raw);
          if (!token) return false;
          onApply([{ op: "set_tokens", mode: token.mode, tokens: { [token.name]: tokenValue(token.value.trim()) } }], label);
          return true;
        }}
      />
    </PanelSection>
  );
}
