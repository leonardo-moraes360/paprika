import { modeOf, type Document, type Node } from "@paprika/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ColorValueField } from "../fields/color-value-field";
import { CommitTextField } from "../fields/commit-text-field";
import { TokenNumberField } from "../fields/token-number-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type FontPickerSlot = (props: { value: string; onValueChange: (family: string) => void }) => ReactNode;

export type TypographySectionProps = {
  doc: Document;
  node: Extract<Node, { type: "text" | "shape" }>;
  set: SetProps;
  renderFontPicker?: FontPickerSlot;
};

const ALIGNMENTS = ["left", "center", "right"] as const;

export function TypographySection({ doc, node, set, renderFontPicker }: TypographySectionProps) {
  const { t } = useTranslation();
  const mode = modeOf(doc, node);
  const isText = node.type === "text";
  const label = t("frontends.propertiesPanel.ops.typography");
  const setNumber = (key: string) => (value: number | string) => set({ [key]: value }, label);

  return (
    <PanelSection id="typography" title={t("frontends.propertiesPanel.typography.title")} defaultOpen={isText}>
      {isText || node.type === "shape" ? (
        <CommitTextField
          label={t("frontends.propertiesPanel.typography.content")}
          multiline
          value={node.text}
          onCommit={(text) => set({ text, ...(isText && text !== node.text && node.runs?.length ? { runs: null } : {}) }, t("frontends.propertiesPanel.ops.editText"))}
        />
      ) : null}
      {isText && node.runs?.length ? <p className="text-xs text-muted">{t("frontends.propertiesPanel.typography.runs", { count: node.runs.length })}</p> : null}
      <ColorValueField
        doc={doc}
        mode={mode}
        label={t("frontends.propertiesPanel.typography.color")}
        value={node.color}
        clearable={false}
        onCommit={(color) => color && set({ color }, label)}
      />
      {renderFontPicker ? (
        renderFontPicker({ value: node.fontFamily, onValueChange: (fontFamily) => set({ fontFamily }, label) })
      ) : (
        <CommitTextField label={t("frontends.propertiesPanel.typography.family")} value={node.fontFamily} onCommit={(fontFamily) => fontFamily.trim() && set({ fontFamily: fontFamily.trim() }, label)} />
      )}
      <PropertyRow title={t("frontends.propertiesPanel.typography.metrics")} hideTitle>
        <TokenNumberField label={t("frontends.propertiesPanel.typography.size")} value={node.fontSize} onCommit={setNumber("fontSize")} />
        <TokenNumberField label={t("frontends.propertiesPanel.typography.weight")} value={node.fontWeight} hint={t("frontends.propertiesPanel.typography.weightHint")} onCommit={setNumber("fontWeight")} />
        <TokenNumberField label={t("frontends.propertiesPanel.typography.lineHeight")} value={node.lineHeight} onCommit={setNumber("lineHeight")} />
        {isText ? <TokenNumberField label={t("frontends.propertiesPanel.typography.letterSpacing")} value={node.letterSpacing} onCommit={setNumber("letterSpacing")} /> : <span />}
      </PropertyRow>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-label">{t("frontends.propertiesPanel.typography.align")}</span>
        <SegmentedControl
          aria-label={t("frontends.propertiesPanel.typography.align")}
          stretch
          value={node.textAlign}
          onValueChange={(textAlign) => textAlign && textAlign !== node.textAlign && set({ textAlign }, label)}
        >
          {ALIGNMENTS.map((value) => (
            <SegmentedControlItem key={value} value={value}>
              {t(`frontends.propertiesPanel.typography.alignValues.${value}`)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      {isText ? (
        <CommitTextField
          label={t("frontends.propertiesPanel.typography.link")}
          placeholder={t("frontends.propertiesPanel.typography.linkHint")}
          value={node.href ?? ""}
          onCommit={(href) => set({ href: href.trim() || null }, t("frontends.propertiesPanel.ops.link"))}
        />
      ) : null}
    </PanelSection>
  );
}
