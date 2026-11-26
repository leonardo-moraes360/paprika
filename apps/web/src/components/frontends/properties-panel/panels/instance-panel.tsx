import type { FrameNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ColorValueField } from "../fields/color-value-field";
import { NumericField } from "../fields/numeric-field";
import { IdentityHeader } from "../identity-header";
import { PanelSection } from "../panel-section";
import { ArrangeSection } from "../sections/arrange-section";
import { ConstraintsSection } from "../sections/constraints-section";
import { InstanceValuesSection } from "../sections/instance-values-section";
import { NotesSection } from "../sections/notes-section";
import { PositionSection } from "../sections/position-section";
import type { NodePanelBase } from "./shared";

export function InstancePanel({ doc, node, set, onApply, onSelect }: NodePanelBase<FrameNode & { instanceOf: string }>) {
  const { t } = useTranslation();
  const component = doc.nodes[node.instanceOf];
  const overrides = Object.keys(node.overrides ?? {}).length;
  const label = t("frontends.propertiesPanel.ops.instance");
  return (
    <div key={node.id} data-testid="instance-panel">
      <IdentityHeader
        kind="instance"
        id={node.id}
        name={node.name}
        onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.rename"))}
        note={
          <p className="text-xs text-muted">
            {t("frontends.propertiesPanel.instance.of")}{" "}
            <button type="button" className="cursor-pointer font-semibold text-select-ink underline focus-visible:outline-2 focus-visible:outline-select" onClick={() => onSelect([node.instanceOf])}>
              {component?.name || node.instanceOf}
            </button>
            {overrides > 0 ? ` · ${t("frontends.propertiesPanel.instance.overrideCount", { count: overrides })}` : null}
          </p>
        }
      />
      <InstanceValuesSection doc={doc} instance={node} set={set} />
      <PositionSection
        doc={doc}
        node={node}
        set={set}
        resizable={false}
        extra={
          <>
            <NumericField label={t("frontends.propertiesPanel.instance.scale")} prefix="S" min={0.01} max={100} value={node.scale ?? 1} onCommit={(scale) => set({ scale }, label)} />
            <InlineNotice>{t("frontends.propertiesPanel.instance.size", { width: node.width, height: node.height })}</InlineNotice>
          </>
        }
      />
      <ConstraintsSection doc={doc} node={node} set={set} />
      <PanelSection id="instance-fill" title={t("frontends.propertiesPanel.instance.fill")}>
        <ColorValueField doc={doc} label={t("frontends.propertiesPanel.fill.color")} value={node.fill} onCommit={(fill) => set({ fill }, t("frontends.propertiesPanel.ops.override"))} />
      </PanelSection>
      <ArrangeSection ids={[node.id]} onApply={onApply} />
      <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-3.5">
        <Button type="button" variant="secondary" size="sm" onClick={() => onSelect([node.instanceOf])}>
          {t("frontends.propertiesPanel.instance.goToComponent")}
        </Button>
        {overrides > 0 ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ overrides: null }, t("frontends.propertiesPanel.ops.clearOverrides"))}>
            {t("frontends.propertiesPanel.instance.clearOverrides")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => onApply([{ op: "detach", ids: [node.id] }], t("frontends.propertiesPanel.ops.detach"))}>
          {t("frontends.propertiesPanel.instance.detach")}
        </Button>
      </div>
      <NotesSection notes={node.notes} set={set} />
    </div>
  );
}
