import type { Node, Op } from "@paprika/core";
import { Unlink } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TokenChip } from "@/components/ui/token-chip";
import { PanelSection } from "../panel-section";
import { tokenUses } from "../token-uses";

export type TokenUsesSectionProps = {
  node: Node;
  onApply: (ops: Op[], label: string) => void;
};

export function TokenUsesSection({ node, onApply }: TokenUsesSectionProps) {
  const { t } = useTranslation();
  const uses = tokenUses(node);
  const detachAllButton = useRef<HTMLButtonElement>(null);
  if (uses.length === 0) return null;
  const detach = (fields?: string[]) => {
    const root = detachAllButton.current?.closest<HTMLElement>("[data-properties-panel]");
    if (fields && uses.length > 1) detachAllButton.current?.focus();
    else root?.focus();
    onApply([{ op: "detach_tokens", ids: [node.id], ...(fields ? { fields } : {}) }], t("frontends.propertiesPanel.ops.detachTokens"));
  };
  return (
    <PanelSection id="node-tokens" title={t("frontends.propertiesPanel.tokens.title")} defaultOpen>
      <ul className="flex flex-col gap-1.5">
        {uses.map((use, index) => {
          const name = t(`frontends.propertiesPanel.tokens.fields.${use.field.replace(".", "_")}` as never);
          return (
            <li key={`${use.field}-${index}`} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col gap-0.5 text-sm text-fg">
                <span className="truncate">{name}</span>
                <TokenChip label={use.value} />
              </span>
              <Button type="button" variant="secondary" size="sm" aria-label={t("frontends.propertiesPanel.tokens.detachOne", { field: name })} onClick={() => detach([use.field])}>
                <Unlink aria-hidden="true" />
                {t("frontends.propertiesPanel.tokens.detach")}
              </Button>
            </li>
          );
        })}
      </ul>
      <Button ref={detachAllButton} type="button" size="sm" onClick={() => detach()}>
        {t("frontends.propertiesPanel.tokens.detachAll")}
      </Button>
    </PanelSection>
  );
}
