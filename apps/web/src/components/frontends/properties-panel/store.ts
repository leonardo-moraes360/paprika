import type { Store } from "@tanstack/react-store";
import { createRegion } from "../_shared";

export type PropertiesPanelState = {
  open: Record<string, boolean>;
};

export type PropertiesPanelActions = {
  setSectionOpen: (id: string, open: boolean) => void;
};

export const PropertiesPanelRegion = createRegion<PropertiesPanelState, PropertiesPanelActions>("PropertiesPanel", ({ setState }) => ({
  setSectionOpen: (id, open) => setState((s) => (s.open[id] === open ? s : { ...s, open: { ...s.open, [id]: open } })),
}));

export type PropertiesPanelStore = Store<PropertiesPanelState, PropertiesPanelActions>;

export const initialPropertiesPanelState = (open: Record<string, boolean> = {}): PropertiesPanelState => ({ open });

export const isOpenMap = (value: unknown): value is Record<string, boolean> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "boolean");
