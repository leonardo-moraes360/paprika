import { Progress, ProgressValue } from "@ui-sdk/react/progress";
import { Check, File, TriangleAlert, X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ImportedFileStatus = "uploading" | "done" | "warning" | "error";

export type ImportedFileProps = Omit<ComponentProps<"div">, "children"> & {
  status: ImportedFileStatus;
  name: string;
  detail?: string;
  progress?: number;
  statusLabel: string;
  progressLabel?: string;
};

export function ImportedFile({ status, name, detail, progress, statusLabel, progressLabel, className, ...props }: ImportedFileProps) {
  return (
    <div data-status={status} className={cn("flex h-13 w-70 items-center gap-2.5 rounded-md px-2", className)} {...props}>
      <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-field bg-field-bg text-fg">
        <File className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm leading-[1.4] font-semibold text-fg">{name}</span>
        {detail ? <span className="truncate text-xs leading-[1.4] text-muted">{detail}</span> : null}
      </span>
      {status === "uploading" ? (
        <Progress value={progress ?? null} aria-label={progressLabel ?? statusLabel} className="w-8 shrink-0 text-right">
          <ProgressValue className="text-xs leading-[1.4] font-semibold text-muted" />
        </Progress>
      ) : (
        <span role="img" aria-label={statusLabel} className="inline-flex size-5 shrink-0 items-center justify-center">
          {status === "done" ? <Check aria-hidden="true" className="size-5 text-green-ink" /> : null}
          {status === "warning" ? <TriangleAlert aria-hidden="true" className="size-5 text-warn" /> : null}
          {status === "error" ? <X aria-hidden="true" className="size-5 text-red-ink" /> : null}
        </span>
      )}
    </div>
  );
}
