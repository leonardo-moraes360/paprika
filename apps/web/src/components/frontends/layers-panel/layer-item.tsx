import { memo, useCallback, useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { toneDot } from "@/components/ui/agent-tone";
import { LayerRow } from "@/components/ui/layer-row";
import { cn } from "@/lib/utils";
import { layerIcons } from "./layer-icons";
import { LayersPanelRegion } from "./store";
import type { LayerRowData } from "./types";

export const LAYER_ROW_HEIGHT = 28;

export type LayerItemProps = {
  row: LayerRowData;
  index: number;
  onToggleVisible: (ids: readonly string[], visible: boolean) => void;
  onToggleLocked: (ids: readonly string[], locked: boolean) => void;
  onRename: (id: string, name: string) => void;
};

function LayerItemView({ row, index, onToggleVisible, onToggleLocked, onRename }: LayerItemProps) {
  const { t } = useTranslation();
  const actions = LayersPanelRegion.useRegionActions();
  const renaming = LayersPanelRegion.useRegion((s) => s.renamingId === row.id);
  const dragging = LayersPanelRegion.useRegion((s) => s.dragging?.includes(row.id) ?? false);
  const item = useRef<HTMLDivElement | null>(null);
  const settled = useRef(false);
  const returnFocus = useRef(false);
  const Icon = layerIcons[row.kind];
  const canRename = row.renamable !== false;

  useLayoutEffect(() => {
    if (renaming) settled.current = false;
    else if (returnFocus.current) {
      returnFocus.current = false;
      item.current?.focus();
    }
  }, [renaming]);

  const finishRename = useCallback(
    (value: string | null) => {
      if (settled.current) return;
      settled.current = true;
      returnFocus.current = item.current?.contains(document.activeElement) ?? false;
      actions.stopRename();
      const name = value?.trim();
      if (name && name !== row.name) onRename(row.id, name);
    },
    [actions, onRename, row.id, row.name],
  );

  const style: CSSProperties = { position: "absolute", insetInline: 0, top: index * LAYER_ROW_HEIGHT, height: LAYER_ROW_HEIGHT };

  return (
    <LayerRow
      value={row.id}
      name={row.name}
      icon={<Icon />}
      branch={row.hasChildren}
      visible={row.visible}
      locked={row.locked}
      renaming={renaming}
      renameLabel={t("frontends.layersPanel.renameLayer")}
      hideLabel={t("frontends.layersPanel.hideLayer", { name: row.name })}
      lockLabel={t("frontends.layersPanel.lockLayer", { name: row.name })}
      itemProps={{ ref: item, style, "data-layer-id": row.id, "data-dragging": dragging ? "" : undefined }}
      className={cn("[[data-dragging]>&]:opacity-45")}
      onDoubleClick={(event: MouseEvent<HTMLDivElement>) => {
        if (!canRename || (event.target as Element).closest("button")) return;
        actions.startRename(row.id);
      }}
      onVisibleChange={(visible) => onToggleVisible([row.id], visible)}
      onLockedChange={row.lockable === false ? undefined : (locked) => onToggleLocked([row.id], locked)}
      onRename={finishRename}
      onRenameCancel={() => finishRename(null)}
      trailing={
        row.agent ? (
          <span
            role="img"
            aria-label={t("frontends.layersPanel.touchedBy", { name: row.agent.name })}
            className={cn("me-1 size-2 shrink-0 rounded-full", toneDot[row.agent.tone])}
          />
        ) : null
      }
    />
  );
}

export const LayerItem = memo(LayerItemView);
