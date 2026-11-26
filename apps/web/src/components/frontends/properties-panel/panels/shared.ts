import type { Document, Node, Op } from "@paprika/core";
import type { FontPickerSlot } from "../sections/typography-section";
import type { SetProps } from "../types";

export type PanelBase = {
  doc: Document;
  onApply: (ops: Op[], label: string) => void;
  onSelect: (ids: string[]) => void;
  onError?: (message: string) => void;
  renderFontPicker?: FontPickerSlot;
};

export type NodePanelBase<N extends Node> = PanelBase & {
  node: N;
  set: SetProps;
};
