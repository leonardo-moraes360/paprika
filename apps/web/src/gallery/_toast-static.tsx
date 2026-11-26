import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusIcon } from "@/components/ui/status-icon";
import { ToastShell, ToastTimeBar, type ToastStatus } from "@/components/ui/toast";

export type StatusToastSpecimenProps = Omit<ComponentProps<"div">, "title"> & {
  status: ToastStatus;
  title: ReactNode;
  description?: ReactNode;
  actionLabel?: ReactNode;
  closeLabel?: string;
  progress?: number;
};

export function StatusToastSpecimen({ status, title, description, actionLabel, closeLabel, progress, ...props }: StatusToastSpecimenProps) {
  return (
    <ToastShell
      leading={<StatusIcon status={status} />}
      title={title}
      description={description}
      actions={actionLabel ? <Button variant="secondary" size="sm">{actionLabel}</Button> : null}
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
