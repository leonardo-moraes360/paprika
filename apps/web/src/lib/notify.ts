import { createToaster, type ToastOptions } from "@ui-sdk/react/toast";
import type { ReactNode } from "react";
import type { StatusToastData, ToastStatus, UndoToastData } from "@/components/ui/toast";

export const toaster = createToaster<ReactNode>();

export const toastDurations = { default: 5000, withAction: 8000 } as const;

const sdkTypes = { danger: "error", warning: "warning", info: "info", success: "success" } as const;

const dangerId = "status:danger";

let persistentDanger: string | undefined;

export type ToastAction = { label: ReactNode; onAction?: () => unknown; href?: string };

export type ShowStatusToastInput = {
  status: ToastStatus;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  timeBar?: boolean;
  id?: string;
  onDismiss?: ToastOptions["onDismiss"];
};

export function showStatusToast({ status, title, description, action, timeBar = false, id, onDismiss }: ShowStatusToastInput) {
  const persistent = status === "danger";
  const toastId = persistent ? (id ?? dangerId) : id;
  if (persistent) {
    if (persistentDanger && persistentDanger !== toastId) toaster.dismiss(persistentDanger);
    persistentDanger = toastId;
  }
  return toaster(title, {
    id: toastId,
    description,
    type: sdkTypes[status],
    duration: persistent ? Infinity : action ? toastDurations.withAction : toastDurations.default,
    priority: persistent ? "assertive" : "polite",
    action: action ? { label: action.label, onAction: action.onAction, href: action.href } : undefined,
    data: { kind: "status", status, timeBar: timeBar && !persistent } satisfies StatusToastData,
    onDismiss: (details) => {
      if (persistent && persistentDanger === toastId) persistentDanger = undefined;
      onDismiss?.(details);
    },
  });
}

export type ShowUndoToastInput = {
  title: ReactNode;
  action: ToastAction;
  icon?: ReactNode;
  shortcut?: ReactNode;
  id?: string;
};

export function showUndoToast({ title, action, icon, shortcut, id }: ShowUndoToastInput) {
  return toaster(title, {
    id,
    duration: toastDurations.withAction,
    action: { label: action.label, onAction: action.onAction, href: action.href },
    data: { kind: "undo", icon, shortcut } satisfies UndoToastData,
  });
}

export function dismissToasts() {
  persistentDanger = undefined;
  toaster.dismiss();
}
