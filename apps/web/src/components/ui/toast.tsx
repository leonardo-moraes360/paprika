import { Toast, ToastAction, ToastClose, ToastDescription, ToastRegion, ToastTitle, type Toaster, type ToastOptions } from "@ui-sdk/react/toast";
import { Undo2, X } from "lucide-react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { StatusIcon, type Status } from "./status-icon";

export type ToastStatus = Status;

const barTones: Record<ToastStatus, string> = {
  danger: "bg-red-ink",
  warning: "bg-warn",
  info: "bg-select",
  success: "bg-green-ink",
};

const sdkTypes = { danger: "error", warning: "warning", info: "info", success: "success" } as const;

export const toastDurations = { default: 5000, withAction: 8000 } as const;

const surfaceClasses =
  "relative flex w-full flex-col overflow-hidden rounded-[10px] border border-line bg-popover text-fg shadow-popover forced-colors:border-2";

export type ToastShellProps = Omit<ComponentProps<"div">, "title"> & {
  leading: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  close?: ReactNode;
  timeBar?: ReactNode;
};

export function ToastShell({ leading, title, description, actions, close, timeBar, className, ...props }: ToastShellProps) {
  return (
    <div className={cn(surfaceClasses, className)} {...props}>
      <div className="flex items-start gap-3 py-3 pr-2 pl-3">
        {leading}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
          <div className="text-sm leading-[1.45] font-semibold text-fg">{title}</div>
          {description ? <div className="text-xs leading-[1.45] text-muted empty:hidden">{description}</div> : null}
          {actions ? <div className="flex items-center gap-2 pt-2">{actions}</div> : null}
        </div>
        {close}
      </div>
      {timeBar}
    </div>
  );
}

export type ToastTimeBarProps = {
  status: ToastStatus;
  duration?: number;
  progress?: number;
};

