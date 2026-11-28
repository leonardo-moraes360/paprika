import type { ReactNode } from "react";

export type ZoomRenderer = {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  reason?: string;
};

export type ZoomBarProps = {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  renderers?: readonly ZoomRenderer[];
  renderer?: string;
  switching?: boolean;
  onRendererChange?: (id: string) => void;
  className?: string;
};
