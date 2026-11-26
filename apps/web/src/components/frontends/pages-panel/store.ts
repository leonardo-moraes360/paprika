import { createRegionContext } from "../_shared";

export type PagesPanelState = {
  renamingId: string | null;
  deletingId: string | null;
};

export const PagesPanelRegion = createRegionContext<PagesPanelState>("PagesPanel");

export const initialPagesPanelState: PagesPanelState = { renamingId: null, deletingId: null };
