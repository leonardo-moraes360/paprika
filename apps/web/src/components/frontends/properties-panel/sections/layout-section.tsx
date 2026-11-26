import type { FrameNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PropertyRow } from "@/components/ui/property-row";
import { formatPadding, parsePadding } from "@/lib/numeric-input";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { NumericField } from "../fields/numeric-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type LayoutSectionProps = {
  node: FrameNode;
  set: SetProps;
};

export function LayoutSection({ node, set }: LayoutSectionProps) {
  const { t } = useTranslation();
  const layout = node.layout;
  // One number is a field with steppers; four values and `$token` keep the text field.
  const uniform = !layout || layout.padding === undefined || typeof layout.padding === "number";
  const active = !!layout && layout.mode !== "none";
  const label = t("frontends.propertiesPanel.ops.layout");
  const patch = (next: Record<string, unknown>) => set({ layout: { ...layout, ...next } }, label);
  const pick = (keys: readonly string[]) => keys.map((key) => ({ value: key, label: t(`frontends.propertiesPanel.layout.values.${key}` as never) }));

  return (
    <PanelSection id="layout" title={t("frontends.propertiesPanel.layout.title")} defaultOpen={active}>
      <PropertyRow title={t("frontends.propertiesPanel.layout.title")} hideTitle>
        <ChoiceField
          label={t("frontends.propertiesPanel.layout.mode")}
          value={layout?.mode ?? "none"}
          options={pick(["none", "row", "column"])}
          onValueChange={(mode) => set({ layout: mode === "none" ? null : { ...layout, mode } }, label)}
        />
        <ChoiceField
          label={t("frontends.propertiesPanel.layout.clip")}
          value={String(node.clip)}
          options={pick(["true", "false"])}
          onValueChange={(clip) => set({ clip: clip === "true" }, t("frontends.propertiesPanel.ops.clip"))}
        />
      </PropertyRow>
      {active && layout ? (
        <>
          <PropertyRow title={t("frontends.propertiesPanel.layout.spacing")} hideTitle>
            <NumericField label={t("frontends.propertiesPanel.layout.gap")} prefix="G" unit="px" min={0} value={layout.gap} onCommit={(gap) => patch({ gap })} />
            {uniform ? (
              <NumericField label={t("frontends.propertiesPanel.layout.padding")} prefix="P" unit="px" min={0} value={layout.padding as number | undefined} onCommit={(padding) => patch({ padding })} />
            ) : (
              <CommitTextField
                label={t("frontends.propertiesPanel.layout.padding")}
                placeholder={t("frontends.propertiesPanel.layout.paddingHint")}
                value={formatPadding(layout.padding)}
                validate={(raw) => parsePadding(raw) !== null}
                invalidMessage={t("frontends.propertiesPanel.layout.paddingInvalid")}
                onCommit={(raw) => patch({ padding: parsePadding(raw) })}
              />
            )}
          </PropertyRow>
          {uniform ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => patch({ padding: [layout.padding ?? 0, layout.padding ?? 0, layout.padding ?? 0, layout.padding ?? 0] })}>
              {t("frontends.propertiesPanel.layout.paddingSides")}
            </Button>
          ) : Array.isArray(layout.padding) ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => patch({ padding: (layout.padding as readonly (number | string)[])[0] ?? 0 })}>
              {t("frontends.propertiesPanel.layout.paddingUniform")}
            </Button>
          ) : null}
          <PropertyRow title={t("frontends.propertiesPanel.layout.distribution")} hideTitle>
            <ChoiceField
              label={t("frontends.propertiesPanel.layout.align")}
              value={layout.align ?? "start"}
              options={pick(["start", "center", "end", "stretch"])}
              onValueChange={(align) => patch({ align })}
            />
            <ChoiceField
              label={t("frontends.propertiesPanel.layout.justify")}
              value={layout.justify ?? "start"}
              options={pick(["start", "center", "end", "between"])}
              onValueChange={(justify) => patch({ justify })}
            />
          </PropertyRow>
        </>
      ) : null}
    </PanelSection>
  );
}
