import type { LintIssue } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Tag } from "@/components/ui/tag";
import { PanelSection } from "../panel-section";

export type ReviewSectionProps = {
  lint: readonly LintIssue[] | undefined;
  onSelect: (ids: string[]) => void;
};

const SEVERITY_BORDER = { error: "border-s-red-ink", warning: "border-s-yellow-soft-ink", info: "border-s-muted" } as const;

export function ReviewSection({ lint, onSelect }: ReviewSectionProps) {
  const { t } = useTranslation();
  const count = lint?.length ?? 0;
  const title = (
    <span className="flex items-center gap-2">
      {t("frontends.propertiesPanel.review.title")}
      {count > 0 ? (
        <Tag tone="red" aria-label={t("frontends.propertiesPanel.review.count", { count })}>
          {count}
        </Tag>
      ) : null}
    </span>
  );
  return (
    <PanelSection id="review" title={title} defaultOpen={count > 0}>
      {lint === undefined ? (
        <InlineNotice>{t("frontends.propertiesPanel.review.pending")}</InlineNotice>
      ) : count === 0 ? (
        <p className="text-xs text-muted">{t("frontends.propertiesPanel.review.clean")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lint.map((issue, index) => (
            <li key={`${issue.nodeId}-${issue.rule}-${index}`} className={`rounded-md border-s-[3px] bg-surface ${SEVERITY_BORDER[issue.severity]}`}>
              <button
                type="button"
                onClick={() => onSelect([issue.nodeId])}
                className="w-full cursor-pointer px-2 py-1.5 text-start text-sm text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-select"
              >
                <strong>{issue.rule}</strong> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
