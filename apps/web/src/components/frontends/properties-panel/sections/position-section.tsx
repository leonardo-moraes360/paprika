import { ignoresLayout, type Document, type Node } from "@paprika/core";
import { Link2, Unlink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconToggle } from "@/components/ui/icon-toggle";
import { PropertyRow } from "@/components/ui/property-row";
import { Switch } from "@/components/ui/switch";
import { lockedSize } from "@/lib/numeric-input";
import { NumericField } from "../fields/numeric-field";
import { isFlowChild } from "../node-helpers";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type PositionSectionProps = {
  doc: Document;
  node: Exclude<Node, { type: "page" | "connector" }>;
  set: SetProps;
  resizable?: boolean;
  extra?: ReactNode;
};

export function PositionSection({ doc, node, set, resizable = true, extra }: PositionSectionProps) {
  const { t } = useTranslation();
  const [locked, setLocked] = useState(false);
  const flow = isFlowChild(doc, node);
  const ignored = ignoresLayout(node);
  const width = "width" in node ? node.width : undefined;
  const height = "height" in node ? node.height : undefined;

  const commitSize = (side: "width" | "height") => (value: number | string) => {
    if (locked && typeof value === "number" && typeof width === "number" && typeof height === "number") {
      const next = lockedSize(side, value, { width, height });
      if (next) {
        set(next, t("frontends.propertiesPanel.ops.resize"));
        return;
      }
    }
    set({ [side]: value }, t("frontends.propertiesPanel.ops.resize"));
  };

  const sizeKeywords = ["hug", "fill"] as const;
  const move = t("frontends.propertiesPanel.ops.move");

  return (
    <PanelSection id="position" title={t("frontends.propertiesPanel.position.title")} defaultOpen>
      <PropertyRow title={t("frontends.propertiesPanel.position.location")} hideTitle>
        <NumericField label="X" prefix="X" unit="px" value={node.x} onCommit={(v) => set({ x: v }, move)} />
        <NumericField label="Y" prefix="Y" unit="px" value={node.y} onCommit={(v) => set({ y: v }, move)} />
      </PropertyRow>
      {resizable && width !== undefined && height !== undefined ? (
        <div className="flex items-start gap-2">
          <PropertyRow title={t("frontends.propertiesPanel.position.size")} hideTitle className="flex-1">
            <NumericField label={t("frontends.propertiesPanel.position.width")} prefix={t("frontends.propertiesPanel.position.widthPrefix")} unit="px" value={width} keywords={sizeKeywords} min={0} onCommit={commitSize("width")} />
            <NumericField label={t("frontends.propertiesPanel.position.height")} prefix={t("frontends.propertiesPanel.position.heightPrefix")} unit="px" value={height} keywords={sizeKeywords} min={0} onCommit={commitSize("height")} />
          </PropertyRow>
          <IconToggle
            bordered
            pressed={locked}
            onPressedChange={setLocked}
            aria-label={locked ? t("frontends.propertiesPanel.position.unlockRatio") : t("frontends.propertiesPanel.position.lockRatio")}
            className="size-9"
          >
            {locked ? <Link2 aria-hidden="true" /> : <Unlink aria-hidden="true" />}
          </IconToggle>
        </div>
      ) : null}
      <PropertyRow title={t("frontends.propertiesPanel.position.rotationOpacity")} hideTitle>
        {"rotation" in node ? (
          <NumericField label={t("frontends.propertiesPanel.position.rotation")} prefix="R" unit="°" value={node.rotation} onCommit={(v) => set({ rotation: v }, t("frontends.propertiesPanel.ops.rotate"))} />
        ) : (
          <span />
        )}
        <NumericField label={t("frontends.propertiesPanel.position.opacity")} prefix="O" value={node.opacity} min={0} max={1} onCommit={(v) => set({ opacity: v }, t("frontends.propertiesPanel.ops.opacity"))} />
      </PropertyRow>
      {extra}
      {flow ? (
        <Switch
          label={t("frontends.propertiesPanel.position.ignoreLayout")}
          description={ignored ? t("frontends.propertiesPanel.position.ignoreOn") : t("frontends.propertiesPanel.position.ignoreOff")}
          checked={ignored}
          onCheckedChange={(next) => set({ layoutPositioning: next ? "absolute" : null }, t("frontends.propertiesPanel.ops.ignoreLayout"))}
        />
      ) : null}
    </PanelSection>
  );
}
