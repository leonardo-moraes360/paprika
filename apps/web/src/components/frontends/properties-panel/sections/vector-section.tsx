import type { Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type VectorSectionProps = {
  node: Extract<Node, { type: "path" }>;
  set: SetProps;
};

const same = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

export function VectorSection({ node, set }: VectorSectionProps) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.vector");
  return (
    <PanelSection id="vector" title={t("frontends.propertiesPanel.vector.title")} defaultOpen>
      <CommitTextField
        multiline
        label={t("frontends.propertiesPanel.vector.path")}
        value={node.d}
        validate={(raw) => raw.trim().length > 0}
        invalidMessage={t("frontends.propertiesPanel.vector.pathInvalid")}
        onCommit={(d) => set({ d: d.trim() }, t("frontends.propertiesPanel.ops.editPath"))}
      />
      <PropertyRow title={t("frontends.propertiesPanel.vector.title")} hideTitle columns={1}>
        <ChoiceField label={t("frontends.propertiesPanel.vector.fillRule")} value={node.fillRule} options={same(["nonzero", "evenodd"])} onValueChange={(fillRule) => set({ fillRule }, label)} />
        <ChoiceField label={t("frontends.propertiesPanel.vector.cap")} value={node.strokeCap} options={same(["butt", "round", "square"])} onValueChange={(strokeCap) => set({ strokeCap }, label)} />
        <ChoiceField label={t("frontends.propertiesPanel.vector.join")} value={node.strokeJoin} options={same(["miter", "round", "bevel"])} onValueChange={(strokeJoin) => set({ strokeJoin }, label)} />
      </PropertyRow>
    </PanelSection>
  );
}
