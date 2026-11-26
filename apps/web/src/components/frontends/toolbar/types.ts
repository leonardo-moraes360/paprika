import type { ReactNode, RefObject } from "react";

export type ToolbarDock = "top" | "left" | "right" | "bottom";

export const toolbarDocks: readonly ToolbarDock[] = ["top", "left", "right", "bottom"];

export type ToolbarToolOption = {
  id: string;
  label: string;
  icon: ReactNode;
  hotkey?: string;
};

export type ToolbarTool = {
  id: string;
  label: string;
  icon: ReactNode;
  hotkey?: string;
  options?: readonly ToolbarToolOption[];
  separatorBefore?: boolean;
};

export type ToolbarProps = {
  tools: readonly ToolbarTool[];
  value: string;
  onValueChange: (id: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onHistory?: () => void;
  onImport?: () => void;
  onExport?: () => void;
  dock?: ToolbarDock;
  defaultDock?: ToolbarDock;
  onDockChange?: (dock: ToolbarDock) => void;
  storageKey?: string;
  shortcuts?: boolean;
  shortcutTarget?: RefObject<HTMLElement | null>;
  className?: string;
};
