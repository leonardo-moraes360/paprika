import { Toast, ToastAction, ToastClose, ToastDescription, ToastRegion, ToastTitle, type Toaster } from "@ui-sdk/react/toast";
import { Undo2, X } from "lucide-react";
import { useEffect, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { StatusIcon, type Status } from "./status-icon";

export type ToastStatus = Status;

export type StatusToastData = { kind: "status"; status: ToastStatus; timeBar: boolean };
export type UndoToastData = { kind: "undo"; icon?: ReactNode; shortcut?: ReactNode };
export type PaprikaToastData = StatusToastData | UndoToastData;

const barTones: Record<ToastStatus, string> = {
  danger: "bg-red-ink",
  warning: "bg-warn",
  info: "bg-select",
  success: "bg-green-ink",
};

const statusOfType: Record<string, ToastStatus> = { error: "danger", warning: "warning", success: "success", info: "info" };

const surfaceClasses =
  "relative flex w-full flex-col overflow-hidden rounded-popup border border-line bg-popover text-fg shadow-popover forced-colors:border-2";

const shellKinds = {
  status: { body: "gap-3 py-3 pr-2 pl-3", text: "pt-1", title: "font-semibold" },
  undo: { body: "gap-2.5 py-3 pr-2 pl-3.5", text: "", title: "font-normal" },
};

export type ToastShellProps = Omit<ComponentProps<"div">, "title"> & {
  kind?: keyof typeof shellKinds;
  leading: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  close?: ReactNode;
  timeBar?: ReactNode;
};

export function ToastShell({ kind = "status", leading, title, description, actions, close, timeBar, className, ...props }: ToastShellProps) {
  const shape = shellKinds[kind];
  return (
    <div className={cn(surfaceClasses, className)} {...props}>
      <div className={cn("flex items-start", shape.body)}>
        {leading}
        <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", shape.text)}>
          <div className={cn("text-sm leading-[1.45] text-fg", shape.title)}>{title}</div>
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
  paused?: boolean;
};

export function ToastTimeBar({ status, duration, progress = 1, paused = false }: ToastTimeBarProps) {
  const style: CSSProperties =
    duration === undefined
      ? { transform: `scaleX(${progress})` }
      : { animation: `paprika-toast-time ${duration}ms linear forwards`, animationPlayState: paused ? "paused" : undefined };
  return (
    <div aria-hidden="true" className="h-[3px] w-full bg-surface motion-reduce:hidden">
      <style href="paprika-toast-time" precedence="default">{"@keyframes paprika-toast-time{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}</style>
      <div className={cn("h-full origin-left group-data-expanded/toast:[animation-play-state:paused]", barTones[status])} style={style} />
    </div>
  );
}

function useWindowInactive() {
  const [inactive, setInactive] = useState(false);
  useEffect(() => {
    const sync = () => setInactive(document.visibilityState === "hidden" || !document.hasFocus());
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return inactive;
}

export type StatusToastRegionProps = {
  toaster: Toaster<ReactNode>;
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
  const inactive = useWindowInactive();
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
        const status: ToastStatus = data?.kind === "status" ? data.status : (statusOfType[item.type] ?? "info");
        return (
          <Toast className={itemClasses}>
            <ToastShell
              kind={undo ? "undo" : "status"}
              className="h-full"
              role={undefined}
              leading={
                undo ? (
                  <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-[18px] shrink-0 items-center justify-center text-fg [&_svg]:size-[18px]">
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
              timeBar={
                data?.kind === "status" && data.timeBar && item.duration !== Infinity ? (
                  <ToastTimeBar status={status} duration={item.duration} paused={inactive} />
                ) : null
              }
            />
          </Toast>
        );
      }}
    </ToastRegion>
  );
}
