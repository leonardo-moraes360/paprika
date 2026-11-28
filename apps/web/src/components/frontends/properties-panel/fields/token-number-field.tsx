import { useTranslation } from "react-i18next";
import { parseNumeric } from "@/lib/numeric-input";
import { CommitTextField } from "./commit-text-field";

export type TokenNumberFieldProps = {
  label: string;
  value: number | string | undefined;
  onCommit: (value: number | string) => void;
  hint?: string;
  className?: string;
};

export function parseTokenNumber(raw: string): number | string | null {
  const text = raw.trim();
  if (text.startsWith("$") && text.length > 1) return text;
  return parseNumeric(text) ?? null;
}

export function TokenNumberField({ label, value, onCommit, hint, className }: TokenNumberFieldProps) {
  const { t } = useTranslation();
  return (
    <CommitTextField
      label={label}
      value={value === undefined ? "" : String(value)}
      placeholder={hint}
      validate={(raw) => parseTokenNumber(raw) !== null}
      invalidMessage={t("frontends.propertiesPanel.numeric.numberOrToken")}
      className={className}
      onCommit={(raw) => {
        const parsed = parseTokenNumber(raw);
        if (parsed !== null) onCommit(parsed);
      }}
    />
  );
}
