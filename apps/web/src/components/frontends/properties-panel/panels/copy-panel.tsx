import { modeOf, type FrameNode, type SceneNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ChoiceField } from "../fields/choice-field";
import { ColorValueField } from "../fields/color-value-field";
import { CommitTextField } from "../fields/commit-text-field";
import { OpacityField } from "../fields/opacity-field";
import { IdentityHeader } from "../identity-header";
import { PanelSection } from "../panel-section";
import type { NodePanelBase } from "./shared";

// A copy inside an instance keeps its position, size and structure from the component. What it can override is
// `COPY_OVERRIDES` in the core: fill, color, text, src, visible and opacity.
export function CopyPanel({ doc, node, instance, set, onSelect }: NodePanelBase<SceneNode> & { instance: FrameNode }) {
  const { t } = useTranslation();
  const source = node.sourceId;
  const label = t("frontends.propertiesPanel.ops.override");
  const mode = modeOf(doc, node);
  const overridden = source ? Object.keys(instance.overrides?.[source] ?? {}) : [];
  const yesNo = [
    { value: "true", label: t("frontends.propertiesPanel.layout.values.true") },
    { value: "false", label: t("frontends.propertiesPanel.layout.values.false") },
  ];
  const paints = node.type !== "group" && node.type !== "connector";

  return (
    <div key={node.id} data-testid="copy-panel">
      <IdentityHeader kind={node.type} id={node.id} name={node.name} onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.rename"))} />
      <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3.5">
        <p className="text-xs text-muted">{t("frontends.propertiesPanel.copy.description", { name: instance.name || instance.id })}</p>
        <div className="flex flex-wrap gap-2">
          {source ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => onSelect([source])}>
              {t("frontends.propertiesPanel.copy.goToSource")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={() => onSelect([instance.id])}>
            {t("frontends.propertiesPanel.copy.goToInstance")}
          </Button>
        </div>
      </div>
      <PanelSection id="copy-appearance" title={t("frontends.propertiesPanel.copy.appearance")} defaultOpen>
        {node.type === "text" ? (
          <>
            <CommitTextField
              label={t("frontends.propertiesPanel.copy.content")}
              multiline
              value={node.text}
              onCommit={(text) => set({ text, ...(text !== node.text && node.runs?.length ? { runs: null } : {}) }, label)}
            />
            <ColorValueField doc={doc} mode={mode} label={t("frontends.propertiesPanel.copy.textColor")} value={node.color} clearable={false} onCommit={(color) => color && set({ color }, label)} />
          </>
        ) : null}
        {paints && "fill" in node ? (
          <ColorValueField doc={doc} mode={mode} showLabel label={t("frontends.propertiesPanel.copy.fill")} value={node.fill as string | undefined} onCommit={(fill) => set({ fill }, label)} />
        ) : null}
        {node.type === "image" ? (
          <CommitTextField
            label={t("frontends.propertiesPanel.copy.url")}
            value={node.src.startsWith("data:") ? t("frontends.propertiesPanel.copy.dataUri") : node.src}
            onCommit={(src) => src !== t("frontends.propertiesPanel.copy.dataUri") && set({ src }, label)}
          />
        ) : null}
        <OpacityField label={t("frontends.propertiesPanel.position.opacity")} value={node.opacity} onCommit={(opacity) => set({ opacity }, label)} />
        <ChoiceField label={t("frontends.propertiesPanel.copy.visible")} value={String(node.visible)} options={yesNo} onValueChange={(visible) => set({ visible: visible === "true" }, label)} />
      </PanelSection>
      {overridden.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => set(Object.fromEntries(overridden.map((key) => [key, null])), t("frontends.propertiesPanel.ops.clearOverrides"))}>
            {t("frontends.propertiesPanel.copy.restore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
