import { createRegionContext } from "../_shared";

export type SidePanelState = {
  width: number;
  collapsed: boolean;
  dragging: boolean;
};

export const SidePanelRegion = createRegionContext<SidePanelState>("SidePanel");

export function clampWidth(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}
