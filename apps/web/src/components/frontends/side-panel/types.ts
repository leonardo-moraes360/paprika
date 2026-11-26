import type { ReactNode } from "react";

export type SidePanelSide = "left" | "right";

export type SidePanelLimits = {
  min: number;
  max: number;
  initial: number;
};

export const sidePanelDefaults: Record<SidePanelSide, SidePanelLimits> = {
  left: { min: 200, max: 480, initial: 248 },
  right: { min: 240, max: 480, initial: 320 },
};

export type SidePanelProps = {
  side: SidePanelSide;
  name: string;
  children: ReactNode;
  icon?: ReactNode;
  minWidth?: number;
  maxWidth?: number;
  initialWidth?: number;
  step?: number;
  storageKey?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  panelClassName?: string;
};
