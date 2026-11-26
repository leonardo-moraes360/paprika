import { owningComponent, type Document, type Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

type Bind = { text?: string; visible?: string; variant?: Record<string, string | string[]> };

export type BindSectionProps = {
  doc: Document;
  node: Node;
  set: SetProps;
};

export function BindSection({ doc, node, set }: BindSectionProps) {
  const { t } = useTranslation();
  const owner = owningComponent(doc, node.id);
  if (!owner) return null;
  const decls = owner.componentProps ?? [];
  const bind: Bind = ("bind" in node && node.bind ? node.bind : {}) as Bind;
  const write = (next: Bind) => {
    const clean: Bind = {};
    if (next.text) clean.text = next.text;
    if (next.visible) clean.visible = next.visible;
    if (next.variant && Object.keys(next.variant).length) clean.variant = next.variant;
    set({ bind: clean.text || clean.visible || clean.variant ? clean : null }, t("frontends.propertiesPanel.ops.bind"));
  };
  const none = { value: "", label: t("frontends.propertiesPanel.bind.none") };
  const textProps = decls.filter((p) => p.type === "text");
  const boolProps = decls.filter((p) => p.type === "boolean");
  const variantProps = decls.filter((p) => p.type === "variant");

  return (
    <PanelSection id="bind" title={t("frontends.propertiesPanel.bind.title")} defaultOpen>
      <PropertyRow title={t("frontends.propertiesPanel.bind.title")} hideTitle>
        {textProps.length > 0 && (node.type === "text" || node.type === "shape") ? (
          <ChoiceField label={t("frontends.propertiesPanel.bind.text")} value={bind.text ?? ""} options={[none, ...textProps.map((p) => ({ value: p.name, label: p.name }))]} onValueChange={(value) => write({ ...bind, text: value || undefined })} />
        ) : null}
        {boolProps.length > 0 ? (
          <ChoiceField label={t("frontends.propertiesPanel.bind.visible")} value={bind.visible ?? ""} options={[none, ...boolProps.map((p) => ({ value: p.name, label: p.name }))]} onValueChange={(value) => write({ ...bind, visible: value || undefined })} />
        ) : null}
        {variantProps.map((p) => (
          <ChoiceField
            key={p.name}
            label={t("frontends.propertiesPanel.bind.variant", { name: p.name })}
            value={typeof bind.variant?.[p.name] === "string" ? (bind.variant[p.name] as string) : ""}
            options={[none, ...(p.options ?? []).map((o) => ({ value: o, label: o }))]}
            onValueChange={(value) => {
              const variant = { ...bind.variant };
              if (value) variant[p.name] = value;
              else delete variant[p.name];
              write({ ...bind, variant });
            }}
          />
        ))}
      </PropertyRow>
      {node.type === "frame" || node.type === "group" ? (
        <CommitTextField label={t("frontends.propertiesPanel.bind.slot")} value={node.slot ?? ""} onCommit={(slot) => set({ slot: slot.trim() || null }, t("frontends.propertiesPanel.ops.slot"))} />
      ) : null}
    </PanelSection>
  );
}