export function ToastTimeBar({ status, duration, progress = 1 }: ToastTimeBarProps) {
  const style: CSSProperties =
    duration === undefined
      ? { transform: `scaleX(${progress})` }
      : { animation: `paprika-toast-time ${duration}ms linear forwards` };
  return (
    <div aria-hidden="true" className="h-[3px] w-full bg-surface motion-reduce:hidden">
      <style href="paprika-toast-time" precedence="default">{"@keyframes paprika-toast-time{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}</style>
      <div className={cn("h-full origin-left group-data-expanded/toast:[animation-play-state:paused]", barTones[status])} style={style} />
    </div>
  );
}

export type StatusToastProps = Omit<ComponentProps<"div">, "title"> & {
  status: ToastStatus;
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  closeLabel?: string;
  progress?: number;
  actionPendingAnnouncement?: string;
};

export function StatusToast({ status, title, description, actionLabel, closeLabel, progress, actionPendingAnnouncement = "", ...props }: StatusToastProps) {
  return (
    <ToastShell
      role={status === "danger" ? "alert" : "status"}
      leading={<StatusIcon status={status} />}
      title={title}
      description={description}
      actions={actionLabel ? <Button variant="secondary" size="sm" pendingAnnouncement={actionPendingAnnouncement}>{actionLabel}</Button> : null}
      close={
        closeLabel ? (
          <IconButton aria-label={closeLabel} size="xs">
            <X aria-hidden="true" />
          </IconButton>
        ) : null
      }
      timeBar={progress === undefined ? null : <ToastTimeBar status={status} progress={progress} />}
      {...props}
    />
  );
}

export type ToastShortcutKeys = ReactNode;

export type StatusToastData = { kind: "status"; status: ToastStatus; timeBar: boolean };
export type UndoToastData = { kind: "undo"; icon?: ReactNode; shortcut?: ReactNode };
export type PaprikaToastData = StatusToastData | UndoToastData;

type ToastAction = { label: ReactNode; onAction?: () => unknown; href?: string };

export type ShowStatusToastInput = {
  status: ToastStatus;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  timeBar?: boolean;
  id?: string;
  onDismiss?: ToastOptions["onDismiss"];
};

export function showStatusToast(toaster: Toaster<ReactNode>, { status, title, description, action, timeBar = false, id, onDismiss }: ShowStatusToastInput) {
  const persistent = status === "danger";
  const duration = persistent ? Infinity : action ? toastDurations.withAction : toastDurations.default;
  return toaster(title, {
    id,
    description,
    type: sdkTypes[status],
    duration,
    priority: persistent ? "assertive" : "polite",
    action: action ? { label: action.label, onAction: action.onAction, href: action.href } : undefined,
    data: { kind: "status", status, timeBar: timeBar && !persistent } satisfies StatusToastData,
    onDismiss,
  });
}

export type ShowUndoToastInput = {
  title: ReactNode;
  action: ToastAction;
  icon?: ReactNode;
  shortcut?: ReactNode;
  id?: string;
};

export function showUndoToast(toaster: Toaster<ReactNode>, { title, action, icon, shortcut, id }: ShowUndoToastInput) {
  return toaster(title, {
    id,
    duration: toastDurations.withAction,
    action: { label: action.label, onAction: action.onAction, href: action.href },
    data: { kind: "undo", icon, shortcut } satisfies UndoToastData,
  });
}

export type StatusToastRegionProps = {
  toaster?: Toaster<ReactNode>;
  closeLabel: string;
  pendingAnnouncement: string;
  "aria-label": string;
  maxVisible?: number;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  shortcut?: string | null;
  className?: string;
};

const itemClasses =
  "group/toast absolute inset-x-0 bottom-0 z-[calc(100-var(--toast-index))] h-(--toast-height) [--y:calc(var(--toast-index)*-8px)] [scale:calc(1-var(--toast-index)*0.04)] [translate:var(--toast-swipe-x,0px)_calc(var(--y)+var(--toast-swipe-y,0px))] transition-[translate,scale,opacity,height] duration-300 motion-reduce:transition-[opacity] data-swiping:transition-none data-expanded:[--y:calc(-1*(var(--toast-offset)+var(--toast-index)*8px))] data-expanded:[scale:1] not-data-front:not-data-expanded:h-(--toast-front-height) not-data-front:not-data-expanded:overflow-hidden data-starting-style:transition-none data-starting-style:data-front:[--y:100%] data-starting-style:not-data-front:opacity-0 data-ending-style:opacity-0 list-none";

export function StatusToastRegion({ toaster, closeLabel, pendingAnnouncement, maxVisible = 3, side = "bottom", align = "center", className, shortcut, ...props }: StatusToastRegionProps) {
  return (
    <ToastRegion
      toaster={toaster}
      maxVisible={maxVisible}
      side={side}
      align={align}
      shortcut={shortcut}
      pendingAnnouncement={pendingAnnouncement}
      className={cn(
        "w-90 max-w-[calc(100vw-2rem)] h-(--toast-front-height) data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*8px)]",
        className,
      )}
      {...props}
    >
      {(item) => {
        const data = item.data as PaprikaToastData | undefined;
        const undo = data?.kind === "undo";
        const status: ToastStatus = data?.kind === "status" ? data.status : "info";
        return (
          <Toast className={itemClasses}>
            <ToastShell
              className="h-full"
              role={undefined}
              leading={
                undo ? (
                  <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-fg [&_svg]:size-[18px]">
                    {data.icon ?? <Undo2 />}
                  </span>
                ) : (
                  <StatusIcon status={status} />
                )
              }
              title={<ToastTitle />}
              description={<ToastDescription />}
              actions={
                item.action ? (
                  <>
                    <ToastAction render={<Button variant="secondary" size="sm" pendingAnnouncement={pendingAnnouncement} />} />
                    {undo ? data.shortcut : null}
                  </>
                ) : null
              }
              close={
                <ToastClose render={<IconButton aria-label={closeLabel} size="xs" />}>
                  <X aria-hidden="true" />
                </ToastClose>
              }
              timeBar={data?.kind === "status" && data.timeBar && item.duration !== Infinity ? <ToastTimeBar status={status} duration={item.duration} /> : null}
            />
          </Toast>
        );
      }}
    </ToastRegion>
  );
}
