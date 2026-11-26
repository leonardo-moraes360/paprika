import { PropertiesPanelRegion } from "./store";
export { PropertiesPanel } from "./properties-panel";
export { initialPropertiesPanelState, PropertiesPanelRegion } from "./store";
export type { PropertiesPanelState, PropertiesPanelStore } from "./store";
export type { FontPickerSlot } from "./sections/typography-section";
export type { ActivityEntry, PropertiesPanelProps } from "./types";
export const usePropertiesPanelStore = () => PropertiesPanelRegion.useRegionStore();
export const useCreatePropertiesPanelStore = PropertiesPanelRegion.useCreateRegionStore;
export const PropertiesPanelProvider = PropertiesPanelRegion.Provider;
