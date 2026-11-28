import { useState } from "react";
import { cn } from "@/lib/utils";
import { useCanvasState } from "../region";
import type { WasmLayer } from "./layer";

/**
 * The `<canvas>` the WASM layer draws on, UNDER the world (an earlier sibling in the same stacking context): the DOM paints text,
 * images, selection and everything the layer cannot draw above it. It mounts the first time WASM is asked for and then stays
 * (hidden while the DOM paints), so going back and forth does not make a new device. The layer writes `data-backend`,
 * `data-detail` and `data-creates` on it by itself: the server's screenshot waits for them.
 */
export function WasmCanvas({ layer }: { layer: WasmLayer }) {
  const mode = useCanvasState((s) => s.renderer);
  // A canvas keeps the context type it got first (2d for the CPU, WebGPU for the GPU): the other backend gets a new one.
  const [kept, setKept] = useState<"cpu" | "gpu" | null>(mode === "dom" ? null : mode);
  if (mode !== "dom" && mode !== kept) setKept(mode);
  if (!kept) return null;
  return <canvas key={kept} ref={layer.setCanvas} data-mode={kept} data-testid="wasm-layer" aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full", mode === "dom" && "invisible")} />;
}
