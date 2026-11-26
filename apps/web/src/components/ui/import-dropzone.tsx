import { FileInput, FileInputDropzone, FileInputTrigger } from "@ui-sdk/react/file-input";
import { Upload } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

export type ImportDropzoneState = "idle" | "dragging" | "error";

export type ImportDropzoneProps = Omit<ComponentProps<typeof FileInput>, "children" | "className"> & {
  state?: ImportDropzoneState;
  prompt: ReactNode;
  draggingPrompt: ReactNode;
  errorPrompt?: ReactNode;
  formats: ReactNode;
  browseLabel: string;
  className?: string;
};

export function ImportDropzone({ state = "idle", prompt, draggingPrompt, errorPrompt, formats, browseLabel, className, ...props }: ImportDropzoneProps) {
  return (
    <FileInput {...props}>
      <FileInputDropzone
        className={(zone) => {
          const dragging = state === "dragging" || zone.dragging;
          const invalid = state === "error" || zone.dragReject;
          return cn(
            "relative flex h-31 w-70 max-w-full flex-col items-center justify-center gap-1.5 rounded-[10px] p-3 text-center",
            invalid
              ? "bg-red-soft outline-[1.5px] -outline-offset-[1.5px] outline-red-ink outline-dashed forced-colors:outline-solid"
              : dragging
                ? "border-2 border-select bg-select/12 forced-colors:border-[Highlight]"
                : "bg-field-bg outline-[1.5px] -outline-offset-[1.5px] outline-field outline-dashed",
            zone.disabled && "cursor-not-allowed",
            className,
          );
        }}
      >
        {(zone) => {
          const dragging = state === "dragging" || zone.dragging;
          const invalid = state === "error" || zone.dragReject;
          return (
            <>
              <Upload aria-hidden="true" className={cn("size-6 stroke-2", invalid ? "text-red-soft-ink" : "text-fg")} />
              <span className={cn("text-base leading-[1.4] font-semibold", invalid ? "text-red-soft-ink" : "text-fg")}>
                {invalid && errorPrompt ? errorPrompt : dragging ? draggingPrompt : prompt}
              </span>
              <span className={cn("text-xs leading-[1.4]", invalid ? "text-red-soft-ink" : "text-muted")}>{formats}</span>
              <FileInputTrigger
                aria-label={browseLabel}
                className={cn("absolute inset-0 cursor-pointer rounded-[10px] bg-transparent", focusRing)}
              />
            </>
          );
        }}
      </FileInputDropzone>
    </FileInput>
  );
}
