import { useSyncExternalStore } from "react";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastInput {
  message: string;
  tone?: "undo" | "info";
  action?: ToastAction;
  hint?: string[];
}

export interface ToastItem extends ToastInput {
  id: number;
}

export const TOAST_MS = 6000;

let current: ToastItem | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

export function showToast(input: ToastInput): number {
  current = { ...input, id: ++seq };
  emit();
  return current.id;
}

export function dismissToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function currentToast(): ToastItem | null {
  return current;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useToast(): ToastItem | null {
  return useSyncExternalStore(subscribe, currentToast, currentToast);
}
