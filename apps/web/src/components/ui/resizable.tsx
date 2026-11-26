import { Resizable as ResizablePrimitive, ResizableHandle as ResizableHandlePrimitive, ResizablePanel as ResizablePanelPrimitive } from "@ui-sdk/react/resizable";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

export { createResizableController } from "@ui-sdk/react/resizable";
export type {
  ResizableController,
  ResizableLayoutChangeDetails,
  ResizableLayoutCommitDetails,
  ResizableSize,
  ResizableStorage,
} from "@ui-sdk/react/resizable";

export type ResizableProps = ComponentProps<typeof ResizablePrimitive>;

export function Resizable({ className, ...props }: ResizableProps) {
  return <ResizablePrimitive className={slot("size-full min-w-0", className)} {...props} />;
}

export type ResizablePanelProps = ComponentProps<typeof ResizablePanelPrimitive>;

export function ResizablePanel({ className, ...props }: ResizablePanelProps) {
  return <ResizablePanelPrimitive className={slot("min-w-0 overflow-hidden", className)} {...props} />;
}

export type ResizableHandleProps = ComponentProps<typeof ResizableHandlePrimitive>;

export function ResizableHandle({ className, ...props }: ResizableHandleProps) {
  return (
    <ResizableHandlePrimitive
      className={slot(
        `relative z-5 w-px bg-line outline-none after:absolute after:inset-y-0 after:-inset-x-[0.5px] data-hovering:after:bg-field data-dragging:after:bg-select focus-visible:after:bg-select forced-colors:bg-[CanvasText] ${focusRing} focus-visible:outline-offset-0`,
        className,
      )}
      {...props}
    />
  );
}
