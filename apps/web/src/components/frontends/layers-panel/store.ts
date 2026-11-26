import { createRegion } from "../_shared";

export type LayersPanelState = {
  renamingId: string | null;
  dragging: readonly string[] | null;
};

export type LayersPanelActions = {
  startRename: (id: string) => void;
  stopRename: () => void;
  startDrag: (ids: readonly string[]) => void;
  endDrag: () => void;
};

export const LayersPanelRegion = createRegion<LayersPanelState, LayersPanelActions>("LayersPanel", ({ setState }) => ({
  startRename: (id) => setState((s) => ({ ...s, renamingId: id })),
  stopRename: () => setState((s) => (s.renamingId === null ? s : { ...s, renamingId: null })),
  startDrag: (ids) => setState((s) => ({ ...s, dragging: ids })),
  endDrag: () => setState((s) => (s.dragging === null ? s : { ...s, dragging: null })),
}));

export const initialLayersPanelState: LayersPanelState = { renamingId: null, dragging: null };
