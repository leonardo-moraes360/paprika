import { Check, ChevronDown, Code, Copy, Download } from "lucide-react";
import { useId, type ComponentProps } from "react";
import { cn, focusRing } from "@/lib/utils";
import { Button } from "./button";

export type ExportCodeOption = { value: string; label: string };

export type ExportCodeLabels = {
  format: string;
  tokens: string;
  code: string;
  copy: string;
  download: string;
  pendingAnnouncement: string;
};

export type ExportCodeProps = Omit<ComponentProps<"div">, "children"> & {
  formats: readonly ExportCodeOption[];
  format: string;
  onFormatChange: (format: string) => void;
  tokens: boolean;
  onTokensChange: (tokens: boolean) => void;
  code: string;
  onCopy: () => unknown;
  onDownload: () => unknown;
  labels: ExportCodeLabels;
};

const fieldLabel = "text-xs leading-[1.4] font-semibold text-muted";

export function ExportCode({ formats, format, onFormatChange, tokens, onTokensChange, code, onCopy, onDownload, labels, className, ...props }: ExportCodeProps) {
  const id = useId();
  return (
    <div className={cn("flex w-70 flex-col gap-2", className)} {...props}>
      <label htmlFor={`${id}-format`} className={fieldLabel}>{labels.format}</label>
      <div className="relative flex h-9 items-center rounded-md border border-field bg-field-bg text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-select">
        <Code aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-muted" />
        <select
          id={`${id}-format`}
          value={format}
          onChange={(event) => onFormatChange(event.target.value)}
          className="h-full w-full cursor-pointer appearance-none rounded-md bg-transparent pr-9 pl-9 text-base text-fg outline-none"
        >
          {formats.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 size-4" />
      </div>
      <label className="group/tokens flex h-5 cursor-pointer items-center gap-2.5 text-base leading-[1.4] text-fg">
        <span className="relative inline-flex size-[18px] shrink-0">
          <input
            type="checkbox"
            checked={tokens}
            onChange={(event) => onTokensChange(event.target.checked)}
            className={cn(
              "peer/box size-[18px] cursor-pointer appearance-none rounded-sm border border-field bg-field-bg checked:border-action checked:bg-action forced-colors:checked:bg-[Highlight]",
              focusRing,
            )}
          />
          <Check aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 stroke-3 text-on-action peer-checked/box:block" />
        </span>
        {labels.tokens}
      </label>
      <pre
        tabIndex={0}
        aria-label={labels.code}
        className={cn(
          "h-37.5 overflow-auto rounded-md bg-[light-dark(#2A1A14,#0D101B)] px-3 py-2.5 font-mono text-xs leading-normal text-[light-dark(#F5EADB,#D7DCEB)] forced-colors:border forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
          focusRing,
        )}
      >
        <code>{code}</code>
      </pre>
      <div className="flex items-center gap-2">
        <Button variant="secondary" pendingAnnouncement={labels.pendingAnnouncement} onClick={onCopy}>
          <Copy aria-hidden="true" />
          {labels.copy}
        </Button>
        <Button className="flex-1" pendingAnnouncement={labels.pendingAnnouncement} onClick={onDownload}>
          <Download aria-hidden="true" />
          {labels.download}
        </Button>
      </div>
    </div>
  );
}
