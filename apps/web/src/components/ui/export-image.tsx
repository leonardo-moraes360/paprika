import { Download, Image } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control";

export type ExportImageOption = { value: string; label: string };

export type ExportImageLabels = {
  format: string;
  scale: string;
  file: string;
  vectorNote: string;
  exportAction: string;
  pendingAnnouncement: string;
};

export type ExportImageProps = Omit<ComponentProps<"div">, "children"> & {
  formats: readonly ExportImageOption[];
  format: string;
  onFormatChange: (format: string) => void;
  vector?: boolean;
  scales: readonly ExportImageOption[];
  scale: string;
  onScaleChange: (scale: string) => void;
  fileName: string;
  dimensions?: string;
  onExport: () => unknown;
  labels: ExportImageLabels;
};

const fieldLabel = "text-xs leading-[1.4] font-semibold text-muted";

export function ExportImage({ formats, format, onFormatChange, vector = false, scales, scale, onScaleChange, fileName, dimensions, onExport, labels, className, ...props }: ExportImageProps) {
  const id = useId();
  return (
    <div className={cn("flex w-70 flex-col gap-2", className)} {...props}>
      <span id={`${id}-format`} className={fieldLabel}>{labels.format}</span>
      <SegmentedControl
        aria-labelledby={`${id}-format`}
        value={format}
        onValueChange={(next) => next && onFormatChange(next)}
        stretch
        className="h-7 gap-0.5 bg-field-bg p-0.5"
        indicatorClassName="bg-panel"
      >
        {formats.map((option) => (
          <SegmentedControlItem key={option.value} value={option.value} className="px-0 text-fg font-semibold data-checked:font-semibold">
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {vector ? (
        <p className="text-sm leading-[1.4] text-muted">{labels.vectorNote}</p>
      ) : (
        <>
          <span id={`${id}-scale`} className={fieldLabel}>{labels.scale}</span>
          <SegmentedControl
            aria-labelledby={`${id}-scale`}
            value={scale}
            onValueChange={(next) => next && onScaleChange(next)}
            stretch
            className="h-7 gap-1.5 rounded-none border-0 bg-transparent p-0"
            indicatorClassName="rounded-md border-2 border-select bg-field-bg"
          >
            {scales.map((option) => (
              <SegmentedControlItem
                key={option.value}
                value={option.value}
                className="h-7 rounded-md border-field px-0 text-sm font-semibold text-fg data-checked:border-transparent data-checked:font-semibold"
              >
                {option.label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </>
      )}
      <span className={fieldLabel}>{labels.file}</span>
      <div className="flex h-9 items-center gap-2 rounded-md border border-field bg-field-bg px-3">
        <Image aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-base leading-[1.4] text-fg">{fileName}</span>
        {dimensions ? <span className="shrink-0 text-right text-xs leading-[1.4] text-muted">{dimensions}</span> : null}
      </div>
      <div className="h-1" />
      <Button className="w-full" pendingAnnouncement={labels.pendingAnnouncement} onClick={onExport}>
        <Download aria-hidden="true" />
        {labels.exportAction}
      </Button>
    </div>
  );
}
