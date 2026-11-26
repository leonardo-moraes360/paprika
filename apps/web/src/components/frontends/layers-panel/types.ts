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
  onSelect: (ids: string[], mode: LayerSelectMode) => void;
  onRename: (id: string, name: string) => void;
  onMove: (move: LayerMove) => void;
  onToggleVisible: (ids: readonly string[], visible: boolean) => void;
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
