import type { ReactNode } from "react";
import type { AgentColor } from "@/components/ui/agent-tone";

export type LayerKind = "frame" | "rect" | "ellipse" | "text" | "image" | "path" | "group" | "component" | "instance" | "shape" | "connector";

export type LayerAgent = {
  name: string;
  tone: AgentColor;
};

export type LayerRowData = {
  id: string;
  name: string;
  kind: LayerKind;
  level: number;
  hasChildren: boolean;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  agent?: LayerAgent;
  draggable?: boolean;
  renamable?: boolean;
  lockable?: boolean;
  container?: boolean;
  dropTarget?: boolean;
};

export type LayerSelectMode = "replace" | "toggle" | "extend";

export type LayerDropPosition = "before" | "after" | "inside";

export type LayerMove = {
  ids: readonly string[];
  targetId: string;
  position: LayerDropPosition;
};

export type LayerContextItem = {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  icon?: ReactNode;
};

export type LayersPanelProps = {
  rows: readonly LayerRowData[];
  /**
   * The ids the person asked for. The tree is controlled by `rows`: answer `false` when the selection stays as it is (a click on
   * the only selected layer, say) so the panel tells the tree the change did not happen; anything else (nothing, `true`) means it was taken.
   */
  onSelect: (ids: string[], mode: LayerSelectMode) => void | boolean;
  onRename: (id: string, name: string) => void;
  /**
   * Emitted by the pointer drag and by the keyboard with the same shape. Keyboard, with the focus on a layer
   * (acts on the selection when the layer is in it): Alt+ArrowUp and Alt+ArrowDown swap with the neighbouring sibling,
   * Alt+ArrowRight goes inside the sibling above and Alt+ArrowLeft lands after the parent (mirrored in right-to-left).
   */
  onMove: (move: LayerMove) => void;
  /** Also from Ctrl/Cmd+Shift+H on a focused layer: the whole selection when the layer is in it, else the layer alone. */
  onToggleVisible: (ids: readonly string[], visible: boolean) => void;
  /** Also from Ctrl/Cmd+Shift+L, with the same scope as `onToggleVisible`. */
  onToggleLocked: (ids: readonly string[], locked: boolean) => void;
  onContextAction?: (action: string, ids: readonly string[]) => void;
  contextActions?: (ids: readonly string[]) => readonly LayerContextItem[];
  onRevealAll?: (kind: "hidden" | "locked") => void;
  collapsedIds?: readonly string[];
  defaultCollapsedIds?: readonly string[];
  onCollapsedChange?: (ids: string[]) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  storageKey?: string;
  virtualizeAfter?: number;
  className?: string;
};
