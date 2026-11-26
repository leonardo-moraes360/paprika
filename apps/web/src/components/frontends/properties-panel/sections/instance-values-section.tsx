import { isInstance, type Document, type FrameNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

export type InstanceValuesSectionProps = {
  doc: Document;
  instance: FrameNode & { instanceOf: string };
  set: SetProps;
};

function slotFrames(doc: Document, componentId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    const node = doc.nodes[id];
    if (!node || !("children" in node)) return;
    for (const childId of node.children) {
      const child = doc.nodes[childId];
      if (!child || ("sourceId" in child && child.sourceId)) continue;
      if ("slot" in child && child.slot) out.push(child.slot);
      if (!isInstance(child)) walk(childId);
    }
  };
  walk(componentId);
  return out;
}

export function InstanceValuesSection({ doc, instance, set }: InstanceValuesSectionProps) {
  const { t } = useTranslation();
  const component = doc.nodes[instance.instanceOf];
  const decls = component?.type === "frame" ? (component.componentProps ?? []) : [];
  const slots = slotFrames(doc, instance.instanceOf);
  const overrides = Object.keys(instance.overrides ?? {});
  if (!decls.length && !slots.length && !overrides.length) return null;
  const label = t("frontends.propertiesPanel.ops.instanceProp");
  const yesNo = [
    { value: "true", label: t("frontends.propertiesPanel.layout.values.true") },
    { value: "false", label: t("frontends.propertiesPanel.layout.values.false") },
  ];
  return (
    <PanelSection id="instance-props" title={t("frontends.propertiesPanel.instance.values")} defaultOpen>
      <PropertyRow title={t("frontends.propertiesPanel.instance.values")} hideTitle>
        {decls.map((decl) => {
          const current = instance.propValues?.[decl.name];
          const write = (value: string | boolean) => set({ propValues: { ...instance.propValues, [decl.name]: value } }, label);
          if (decl.type === "boolean") return <ChoiceField key={decl.name} label={decl.name} value={String(current === true)} options={yesNo} onValueChange={(value) => write(value === "true")} />;
          if (decl.type === "variant")
            return (
              <ChoiceField
                key={decl.name}
                label={decl.name}
                value={typeof current === "string" ? current : String(decl.default ?? decl.options?.[0] ?? "")}
                options={(decl.options ?? []).map((option) => ({ value: option, label: option }))}
                onValueChange={write}
              />
            );
          return <CommitTextField key={decl.name} label={decl.name} value={typeof current === "string" ? current : String(decl.default ?? "")} onCommit={write} />;
        })}
        {slots.map((slot) => (
          <CommitTextField
            key={slot}
            label={t("frontends.propertiesPanel.instance.slot", { name: slot })}
            placeholder={t("frontends.propertiesPanel.instance.slotHint")}
            value={(instance.slots?.[slot] ?? []).join(" ")}
            onCommit={(raw) => set({ slots: { ...instance.slots, [slot]: raw.trim() ? raw.trim().split(/[\s,]+/) : [] } }, t("frontends.propertiesPanel.ops.instanceSlot"))}
          />
        ))}
      </PropertyRow>
      {overrides.length > 0 ? <p className="text-xs text-muted">{t("frontends.propertiesPanel.instance.overrides", { list: overrides.join(", ") })}</p> : null}
    </PanelSection>
  );
}
