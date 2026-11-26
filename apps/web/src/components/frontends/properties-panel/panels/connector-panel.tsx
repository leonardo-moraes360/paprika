import { modeOf, type ConnectorEnd, type ConnectorNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { InlineNotice } from "@/components/ui/inline-notice";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { ColorValueField } from "../fields/color-value-field";
import { CommitTextField } from "../fields/commit-text-field";
import { NumericField } from "../fields/numeric-field";
import { IdentityHeader } from "../identity-header";
import { PanelSection } from "../panel-section";
import { ArrangeSection } from "../sections/arrange-section";
import { BindSection } from "../sections/bind-section";
import { NotesSection } from "../sections/notes-section";
import type { NodePanelBase } from "./shared";

const SIDES = ["auto", "top", "right", "bottom", "left"] as const;
const ROUTES = ["straight", "elbow", "rounded", "curve"] as const;
const ARROWS = ["none", "arrow"] as const;

export function ConnectorPanel({ doc, node, set, onApply, onSelect }: NodePanelBase<ConnectorNode>) {
  const { t } = useTranslation();
  const label = t("frontends.propertiesPanel.ops.connector");
  const yesNo = [
    { value: "true", label: t("frontends.propertiesPanel.layout.values.true") },
    { value: "false", label: t("frontends.propertiesPanel.layout.values.false") },
  ];

  const end = (key: "from" | "to", value: ConnectorEnd) => {
    const title = t(key === "from" ? "frontends.propertiesPanel.connector.start" : "frontends.propertiesPanel.connector.end");
    if (value.nodeId === undefined) return <InlineNotice key={key}>{t("frontends.propertiesPanel.connector.loose", { end: title, x: value.x ?? 0, y: value.y ?? 0 })}</InlineNotice>;
    const target = value.nodeId;
    return (
      <div key={key} className="flex flex-col gap-1.5">
        <p className="text-xs text-muted">
          {title}:{" "}
          <button type="button" className="cursor-pointer font-semibold text-select-ink underline focus-visible:outline-2 focus-visible:outline-select" onClick={() => onSelect([target])}>
            {doc.nodes[target]?.name || `#${target}`}
          </button>
        </p>
        <ChoiceField
          label={t(key === "from" ? "frontends.propertiesPanel.connector.startSide" : "frontends.propertiesPanel.connector.endSide")}
          value={value.side ?? "auto"}
          options={SIDES.map((side) => ({ value: side, label: t(`frontends.propertiesPanel.connector.sides.${side}`) }))}
          onValueChange={(side) => set({ [key]: { nodeId: target, side } }, label)}
        />
      </div>
    );
  };

  return (
    <div key={node.id} data-testid="connector-panel">
      <IdentityHeader kind="connector" id={node.id} name={node.name} onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.rename"))} />
      <PanelSection id="connector-label" title={t("frontends.propertiesPanel.connector.labelTitle")} defaultOpen>
        <CommitTextField
          label={t("frontends.propertiesPanel.connector.label")}
          placeholder={t("frontends.propertiesPanel.connector.labelHint")}
          value={node.label ?? ""}
          onCommit={(value) => set({ label: value.trim() ? value.trim() : null }, t("frontends.propertiesPanel.ops.connectorLabel"))}
        />
      </PanelSection>
      <PanelSection id="connector-ends" title={t("frontends.propertiesPanel.connector.ends")} defaultOpen>
        {end("from", node.from)}
        {end("to", node.to)}
      </PanelSection>
      <PanelSection id="connector-stroke" title={t("frontends.propertiesPanel.connector.stroke")} defaultOpen>
        <PropertyRow title={t("frontends.propertiesPanel.connector.stroke")} hideTitle>
          <ChoiceField label={t("frontends.propertiesPanel.connector.route")} value={node.route} options={ROUTES.map((route) => ({ value: route, label: t(`frontends.propertiesPanel.connector.routes.${route}`) }))} onValueChange={(route) => set({ route }, label)} />
          <ChoiceField label={t("frontends.propertiesPanel.connector.dashed")} value={String(node.dashed)} options={yesNo} onValueChange={(value) => set({ dashed: value === "true" }, label)} />
          <ChoiceField label={t("frontends.propertiesPanel.connector.startArrow")} value={node.startArrow} options={ARROWS.map((arrow) => ({ value: arrow, label: t(`frontends.propertiesPanel.connector.arrows.${arrow}`) }))} onValueChange={(startArrow) => set({ startArrow }, label)} />
          <ChoiceField label={t("frontends.propertiesPanel.connector.endArrow")} value={node.endArrow} options={ARROWS.map((arrow) => ({ value: arrow, label: t(`frontends.propertiesPanel.connector.arrows.${arrow}`) }))} onValueChange={(endArrow) => set({ endArrow }, label)} />
        </PropertyRow>
        {node.route === "rounded" ? <NumericField label={t("frontends.propertiesPanel.radius.radius")} prefix="r" unit="px" min={0} value={node.radius} onCommit={(radius) => set({ radius }, label)} /> : null}
        {node.route === "curve" ? <InlineNotice>{t("frontends.propertiesPanel.connector.curveHint")}</InlineNotice> : null}
        <ColorValueField doc={doc} mode={modeOf(doc, node)} label={t("frontends.propertiesPanel.border.color")} value={node.stroke.color} clearable={false} onCommit={(color) => color && set({ stroke: { ...node.stroke, color } }, label)} />
        <PropertyRow title={t("frontends.propertiesPanel.connector.stroke")} hideTitle>
          <NumericField label={t("frontends.propertiesPanel.border.width")} prefix="W" unit="px" min={0} value={node.stroke.width} onCommit={(width) => set({ stroke: { ...node.stroke, width } }, label)} />
          <NumericField label={t("frontends.propertiesPanel.position.opacity")} prefix="O" min={0} max={1} value={node.opacity} onCommit={(opacity) => set({ opacity }, label)} />
        </PropertyRow>
        <InlineNotice>{t("frontends.propertiesPanel.connector.followHint")}</InlineNotice>
      </PanelSection>
      <BindSection doc={doc} node={node} set={set} />
      <ArrangeSection ids={[node.id]} onApply={onApply} />
      <NotesSection notes={node.notes} set={set} />
    </div>
  );
}
