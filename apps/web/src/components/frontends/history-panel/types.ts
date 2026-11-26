import type { HistoryAuthor, HistoryStepData } from "@/lib/history-model";

export type { HistoryAuthor, HistoryStepData };

export type HistoryPanelProps = {
  steps: readonly HistoryStepData[];
  loading?: boolean;
  now?: number;
  clock?: () => number;
  mineOnly?: boolean;
  defaultMineOnly?: boolean;
  onMineOnlyChange?: (mineOnly: boolean) => void;
  onUndoStep: (id: string) => Promise<unknown>;
  onRedoStep: (id: string) => Promise<unknown>;
  onSelectNodes: (nodeIds: string[], stepId: string) => void;
  onClose: () => void;
  shortcut?: readonly string[];
  className?: string;
};
