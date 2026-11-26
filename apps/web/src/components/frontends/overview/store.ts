import { createRegion } from "../_shared";

export type OverviewState = {
  renamingId: string | null;
  deletingId: string | null;
  creating: boolean;
};

export type OverviewActions = {
  startRename: (id: string) => void;
  stopRename: () => void;
  askDelete: (id: string) => void;
  cancelDelete: () => void;
  openCreate: () => void;
  closeCreate: () => void;
};

export const OverviewRegion = createRegion<OverviewState, OverviewActions>("Overview", ({ setState }) => ({
  startRename: (id) => setState((s) => ({ ...s, renamingId: id })),
  stopRename: () => setState((s) => (s.renamingId === null ? s : { ...s, renamingId: null })),
  askDelete: (id) => setState((s) => ({ ...s, deletingId: id })),
  cancelDelete: () => setState((s) => (s.deletingId === null ? s : { ...s, deletingId: null })),
  openCreate: () => setState((s) => (s.creating ? s : { ...s, creating: true })),
  closeCreate: () => setState((s) => (s.creating ? { ...s, creating: false } : s)),
}));

export const initialOverviewState: OverviewState = { renamingId: null, deletingId: null, creating: false };
