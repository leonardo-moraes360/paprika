import { Scan, Minus, Plus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Toolbar, ToolbarSeparator } from "./toolbar-group";
import { ToolbarButton } from "./toolbar-button";
import { cn } from "@/lib/utils";

export type ZoomControlProps = Omit<ComponentProps<typeof Toolbar>, "children" | "aria-label"> & {
  label: string;
  value: string;
  zoomOutLabel: string;
  zoomInLabel: string;
  fitLabel: string;
  zoomOutDisabled?: boolean;
  zoomInDisabled?: boolean;
  onZoomOut?: () => void;
  onZoomIn?: () => void;
  onFit?: () => void;
  trailing?: ReactNode;
};

export function ZoomControl({
  className,
  label,
  value,
  zoomOutLabel,
  zoomInLabel,
  fitLabel,
  zoomOutDisabled,
  zoomInDisabled,
  onZoomOut,
  onZoomIn,
  onFit,
  trailing,
  ...props
}: ZoomControlProps) {
  return (
    <Toolbar aria-label={label} className={cn("gap-0.5 p-1", className)} {...props}>
      <ToolbarButton aria-label={zoomOutLabel} disabled={zoomOutDisabled} onClick={onZoomOut}>
        <Minus aria-hidden="true" />
      </ToolbarButton>
      <output className="inline-flex h-7 w-[52px] items-center justify-center text-sm font-semibold text-fg tabular-nums">{value}</output>
      <ToolbarButton aria-label={zoomInLabel} disabled={zoomInDisabled} onClick={onZoomIn}>
        <Plus aria-hidden="true" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton aria-label={fitLabel} onClick={onFit}>
        <Scan aria-hidden="true" />
      </ToolbarButton>
      {trailing ? (
        <>
          <ToolbarSeparator />
          {trailing}
        </>
      ) : null}
    </Toolbar>
  );
}
