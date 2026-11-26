import {
  Dialog as DialogPrimitive,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dialogBackdropClasses, dialogSurfaceClasses } from "./alert-dialog";
import { IconButton } from "./icon-button";

export type DialogProps = Omit<ComponentProps<typeof DialogPrimitive>, "children" | "pendingAnnouncement"> & {
  pendingAnnouncement: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  trigger?: ReactElement;
  closeLabel: string;
  className?: string;
};

export function Dialog({ title, description, children, footer, trigger, closeLabel, pendingAnnouncement, className, ...props }: DialogProps) {
  return (
    <DialogPrimitive pendingAnnouncement={pendingAnnouncement} {...props}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogBackdrop className={dialogBackdropClasses} />
      <DialogContent className={cn(dialogSurfaceClasses, "flex flex-col gap-4", className)}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <DialogTitle className="text-[17px] leading-[1.3] font-bold text-fg">{title}</DialogTitle>
            {description ? <DialogDescription className="text-base leading-normal text-muted">{description}</DialogDescription> : null}
          </div>
          <DialogClose render={<IconButton aria-label={closeLabel} size="sm" />}>
            <X aria-hidden="true" />
          </DialogClose>
        </div>
        {children}
        {footer ? <div className="flex items-center justify-end gap-2">{footer}</div> : null}
      </DialogContent>
    </DialogPrimitive>
  );
}

export { DialogClose };
