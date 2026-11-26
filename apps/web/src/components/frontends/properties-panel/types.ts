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

/** Key labels the owner has bound, e.g. `["Ctrl", "G"]`. Without one, the panel shows no hint for that action. */
export type PropertiesPanelShortcuts = {
  group?: readonly string[];
  ungroup?: readonly string[];
  wrap?: readonly string[];
  center?: readonly string[];
};

/** `onApply` may return a promise: the panel waits for it before it selects what the operation created. */
export type ApplyResult = void | PromiseLike<unknown>;

export type PropertiesPanelProps = {
  doc: Document | null;
  node: Node | null;
  selected: readonly string[];
  lint?: readonly LintIssue[];
  activity?: readonly ActivityEntry[];
  activityMarker?: number;
  header?: ReactNode;
  renderFontPicker?: FontPickerSlot;
  onApply: (ops: Op[], label: string) => ApplyResult;
  onSelect: (ids: string[]) => void;
  onError?: (message: string) => void;
  storageKey?: string;
  shortcuts?: PropertiesPanelShortcuts;
  store?: PropertiesPanelStore;
  className?: string;
};

type AllKeys<T> = T extends unknown ? keyof T : never;

/**
 * Names of the properties a node can have, for an `update` (a value of `null` clears one). Values stay `unknown`
 * because the fields hand over picked strings and the owner validates them in `applyOps`; a misspelled name no longer compiles.
 */
export type NodeProps = { [K in AllKeys<Node>]?: unknown };

export type SetProps = (props: NodeProps, label?: string) => void;
