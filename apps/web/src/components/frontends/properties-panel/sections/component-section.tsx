import { newId, type FrameNode, type Op } from "@paprika/core";
import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { CommitTextField } from "../fields/commit-text-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

type PropDecl = NonNullable<FrameNode["componentProps"]>[number];

export type ComponentSectionProps = {
  node: FrameNode;
  set: SetProps;
  onApply: (ops: Op[], label: string) => void;
  onSelect: (ids: string[]) => void;
};

const PROP_TYPES = ["text", "boolean", "variant"] as const;

function resetFor(type: PropDecl["type"]): Pick<PropDecl, "default"> & { options?: string[] } {
  if (type === "boolean") return { default: false };
  if (type === "text") return { default: "" };
  return { default: "md", options: ["sm", "md"] };
}

export function ComponentSection({ node, set, onApply, onSelect }: ComponentSectionProps) {
  const { t } = useTranslation();
  const list = node.componentProps ?? [];
  const addButton = useRef<HTMLButtonElement>(null);
  const write = (next: PropDecl[]) => set({ componentProps: next }, t("frontends.propertiesPanel.ops.componentProps"));
  const replace = (index: number, patch: Partial<PropDecl>) => write(list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const createInstance = () => {
    const id = newId();
    const width = typeof node.width === "number" ? node.width : 0;
    onApply([{ op: "create", parentId: node.parentId, node: { type: "frame", id, name: node.name, instanceOf: node.id, x: node.x + width + 40, y: node.y } }], t("frontends.propertiesPanel.ops.createInstance"));
    onSelect([id]);
  };

  return (
    <PanelSection id="component" title={t("frontends.propertiesPanel.component.title")} defaultOpen={!!node.component}>
      <div className="flex flex-wrap gap-2">
        {node.component ? (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={createInstance}>
              {t("frontends.propertiesPanel.component.newInstance")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => set({ component: null }, t("frontends.propertiesPanel.ops.stopComponent"))}>
              {t("frontends.propertiesPanel.component.stop")}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ component: true }, t("frontends.propertiesPanel.ops.makeComponent"))}>
            {t("frontends.propertiesPanel.component.make")}
          </Button>
        )}
      </div>
      {node.component ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.map((decl, index) => (
              <li key={index} role="group" aria-label={t("frontends.propertiesPanel.component.propN", { index: index + 1 })} className="flex flex-col gap-2 rounded-md border border-line p-2">
                <PropertyRow title={t("frontends.propertiesPanel.component.propertyGroup")} hideTitle>
                  <CommitTextField label={t("frontends.propertiesPanel.component.propName")} value={decl.name} validate={(raw) => /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(raw.trim())} invalidMessage={t("frontends.propertiesPanel.component.propNameInvalid")} onCommit={(name) => replace(index, { name: name.trim() })} />
                  <ChoiceField
                    label={t("frontends.propertiesPanel.component.propType")}
                    value={decl.type}
                    options={PROP_TYPES.map((type) => ({ value: type, label: t(`frontends.propertiesPanel.component.types.${type}`) }))}
                    onValueChange={(type) => write(list.map((item, i) => (i === index ? { name: item.name, type: type as PropDecl["type"], ...resetFor(type as PropDecl["type"]) } : item)))}
                  />
                </PropertyRow>
                {decl.type === "boolean" ? (
                  <ChoiceField
                    label={t("frontends.propertiesPanel.component.propDefault")}
                    value={String(decl.default === true)}
                    options={[
                      { value: "true", label: t("frontends.propertiesPanel.layout.values.true") },
                      { value: "false", label: t("frontends.propertiesPanel.layout.values.false") },
                    ]}
                    onValueChange={(value) => replace(index, { default: value === "true" })}
                  />
                ) : decl.type === "variant" ? (
                  <CommitTextField
                    label={t("frontends.propertiesPanel.component.propOptions")}
                    value={(decl.options ?? []).join(" ")}
                    validate={(raw) => raw.trim().split(/[\s,]+/).filter(Boolean).length > 0}
                    invalidMessage={t("frontends.propertiesPanel.component.propOptionsInvalid")}
                    onCommit={(raw) => {
                      const options = raw.trim().split(/[\s,]+/).filter(Boolean);
                      replace(index, { options, default: options.includes(String(decl.default)) ? decl.default : options[0] });
                    }}
                  />
                ) : (
                  <CommitTextField label={t("frontends.propertiesPanel.component.propDefault")} value={String(decl.default ?? "")} onCommit={(value) => replace(index, { default: value })} />
                )}
                <div className="flex justify-end">
                  <IconButton size="sm" aria-label={t("frontends.propertiesPanel.component.removeProp", { index: index + 1 })} onClick={() => {
                      addButton.current?.focus();
                      write(list.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
          <Button ref={addButton} type="button" variant="secondary" size="sm" onClick={() => write([...list, { name: "prop", type: "text", default: "" }])}>
            <Plus aria-hidden="true" />
            {t("frontends.propertiesPanel.component.addProp")}
          </Button>
        </>
      ) : null}
    </PanelSection>
  );
}
