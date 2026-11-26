import { createRegion } from "../_shared";

export type PagesPanelState = {
  renamingId: string | null;
  deletingId: string | null;
};

export type PagesPanelActions = {
  startRename: (id: string) => void;
  stopRename: () => void;
  askDelete: (id: string) => void;
  cancelDelete: () => void;
};

export const PagesPanelRegion = createRegion<PagesPanelState, PagesPanelActions>("PagesPanel", ({ setState }) => ({
  startRename: (id) => setState((s) => ({ ...s, renamingId: id })),
  stopRename: () => setState((s) => (s.renamingId === null ? s : { ...s, renamingId: null })),
  askDelete: (id) => setState((s) => ({ ...s, deletingId: id })),
  cancelDelete: () => setState((s) => (s.deletingId === null ? s : { ...s, deletingId: null })),
}));

export const initialPagesPanelState: PagesPanelState = { renamingId: null, deletingId: null };
