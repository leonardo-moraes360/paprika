import type { Document, LintIssue, Op } from "@paprika/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { CommitTextField } from "../fields/commit-text-field";
import { ActivitySection } from "../sections/activity-section";
import { ModesSection } from "../sections/modes-section";
import { ReviewSection } from "../sections/review-section";
import { TokensSection } from "../sections/tokens-section";
import type { ActivityEntry } from "../types";

// A new activity entry re-renders the panel (it lists them), not the sections whose own props are unchanged.
const MemoTokensSection = memo(TokensSection);
const MemoModesSection = memo(ModesSection);
const MemoReviewSection = memo(ReviewSection);

export type DocumentPanelProps = {
  doc: Document;
  lint?: readonly LintIssue[];
  activity: readonly ActivityEntry[];
  activityMarker?: number;
  onApply: (ops: Op[], label: string) => void;
  onSelect: (ids: string[]) => void;
};

export function DocumentPanel({ doc, lint, activity, activityMarker, onApply, onSelect }: DocumentPanelProps) {
  const { t } = useTranslation();
  return (
    <div data-testid="document-panel">
      <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
        <h2 className="text-sm font-semibold text-fg">{t("frontends.propertiesPanel.document.title")}</h2>
        <CommitTextField
          label={t("frontends.propertiesPanel.identity.name")}
          value={doc.name}
          validate={(raw) => raw.trim().length > 0}
          invalidMessage={t("frontends.propertiesPanel.document.nameRequired")}
          onCommit={(name) => onApply([{ op: "rename_document", name: name.trim() }], t("frontends.propertiesPanel.ops.renameDocument"))}
        />
      </div>
      <MemoTokensSection doc={doc} onApply={onApply} />
      <MemoModesSection doc={doc} onApply={onApply} />
      <MemoReviewSection lint={lint} onSelect={onSelect} />
      <ActivitySection activity={activity} marker={activityMarker} />
    </div>
  );
}
