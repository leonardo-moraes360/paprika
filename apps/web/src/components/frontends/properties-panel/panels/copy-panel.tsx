import type { FrameNode, SceneNode } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IdentityHeader } from "../identity-header";
import type { NodePanelBase } from "./shared";

export function CopyPanel({ node, instance, set, onSelect }: NodePanelBase<SceneNode> & { instance: FrameNode }) {
  const { t } = useTranslation();
  const source = node.sourceId;
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
    </div>
  );
}
