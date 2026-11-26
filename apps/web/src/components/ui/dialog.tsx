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
import { IconButton } from "./icon-button";
import { dialogBackdropClasses, dialogSurfaceClasses } from "./overlay-surface";

export type DialogProps = Omit<ComponentProps<typeof DialogPrimitive>, "children" | "pendingAnnouncement"> & {
  pendingAnnouncement: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  trigger?: ReactElement;
  closeLabel: string;
  contentProps?: Omit<ComponentProps<typeof DialogContent>, "children" | "className">;
  className?: string;
};

export function Dialog({ title, description, children, footer, trigger, closeLabel, pendingAnnouncement, contentProps, className, ...props }: DialogProps) {
  return (
    <DialogPrimitive pendingAnnouncement={pendingAnnouncement} {...props}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogBackdrop className={dialogBackdropClasses} />
      <DialogContent className={cn(dialogSurfaceClasses, "flex flex-col gap-4", className)} {...contentProps}>
        <div className="flex min-w-0 flex-col gap-1.5 pr-9">
          <DialogTitle className="text-[17px] leading-[1.3] font-bold text-fg">{title}</DialogTitle>
          {description ? <DialogDescription className="text-base leading-normal text-muted">{description}</DialogDescription> : null}
        </div>
        {children}
        {footer ? <div className="flex items-center justify-end gap-2">{footer}</div> : null}
        <DialogClose render={<IconButton aria-label={closeLabel} size="sm" className="absolute top-6 right-6" />}>
          <X aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </DialogPrimitive>
  );
}

export { DialogClose };
