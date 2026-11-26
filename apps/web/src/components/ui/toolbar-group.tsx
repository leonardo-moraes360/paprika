import { ToggleGroup as ToggleGroupPrimitive } from "@ui-sdk/react/toggle";
import { Toolbar as ToolbarPrimitive, ToolbarGroup as ToolbarGroupPrimitive, ToolbarSeparator as ToolbarSeparatorPrimitive } from "@ui-sdk/react/toolbar";
import type { ComponentProps } from "react";
import { slot } from "@/lib/utils";

export type ToolbarProps = ComponentProps<typeof ToolbarPrimitive>;

export function Toolbar({ className, ...props }: ToolbarProps) {
  return (
    <ToolbarPrimitive
      className={slot(
        "flex items-center gap-0.5 rounded-popup border border-line bg-panel px-1.5 py-1 shadow-popover data-[orientation=vertical]:flex-col data-[orientation=vertical]:px-1 data-[orientation=vertical]:py-1.5 forced-colors:border-2",
        className,
      )}
      {...props}
    />
  );
}

export type ToolbarGroupProps = ComponentProps<typeof ToolbarGroupPrimitive>;

export function ToolbarGroup({ className, ...props }: ToolbarGroupProps) {
  return <ToolbarGroupPrimitive className={slot("flex items-center gap-0.5 data-[orientation=vertical]:flex-col", className)} {...props} />;
}

export type ToolbarSeparatorProps = ComponentProps<typeof ToolbarSeparatorPrimitive>;

export function ToolbarSeparator({ className, ...props }: ToolbarSeparatorProps) {
  return (
    <ToolbarSeparatorPrimitive
      className={slot(
        "shrink-0 bg-line data-[orientation=horizontal]:my-1 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-5 data-[orientation=vertical]:mx-1 data-[orientation=vertical]:h-5 data-[orientation=vertical]:w-px forced-colors:bg-[CanvasText]",
        className,
      )}
      {...props}
    />
  );
}

export type ToolbarToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive>;

export function ToolbarToggleGroup({ className, deselectable = false, ...props }: ToolbarToggleGroupProps) {
  return <ToggleGroupPrimitive deselectable={deselectable} className={slot("flex items-center gap-0.5 data-[orientation=vertical]:flex-col", className)} {...props} />;
}
