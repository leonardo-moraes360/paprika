import {
  alignContentOps,
  centerContentOps,
  contentAxes,
  contentSummary,
  contentTarget,
  isContentCentered,
  type Document,
  type HorizontalAlign,
  type Node,
  type Op,
  type VerticalAlign,
} from "@paprika/core";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconToggleGroup } from "@/components/ui/icon-toggle-group";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Kbd } from "@/components/ui/kbd";
import { PanelSection } from "../panel-section";

export type ContentSectionProps = {
  doc: Document;
  node: Node;
  onApply: (ops: Op[], label: string) => void;
  centerShortcut?: readonly string[];
};

export function ContentSection({ doc, node, onApply, centerShortcut = ["Alt", "C"] }: ContentSectionProps) {
  const { t } = useTranslation();
  const target = contentTarget(doc, node);
  if (!target) return null;
  const frame = target.kind === "frame" ? target.frame : null;
  const live = target.kind === "frame" || target.kind === "shape";
  const axes = frame ? contentAxes(frame) : { horizontal: null, vertical: null };
  const centered = frame ? isContentCentered(frame) : false;
  const label = t("frontends.propertiesPanel.ops.alignContent");
  const state = centered ? "centered" : axes.horizontal || axes.vertical ? "aligned" : "manual";
  const summary = live ? contentSummary(doc, target.kind === "shape" ? target.adopt : (frame as NonNullable<typeof frame>)) : null;

  const horizontal = [
    { value: "left", label: t("frontends.propertiesPanel.content.left"), icon: <AlignStartVertical aria-hidden="true" /> },
    { value: "center", label: t("frontends.propertiesPanel.content.centerHorizontal"), icon: <AlignCenterVertical aria-hidden="true" /> },
    { value: "right", label: t("frontends.propertiesPanel.content.right"), icon: <AlignEndVertical aria-hidden="true" /> },
  ];
  const vertical = [
    { value: "top", label: t("frontends.propertiesPanel.content.top"), icon: <AlignStartHorizontal aria-hidden="true" /> },
    { value: "middle", label: t("frontends.propertiesPanel.content.middle"), icon: <AlignCenterHorizontal aria-hidden="true" /> },
    { value: "bottom", label: t("frontends.propertiesPanel.content.bottom"), icon: <AlignEndHorizontal aria-hidden="true" /> },
  ];

  return (
    <PanelSection id="content" title={t("frontends.propertiesPanel.content.title")} defaultOpen>
      {summary ? (
        <p className="text-xs text-muted">{t("frontends.propertiesPanel.content.summary", { count: summary.count, state: t(`frontends.propertiesPanel.content.state.${state}`) })}</p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-label">{t("frontends.propertiesPanel.content.horizontal")}</span>
          <IconToggleGroup
            label={t("frontends.propertiesPanel.content.horizontal")}
            items={horizontal}
            value={axes.horizontal}
            disabled={!live}
            onValueChange={(value) => live && onApply(alignContentOps(doc, node.id, { horizontal: value as HorizontalAlign }), label)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-label">{t("frontends.propertiesPanel.content.vertical")}</span>
          <IconToggleGroup
            label={t("frontends.propertiesPanel.content.vertical")}
            items={vertical}
            value={axes.vertical}
            disabled={!live}
            onValueChange={(value) => live && onApply(alignContentOps(doc, node.id, { vertical: value as VerticalAlign }), label)}
          />
        </div>
      </div>
      {live ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={centered}
            onClick={() => onApply(centerContentOps(doc, [node.id]).ops, t("frontends.propertiesPanel.ops.centerContent"))}
          >
            {t("frontends.propertiesPanel.content.center")}
          </Button>
          <span className="flex items-center gap-1">
            {centerShortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </div>
      ) : (
        <InlineNotice>{t("frontends.propertiesPanel.content.empty")}</InlineNotice>
      )}
    </PanelSection>
  );
}
