import type { Document } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { ChoiceField } from "./choice-field";

const BASE = "__base__";

export type ModeFieldProps = {
  doc: Document;
  value: string | undefined;
  inherited?: string;
  onCommit: (mode: string | null) => void;
};

export function ModeField({ doc, value, inherited, onCommit }: ModeFieldProps) {
  const { t } = useTranslation();
  const modes = Object.keys(doc.modes ?? {});
  if (value && !modes.includes(value)) modes.push(value);
  return (
    <ChoiceField
      label={t("frontends.propertiesPanel.mode.label")}
      value={value ?? BASE}
      options={[
        { value: BASE, label: inherited ? t("frontends.propertiesPanel.mode.inherited", { mode: inherited }) : t("frontends.propertiesPanel.mode.base") },
        ...modes.map((mode) => ({ value: mode, label: mode })),
      ]}
      onValueChange={(next) => onCommit(next === BASE ? null : next)}
    />
  );
}
