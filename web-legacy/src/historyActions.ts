import { useSyncExternalStore } from "react";
import { t } from "./i18n/store";
import { toastForStep, type StepResult, type ToastText } from "./historyModel";
import { showToast } from "./lib/toast";
import { liveStore } from "./useDocument";

let open = false;
const listeners = new Set<() => void>();

export function setHistoryOpen(next: boolean | ((v: boolean) => boolean)): void {
  const value = typeof next === "function" ? next(open) : next;
  if (value === open) return;
  open = value;
  for (const l of listeners) l();
}

export const isHistoryOpen = (): boolean => open;

export function useHistoryOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => open,
    () => open,
  );
}

function toastText(): ToastText {
  const m = t();
  return {
    you: m.historyYou,
    refazer: m.toastRedo,
    viewHistory: m.toastViewHistory,
    undone: m.toastUndone,
    undoneOwn: m.toastUndoneOwn,
    undoneAgent: m.toastUndoneAgent,
    redone: m.toastRedone,
    nothingMine: m.toastNothingMine,
    nothingAtAll: m.toastNothingAtAll,
    nothingToRedo: m.toastNothingToRedo,
    conflictUndo: m.toastConflictUndo,
    conflictRedo: m.toastConflictRedo,
    missing: m.toastMissing,
  };
}

async function run(call: () => Promise<StepResult | undefined>, redo: boolean, own: boolean): Promise<void> {
  let res: StepResult | undefined;
  try {
    res = await call();
  } catch (e) {
    liveStore.actions.showError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res) return;
  showToast(toastForStep(res, redo, toastText(), { redoStep, openHistory: () => setHistoryOpen(true) }, { own }));
}

export const undoOwn = () => run(() => liveStore.actions.undoOwn(), false, true);
export const redoOwn = () => run(() => liveStore.actions.redoOwn(), true, true);
export const undoStep = (id: number) => run(() => liveStore.actions.undoStep(id), false, false);
export function redoStep(id: number): Promise<void> {
  return run(() => liveStore.actions.redoStep(id), true, false);
}
