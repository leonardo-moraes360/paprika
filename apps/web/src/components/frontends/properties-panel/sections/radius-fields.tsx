import type { Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { CornerRadiusField } from "@/components/ui/corner-radius-field";
import { NumericField } from "../fields/numeric-field";
import type { SetProps } from "../types";

type Radius = number | string | readonly (number | string)[];

export type RadiusFieldsProps = {
  node: Node;
  set: SetProps;
};

const CORNERS = { topLeft: 0, topRight: 1, bottomRight: 2, bottomLeft: 3 } as const;

export function hasCornerRadius(node: Node): boolean {
  return node.type === "frame" || node.type === "rect" || node.type === "image";
}

export function hasPlainRadius(node: Node): boolean {
  return "radius" in node && !hasCornerRadius(node) && node.type !== "ellipse" && node.type !== "path" && node.type !== "connector";
}

export function RadiusFields({ node, set }: RadiusFieldsProps) {
  const { t } = useTranslation();
  const radius = ("radius" in node ? node.radius : 0) as Radius;
  const label = t("frontends.propertiesPanel.ops.radius");
  const write = (next: Radius) => set({ radius: next }, label);

  if (!hasCornerRadius(node)) {
    return <NumericField label={t("frontends.propertiesPanel.radius.radius")} prefix="r" unit="px" min={0} value={typeof radius === "object" ? undefined : radius} onCommit={(v) => write(v as number)} />;
  }

  const corners = Array.isArray(radius) ? ([...radius] as (number | string)[]) : null;
  const corner = (key: keyof typeof CORNERS, name: string, short: string) => (
    <NumericField
      label={name}
      prefix={short}
      min={0}
      value={corners?.[CORNERS[key]]}
      onCommit={(v) => {
        if (!corners) return;
        const next = [...corners];
        next[CORNERS[key]] = v as number;
        write(next);
      }}
    />
  );

  return (
    <CornerRadiusField
      linked={!corners}
      onLinkedChange={(linked) => {
        if (linked) write(corners?.[0] ?? 0);
        else write([radius, radius, radius, radius] as unknown as Radius);
      }}
      linkLabel={t("frontends.propertiesPanel.radius.link")}
      unlinkLabel={t("frontends.propertiesPanel.radius.unlink")}
      single={<NumericField label={t("frontends.propertiesPanel.radius.radius")} prefix="r" unit="px" min={0} value={corners ? undefined : (radius as number | string)} onCommit={(v) => write(v as number)} />}
      corners={{
        topLeft: corner("topLeft", t("frontends.propertiesPanel.radius.topLeft"), "TL"),
        topRight: corner("topRight", t("frontends.propertiesPanel.radius.topRight"), "TR"),
        bottomLeft: corner("bottomLeft", t("frontends.propertiesPanel.radius.bottomLeft"), "BL"),
        bottomRight: corner("bottomRight", t("frontends.propertiesPanel.radius.bottomRight"), "BR"),
      }}
    />
  );
}
