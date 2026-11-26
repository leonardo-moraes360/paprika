import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { StatusIcon, type Status } from "./status-icon";

export const dialogBackdropClasses =
  "fixed inset-0 bg-overlay transition-opacity duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0";

export const dialogSurfaceClasses =
  "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-110 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[14px] border border-line bg-popover p-6 text-fg shadow-[0_24px_48px_var(--color-shadow)] transition-[opacity,scale] duration-200 motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 forced-colors:border-2";

export type AlertDialogProps = Omit<ComponentProps<typeof AlertDialogPrimitive>, "children" | "pendingAnnouncement"> & {
  pendingAnnouncement: string;
  status?: Status;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  trigger?: ReactElement;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  extra?: ReactNode;
  onConfirm?: (event: Event | undefined, details: { source: string }) => unknown;
  className?: string;
};

export function AlertDialog({
  status = "danger",
  title,
  description,
  children,
  trigger,
  confirmLabel,
  cancelLabel,
  extra,
  onConfirm,
  pendingAnnouncement,
  className,
  ...props
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive pendingAnnouncement={pendingAnnouncement} {...props}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogBackdrop className={dialogBackdropClasses} />
      <AlertDialogContent className={cn(dialogSurfaceClasses, "flex flex-col gap-4", className)}>
        <div className="flex items-center gap-3">
          <StatusIcon status={status} size="lg" />
          <AlertDialogTitle className="min-w-0 flex-1 text-[17px] leading-[1.3] font-bold text-fg">{title}</AlertDialogTitle>
        </div>
        {description ? (
          <AlertDialogDescription className="text-base leading-normal text-muted">{description}</AlertDialogDescription>
        ) : null}
        {children ? <div className="flex flex-col gap-2">{children}</div> : null}
        <div className="flex items-center gap-2">
          {extra}
          <span className="flex-1" />
          {cancelLabel ? (
            <AlertDialogClose render={<Button variant="secondary" pendingAnnouncement={pendingAnnouncement} />}>{cancelLabel}</AlertDialogClose>
          ) : null}
          <AlertDialogClose
            value="confirm"
            action={onConfirm}
            render={<Button variant={status === "danger" ? "destructive" : "primary"} pendingAnnouncement={pendingAnnouncement} />}
          >
            {confirmLabel}
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialogPrimitive>
  );
}
