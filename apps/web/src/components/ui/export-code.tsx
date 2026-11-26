import { Copy, Download } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { ScrollArea } from "./scroll-area";
import { Select } from "./select";

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

export function ExportCode({ formats, format, onFormatChange, tokens, onTokensChange, code, onCopy, onDownload, labels, className, ...props }: ExportCodeProps) {
  return (
    <div className={cn("flex w-70 flex-col gap-2", className)} {...props}>
      <Select label={labels.format} options={[...formats]} value={format} onValueChange={(next) => next && onFormatChange(next)} />
      <Checkbox label={labels.tokens} checked={tokens} onCheckedChange={(next) => onTokensChange(next === true)} />
      <ScrollArea label={labels.code} viewportClassName="rounded-md focus-visible:-outline-offset-2" className="h-37.5 rounded-md bg-code forced-colors:border forced-colors:bg-[Canvas]">
        <pre className="px-3 py-2.5 font-mono text-xs leading-normal text-code-ink forced-colors:text-[CanvasText]">
          <code>{code}</code>
        </pre>
      </ScrollArea>
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
