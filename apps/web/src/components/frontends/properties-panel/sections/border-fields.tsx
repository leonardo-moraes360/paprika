import type { Document, Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { ColorValueField } from "../fields/color-value-field";
import { NumericField } from "../fields/numeric-field";
import type { SetProps } from "../types";

export type BorderFieldsProps = {
  doc: Document;
  node: Node;
  mode?: string;
  set: SetProps;
};

type StrokeLike = { color: string; width: number | string; style?: string; position?: string };

export function BorderFields({ doc, node, mode, set }: BorderFieldsProps) {
  const { t } = useTranslation();
  const stroke = ("stroke" in node ? node.stroke : undefined) as StrokeLike | undefined;
  const defaultPosition = node.type === "path" ? "center" : "inside";
  const label = t("frontends.propertiesPanel.ops.border");
  const write = (patch: Partial<StrokeLike>) => stroke && set({ stroke: { ...stroke, ...patch } }, label);
  const options = (group: "style" | "position", keys: readonly string[]) => keys.map((key) => ({ value: key, label: t(`frontends.propertiesPanel.border.${group}.${key}` as never) }));

  return (
    <>
      <ColorValueField
        doc={doc}
        mode={mode}
        showLabel
        label={t("frontends.propertiesPanel.border.color")}
        value={stroke?.color}
        onCommit={(color) =>
          set({ stroke: color ? { color, width: stroke?.width ?? 1, style: stroke?.style ?? "solid", position: stroke?.position ?? defaultPosition } : null }, label)
        }
      />
      {stroke ? (
        <>
          <NumericField label={t("frontends.propertiesPanel.border.width")} prefix="W" unit="px" min={0} value={stroke.width} onCommit={(width) => write({ width })} />
          <PropertyRow title={t("frontends.propertiesPanel.border.title")} hideTitle>
            <ChoiceField label={t("frontends.propertiesPanel.border.styleLabel")} value={stroke.style ?? "solid"} options={options("style", ["solid", "dashed", "dotted"])} onValueChange={(style) => write({ style })} />
            <ChoiceField label={t("frontends.propertiesPanel.border.positionLabel")} value={stroke.position ?? defaultPosition} options={options("position", ["inside", "center", "outside"])} onValueChange={(position) => write({ position })} />
          </PropertyRow>
        </>
      ) : null}
    </>
  );
}
