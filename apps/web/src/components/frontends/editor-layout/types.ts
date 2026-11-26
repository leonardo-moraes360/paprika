import type { ReactNode } from "react";

export type EditorLayoutSide = "left" | "right";

export type EditorLayoutPanelSize = {
  min: number;
  max: number;
  initial: number;
};

export const editorLayoutDefaults = {
  left: { min: 200, max: 480, initial: 248 },
  right: { min: 240, max: 480, initial: 320 },
  centerMin: 320,
} as const satisfies { left: EditorLayoutPanelSize; right: EditorLayoutPanelSize; centerMin: number };

export type EditorLayoutValue = {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

export type EditorLayoutPanelLabels = {
  region: string;
  resize: string;
  show: string;
  hide: string;
};

export type EditorLayoutLabels = Record<EditorLayoutSide, EditorLayoutPanelLabels>;

export type EditorLayoutProps = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  id?: string;
  leftSize?: EditorLayoutPanelSize;
  rightSize?: EditorLayoutPanelSize;
  centerMinWidth?: number;
  value?: EditorLayoutValue;
  defaultValue?: Partial<EditorLayoutValue>;
  onValueChange?: (value: EditorLayoutValue) => void;
  onValueCommit?: (value: EditorLayoutValue) => void;
  storageKey?: string;
  labels?: { [Side in EditorLayoutSide]?: Partial<EditorLayoutPanelLabels> };
  className?: string;
};
