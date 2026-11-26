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
import { dialogBackdropClasses, dialogSurfaceClasses } from "./overlay-surface";
import { StatusIcon, type Status } from "./status-icon";

type AlertDialogBaseProps = Omit<ComponentProps<typeof AlertDialogPrimitive>, "children" | "pendingAnnouncement"> & {
  pendingAnnouncement: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  trigger?: ReactElement;
  confirmLabel: ReactNode;
  extra?: ReactNode;
  onConfirm?: (event: Event | undefined, details: { source: string }) => unknown;
  contentProps?: Omit<ComponentProps<typeof AlertDialogContent>, "children" | "className">;
  className?: string;
};

export type AlertDialogProps = AlertDialogBaseProps &
  ({ status?: "danger"; cancelLabel: ReactNode } | { status: Exclude<Status, "danger">; cancelLabel?: ReactNode });

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
  contentProps,
  className,
  ...props
}: AlertDialogProps) {
  return (
    <AlertDialogPrimitive pendingAnnouncement={pendingAnnouncement} {...props}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogBackdrop className={dialogBackdropClasses} />
      <AlertDialogContent className={cn(dialogSurfaceClasses, "flex flex-col gap-4", className)} {...contentProps}>
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
