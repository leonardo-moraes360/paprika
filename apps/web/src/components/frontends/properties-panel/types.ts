import type { Document, LintIssue, Node, Op } from "@paprika/core";
import type { ReactNode } from "react";
import type { AgentTone } from "@/components/ui/agent-tone";
import type { PropertiesPanelStore } from "./store";
import type { FontPickerSlot } from "./sections/typography-section";

export type ActivityEntry = {
  id: string;
  author: string;
  tone?: AgentTone;
  label: string;
  time: string;
  undone?: boolean;
  batch?: boolean;
};

export type PropertiesPanelProps = {
  doc: Document | null;
  node: Node | null;
  selected: readonly string[];
  lint?: readonly LintIssue[];
  activity?: readonly ActivityEntry[];
  activityMarker?: number;
  header?: ReactNode;
  renderFontPicker?: FontPickerSlot;
  onApply: (ops: Op[], label: string) => void;
  onSelect: (ids: string[]) => void;
  onError?: (message: string) => void;
  storageKey?: string;
  store?: PropertiesPanelStore;
  className?: string;
};

export type SetProps = (props: Record<string, unknown>, label?: string) => void;
