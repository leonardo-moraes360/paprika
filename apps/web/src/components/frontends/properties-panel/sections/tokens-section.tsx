import type { Document, Op } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { TokenChip } from "@/components/ui/token-chip";
import { parseTokenAssignment, tokenValue } from "@/lib/token-parsing";
import { CommitTextField } from "../fields/commit-text-field";
import { NewEntryField } from "../fields/new-entry-field";
import { PanelSection } from "../panel-section";

export type TokensSectionProps = {
  doc: Document;
  onApply: (ops: Op[], label: string) => void;
};

export const isColorToken = (value: unknown): value is string => typeof value === "string" && /^#|^rgb/.test(value);

export function tokenCollections(doc: Document): string[] {
  const names = new Set(Object.keys(doc.tokens).map((name) => doc.tokenMeta?.[name]?.collection ?? ""));
  return [...names].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

export function TokensSection({ doc, onApply }: TokensSectionProps) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.token");
  const count = Object.keys(doc.tokens).length;
  return (
    <PanelSection id="tokens" title={t("frontends.propertiesPanel.tokens.documentTitle")} defaultOpen={count > 0}>
      {tokenCollections(doc).map((collection) => (
        <div key={collection || "base"} role="group" aria-label={collection || t("frontends.propertiesPanel.tokens.base")} className="flex flex-col gap-2">
          {collection ? <p className="text-xs font-semibold text-label">{collection}</p> : null}
          {Object.entries(doc.tokens)
            .filter(([name]) => (doc.tokenMeta?.[name]?.collection ?? "") === collection)
            .map(([name, value]) => {
              const type = doc.tokenMeta?.[name]?.type;
              return (
                <div key={name} className="flex flex-col gap-1">
                  <TokenChip label={`$${name}`} swatch={isColorToken(value) ? value : null} kind={type ? t(`frontends.propertiesPanel.tokens.types.${type}`) : undefined} className="self-start" />
                  <CommitTextField
                    hideLabel
                    label={`$${name}`}
                    value={String(value)}
                    onCommit={(next) => onApply([{ op: "set_tokens", tokens: { [name]: next === "" ? null : tokenValue(next) } }], label)}
                  />
                </div>
              );
            })}
        </div>
      ))}
      {count === 0 ? <p className="text-xs text-muted">{t("frontends.propertiesPanel.tokens.empty")}</p> : null}
      <NewEntryField
        label={t("frontends.propertiesPanel.tokens.new")}
        placeholder={t("frontends.propertiesPanel.tokens.newPlaceholder")}
        hint={t("frontends.propertiesPanel.tokens.newHint")}
        invalidMessage={t("frontends.propertiesPanel.tokens.newInvalid")}
        onSubmit={(raw) => {
          const token = parseTokenAssignment(raw);
          if (!token) return false;
          onApply(
            [
              {
                op: "set_tokens",
                tokens: { [token.name]: tokenValue(token.value.trim()) },
                ...(token.type ? { type: token.type as "color" } : {}),
                ...(token.collection ? { collection: token.collection } : {}),
              },
            ],
            label,
          );
          return true;
        }}
      />
    </PanelSection>
  );
}
