import { ungroupOps, type GroupNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { errorMessageOr } from "@/lib/use-async-action";
import { Button } from "@/components/ui/button";
import { IdentityHeader } from "../identity-header";
import { ArrangeSection } from "../sections/arrange-section";
import { BindSection } from "../sections/bind-section";
import { ConstraintsSection } from "../sections/constraints-section";
import { NotesSection } from "../sections/notes-section";
import { PositionSection } from "../sections/position-section";
import type { NodePanelBase } from "./shared";

export function GroupPanel({ doc, node, set, onApply, onSelect, onError }: NodePanelBase<GroupNode>) {
  const { t } = useTranslation();
  const ungroup = () => {
    try {
      const { released } = ungroupOps(doc, [node.id]);
      onApply([{ op: "ungroup", ids: [node.id] }], t("frontends.propertiesPanel.ops.ungroup"));
      onSelect(released);
    } catch (error) {
      onError?.(errorMessageOr(error, t("frontends.propertiesPanel.unknownError")));
    }
  };
  return (
    <div key={node.id} data-testid="group-panel">
      <IdentityHeader kind="group" id={node.id} name={node.name} onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.rename"))} />
      <PositionSection
        doc={doc}
        node={node}
        set={set}
        resizable={false}
        extra={
          <>
            <p className="text-xs text-muted">{t("frontends.propertiesPanel.group.size", { width: node.width, height: node.height, count: node.children.length })}</p>
            <Button type="button" variant="secondary" size="sm" onClick={ungroup}>
              {t("frontends.propertiesPanel.multi.ungroup")}
            </Button>
          </>
        }
      />
      <ConstraintsSection doc={doc} node={node} set={set} />
      <BindSection doc={doc} node={node} set={set} />
      <ArrangeSection ids={[node.id]} onApply={onApply} />
      <NotesSection notes={node.notes} set={set} />
    </div>
  );
}
