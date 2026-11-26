import type { Op } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PanelSection } from "../panel-section";

export type ArrangeSectionProps = {
  ids: readonly string[];
  onApply: (ops: Op[], label: string) => void;
  defaultOpen?: boolean;
};

const MOVES = ["front", "forward", "backward", "back"] as const;
const SHORTCUTS = { front: "Ctrl+PageUp", forward: "PageUp", backward: "PageDown", back: "Ctrl+PageDown" } as const;

export function ArrangeSection({ ids, onApply, defaultOpen = false }: ArrangeSectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection id="arrange" title={t("frontends.propertiesPanel.arrange.title")} defaultOpen={defaultOpen}>
      <div className="flex flex-wrap gap-2">
        {MOVES.map((index) => (
          <Button
            key={index}
            type="button"
            variant="secondary"
            size="sm"
            title={SHORTCUTS[index]}
            onClick={() => onApply(ids.map((id) => ({ op: "update" as const, id, props: { index } })), t(`frontends.propertiesPanel.arrange.${index}`))}
          >
            {t(`frontends.propertiesPanel.arrange.${index}`)}
          </Button>
        ))}
      </div>
    </PanelSection>
  );
}
