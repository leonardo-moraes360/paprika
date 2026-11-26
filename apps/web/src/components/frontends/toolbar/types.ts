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
  /** Also from the keyboard: Enter or Space on the move handle opens the position menu. */
  onDockChange?: (dock: ToolbarDock) => void;
  storageKey?: string;
  /**
   * Turns every key on or off: the tools' hotkeys and Mod+Z, Mod+Y or Mod+Shift+Z, Mod+H, Mod+O and Mod+E.
   * Mod+Z/Y need `onUndo`/`onRedo`, Mod+H `onHistory`, Mod+O `onImport` and Mod+E `onExport`: a key whose
   * handler is absent is not claimed, so the browser keeps it. Inputs are ignored.
   */
  shortcuts?: boolean;
  /**
   * Where the keys listen. Defaults to the element the toolbar is docked in (its parent), so they work while
   * the focus is anywhere inside that stage and never elsewhere on the page. Pass the editor region (or the
   * canvas) to widen or narrow the scope; it must be focusable for the keys to reach it.
   */
  shortcutTarget?: RefObject<HTMLElement | null>;
  className?: string;
};
